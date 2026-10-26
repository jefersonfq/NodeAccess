import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { TrialMachines } from './trial-machines.js'
import { TrialCustomHosts } from './trial-custom-hosts.js'
import type { TrialLab, TrialProfile } from './trial-contract.js'
import { encrypt, decrypt, type EncryptedPayload } from '../../shared/crypto.js'

const connection = process.env.TRIAL_RETENTION_DATABASE_URL
const real = connection ? describe : describe.skip
const profile: TrialProfile = {
  name: 'Machine fixture', resources: ['ssh', 'sftp'], durationDays: 7, expiryNoticeHours: 6,
  maxUsers: 2, maxHosts: 3, machineCount: 1, maxMachines: 3, maxSessions: 2,
  allowCustomHosts: true, maxCustomHosts: 2, templateId: 'linux-v1', networkCidr: '10.64.0.0/16',
  maxActiveTrials: 2, retentionDays: 2, privacyUrl: 'https://example.com/privacy', termsUrl: 'https://example.com/terms', privacyVersion: 'fixture',
}
real('trial machine expansion with real isolated MySQL transactions', () => {
  let db: PrismaClient
  const tenantIds: number[] = []
  let sequence = 0
  beforeAll(async () => {
    const url = new URL(connection!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['/na0068_retention', '/na0074_retention'].includes(url.pathname)) throw new Error('Only the isolated na0068_retention schema is accepted')
    db = new PrismaClient({ datasourceUrl: connection! }); await db.$connect()
    await db.trialProfile.createMany({ data: { id: 1, configJson: profile, updatedBy: 1 }, skipDuplicates: true })
  })
  afterEach(async () => {
    const tenantId = { in: tenantIds.splice(0) }
    await db.resourceAclEntry.deleteMany({ where: { tenantId } })
    await db.inventoryNode.deleteMany({ where: { tenantId, type: 'HOST' } })
    await db.inventoryNode.deleteMany({ where: { tenantId } })
    await db.trialRegistration.deleteMany({ where: { tenantId } })
    await db.host.deleteMany({ where: { tenantId } })
    await db.user.deleteMany({ where: { tenantId } })
    await db.tenant.deleteMany({ where: { id: tenantId } })
  })
  afterAll(async () => { await db?.$disconnect() })
  async function fixture() {
    const id = randomUUID(), octet = ++sequence
    const tenant = await db.tenant.create({ data: { name: 'Trial expansion fixture', slug: `machines-${id}` } }); tenantIds.push(tenant.id)
    const user = await db.user.create({ data: { tenantId: tenant.id, name: 'Owner fixture', email: `${id}@example.com`, passwordHash: 'fixture' } })
    const hosts = Array.from({ length: 3 }, (_, index) => ({ name: `Machine ${index + 1}`, ip: `10.64.${octet}.${10 + index}`, port: 2222, sshUser: 'demo', password: `private-fixture-${id}-${index}`, fingerprint: `SHA256:${String.fromCharCode(97 + index).repeat(43)}` }))
    const first = hosts[0]!
    const host = await db.host.create({ data: { tenantId: tenant.id, ownerId: user.id, name: first.name, ip: first.ip, port: first.port, sshUser: first.sshUser, authType: 'PASSWORD', scope: 'GLOBAL', passwordEncrypted: JSON.stringify(encrypt(first.password)), trustedHostKeyFingerprint: `${first.fingerprint}=` } })
    const root = await db.inventoryNode.create({ data: { tenantId: tenant.id, rootTenantId: tenant.id, type: 'ROOT', name: 'Root', path: '/', depth: 0 } })
    const node = await db.inventoryNode.create({ data: { tenantId: tenant.id, parentId: root.id, hostId: host.id, type: 'HOST', name: host.name, path: '/original/', depth: 1 } })
    const acl = await db.resourceAclEntry.create({ data: { tenantId: tenant.id, inventoryNodeId: node.id, principalType: 'ROLE', principalId: 1, canView: true, canConnect: true, canEdit: false, canAdmin: false, createdById: user.id } })
    const row = await db.trialRegistration.create({ data: { id, tenantId: tenant.id, name: user.name, email: user.email, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400_000), privacyVersion: 'fixture', profileJson: { ...profile, hostAddresses: [first.ip], requestedMachines: 1 } } })
    const lab = (count = 2): TrialLab => ({ trialId: id, state: 'ready', isolated: true, hosts: hosts.slice(0, count) })
    const provider = { ensure: vi.fn(() => Promise.resolve(lab())), remove: vi.fn(() => Promise.resolve()) }
    return { row, tenant, user, host, node, acl, root, hosts, lab, provider, service: new TrialMachines(db, provider) }
  }
  it('reconciles an unchanged active lab after a provider restart without resetting host credentials or deadline', async () => {
    const f = await fixture()
    f.provider.ensure.mockRejectedValueOnce(new Error('provider restarting'))
    await f.service.tick()
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ machineCount: 1, requestedMachines: 1, error: 'TRIAL_MACHINE_RETRY' })
    const restarted = { ensure: vi.fn(() => Promise.resolve(f.lab(1))), remove: vi.fn(() => Promise.resolve()) }
    await new TrialMachines(db, restarted).tick()
    expect(restarted.ensure).toHaveBeenCalledExactlyOnceWith(f.row.id, expect.objectContaining({ ...profile, machineCount: 1 }))
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    expect(await db.inventoryNode.findUnique({ where: { id: f.node.id } })).toEqual(f.node)
    expect(await db.resourceAclEntry.findUnique({ where: { id: f.acl.id } })).toEqual(f.acl)
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    expect(await db.trialRegistration.findUnique({ where: { id: f.row.id } })).toMatchObject({ status: 'ACTIVE', expiresAt: f.row.expiresAt })
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ machineCount: 1, requestedMachines: 1, provisioning: false, error: null })
    expect(restarted.remove).not.toHaveBeenCalled()
  })
  it('rotates unchanged active labs and failed attempts so a twenty-first lab is reconciled', async () => {
    const fixtures = []
    for (let index = 0; index < 21; index++) {
      const f = await fixture(); fixtures.push(f)
      await db.trialRegistration.update({ where: { id: f.row.id }, data: { updatedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)) } })
    }
    const labs = new Map(fixtures.map(f => [f.row.id, f.lab(1)]))
    const failedId = fixtures[0]!.row.id
    const ensure = vi.fn((id: string): Promise<TrialLab> => id === failedId ? Promise.reject(new Error('provider temporarily unavailable')) : Promise.resolve(labs.get(id)!))
    const service = new TrialMachines(db, { ensure, remove: vi.fn(() => Promise.resolve()) })
    await service.tick()
    expect(ensure).toHaveBeenCalledTimes(20)
    expect(ensure.mock.calls.map(([id]) => id)).not.toContain(fixtures[20]!.row.id)
    await service.tick()
    expect(new Set(ensure.mock.calls.map(([id]) => id)).size).toBe(21)
    expect(await db.trialRegistration.findUnique({ where: { id: failedId } })).toMatchObject({ status: 'ACTIVE' })
    expect(await db.host.count({ where: { tenantId: { in: fixtures.map(f => f.tenant.id) } } })).toBe(21)
  })
  it('compensates an unchanged lab whose deadline elapsed during reconciliation', async () => {
    const f = await fixture(); let release!: (lab: TrialLab) => void; let began!: () => void
    const entered = new Promise<void>(resolve => { began = resolve })
    f.provider.ensure.mockImplementation(() => { began(); return new Promise(resolve => { release = resolve }) })
    const tick = f.service.tick(); await entered
    await db.trialRegistration.update({ where: { id: f.row.id }, data: { expiresAt: new Date(0) } })
    release(f.lab(1)); await tick
    expect(f.provider.remove).toHaveBeenCalledExactlyOnceWith(f.row.id)
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    await f.service.tick()
    expect(f.provider.ensure).toHaveBeenCalledTimes(1)
  })
  it('adds machines and least-privilege inventory ACL while preserving original host and credentials', async () => {
    const f = await fixture()
    await f.service.request(f.tenant.id, { count: 2 }); await f.service.tick()
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    expect(await db.resourceAclEntry.findUnique({ where: { id: f.acl.id } })).toEqual(f.acl)
    const added = await db.host.findFirstOrThrow({ where: { tenantId: f.tenant.id, ip: f.hosts[1]!.ip } })
    expect(decrypt(JSON.parse(added.passwordEncrypted!) as EncryptedPayload)).toBe(f.hosts[1]!.password)
    const node = await db.inventoryNode.findUniqueOrThrow({ where: { hostId: added.id } })
    expect(node).toMatchObject({ parentId: f.root.id, path: `/${node.id}/`, tenantId: f.tenant.id })
    expect(await db.resourceAclEntry.findMany({ where: { inventoryNodeId: node.id } })).toMatchObject([{ principalType: 'ROLE', principalId: 1, canView: true, canConnect: true, canEdit: false, canAdmin: false }])
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ machineCount: 2, requestedMachines: 2, provisioning: false, error: null })
  })
  it('serializes concurrent desired counts and rejects decreases and configured quota overflow', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([f.service.request(f.tenant.id, { count: 2 }), f.service.request(f.tenant.id, { count: 3 })])
    expect(results.some(result => result.status === 'fulfilled')).toBe(true)
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ requestedMachines: 3 })
    await expect(f.service.request(f.tenant.id, { count: 3 })).resolves.toEqual({ requestedMachines: 3 })
    await expect(f.service.request(f.tenant.id, { count: 2 })).rejects.toMatchObject({ code: 'TRIAL_MACHINE_LIMIT' })
    await expect(f.service.request(f.tenant.id, { count: 4 })).rejects.toMatchObject({ code: 'TRIAL_MACHINE_LIMIT' })
  })
  it('counts custom hosts against total capacity and keeps another user personal host private', async () => {
    const f = await fixture()
    const guest = await db.user.create({ data: { tenantId: f.tenant.id, name: 'Guest fixture', email: `${randomUUID()}@example.com` } })
    await db.host.create({ data: { tenantId: f.tenant.id, ownerId: guest.id, name: 'Guest private', ip: '192.0.2.8', sshUser: 'guest', authType: 'PASSWORD', scope: 'PERSONAL' } })
    await expect(f.service.request(f.tenant.id, { count: 3 })).rejects.toMatchObject({ code: 'TRIAL_MACHINE_LIMIT' })
    await f.service.request(f.tenant.id, { count: 2 })
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ customHostCount: 1, customHosts: [], requestedMachines: 2 })
    expect((await f.service.resources(f.tenant.id, guest.id)).customHosts).toHaveLength(1)
  })
  it('serializes custom-host creation against expansion reservation so combined quota cannot overflow', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await fixture()
      const custom = new TrialCustomHosts(db, { protectedAddresses: ['203.0.113.1'] })
      const requests = await Promise.allSettled([
        f.service.request(f.tenant.id, { count: 3 }),
        custom.create(f.tenant.id, f.user.id, { name: 'Own server', ip: '8.8.8.8', sshUser: 'owner', authType: 'password', password: 'fixture-only' }),
      ])
      expect(requests.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const resources = await f.service.resources(f.tenant.id, f.user.id)
      expect(resources.requestedMachines + resources.customHostCount).toBeLessThanOrEqual(3)
      expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    }
  })
  it('retries failed provisioning without closing or resetting a working lab', async () => {
    const f = await fixture()
    f.provider.ensure.mockRejectedValueOnce(new Error('provider secret must not escape'))
    await f.service.request(f.tenant.id, { count: 2 }); await f.service.tick()
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ machineCount: 1, requestedMachines: 2, error: 'TRIAL_MACHINE_RETRY' })
    expect(f.provider.remove).not.toHaveBeenCalled()
    await f.service.tick()
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ machineCount: 2, error: null })
  })
  it('compensates provisioning completed after cancellation without inserting new hosts', async () => {
    const f = await fixture(); let release!: (lab: TrialLab) => void; let began!: () => void
    const entered = new Promise<void>(resolve => { began = resolve })
    f.provider.ensure.mockImplementation(() => { began(); return new Promise(resolve => { release = resolve }) })
    await f.service.request(f.tenant.id, { count: 2 })
    const tick = f.service.tick(); await entered
    await db.trialRegistration.update({ where: { id: f.row.id }, data: { status: 'CANCELLED' } })
    release(f.lab()); await tick
    expect(f.provider.remove).toHaveBeenCalledExactlyOnceWith(f.row.id)
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
  })
  it('two expansion workers converge on one added host without duplicate inventory or ACL', async () => {
    const f = await fixture(); let calls = 0; let release!: () => void
    const both = new Promise<void>(resolve => { release = resolve })
    f.provider.ensure.mockImplementation(async () => { if (++calls === 2) release(); await both; return f.lab() })
    await f.service.request(f.tenant.id, { count: 2 })
    await Promise.all([f.service.tick(), new TrialMachines(db, f.provider).tick()])
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(2)
    expect(await db.inventoryNode.count({ where: { tenantId: f.tenant.id, type: 'HOST' } })).toBe(2)
    expect(await db.resourceAclEntry.count({ where: { tenantId: f.tenant.id } })).toBe(2)
  })
  it('refuses provider credentials changes to existing machines and leaves working host untouched', async () => {
    const f = await fixture()
    f.provider.ensure.mockResolvedValue({ ...f.lab(), hosts: [{ ...f.hosts[0]!, password: 'changed-existing-credential-unsafe' }, f.hosts[1]!] })
    await f.service.request(f.tenant.id, { count: 2 }); await f.service.tick()
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ error: 'TRIAL_MACHINE_RETRY' })
  })
  it('rejects another trial ownership and collisions with normal tenant host addresses', async () => {
    const f = await fixture(), normal = await fixture()
    await db.trialRegistration.delete({ where: { id: normal.row.id } })
    f.provider.ensure.mockResolvedValueOnce({ ...f.lab(), trialId: randomUUID() })
    await f.service.request(f.tenant.id, { count: 2 }); await f.service.tick()
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    f.provider.ensure.mockResolvedValue({ ...f.lab(), hosts: [f.hosts[0]!, { ...f.hosts[1]!, ip: normal.host.ip }] })
    await f.service.tick()
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    expect(await db.host.findUnique({ where: { id: normal.host.id } })).toEqual(normal.host)
  })
  it('rolls back an injected post-insert failure and safely retries the reserved machine', async () => {
    const f = await fixture()
    const faulty = db.$extends({ query: { host: { async create({ args, query }) { await query(args); throw new Error('INJECTED_POLICY_FAILURE') } } } })
    await f.service.request(f.tenant.id, { count: 2 })
    await new TrialMachines(faulty as unknown as PrismaClient, f.provider).tick()
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    expect(await db.inventoryNode.count({ where: { tenantId: f.tenant.id, type: 'HOST' } })).toBe(1)
    await f.service.tick()
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(2)
  })
  it('does not create an inaccessible host when the inventory root is missing', async () => {
    const f = await fixture()
    await db.inventoryNode.update({ where: { id: f.root.id }, data: { rootTenantId: null } })
    await f.service.request(f.tenant.id, { count: 2 }); await f.service.tick()
    expect(await db.host.count({ where: { tenantId: f.tenant.id } })).toBe(1)
    expect(await f.service.resources(f.tenant.id, f.user.id)).toMatchObject({ error: 'TRIAL_MACHINE_RETRY' })
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
  })
  it('denies normal and expired tenants without invoking the provisioner', async () => {
    const f = await fixture()
    await db.trialRegistration.update({ where: { id: f.row.id }, data: { expiresAt: new Date(0) } })
    await expect(f.service.request(f.tenant.id, { count: 2 })).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    await db.trialRegistration.delete({ where: { id: f.row.id } })
    await expect(f.service.request(f.tenant.id, { count: 2 })).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    expect(f.provider.ensure).not.toHaveBeenCalled()
  })
})
