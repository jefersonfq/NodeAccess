/** Opt-in own disposable SQL fixtures only; never opens connections to public destinations. */
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { TrialCustomHosts, revokeTrialPemKeys } from './trial-custom-hosts.js'
import { decrypt } from '../../shared/crypto.js'
import { InventoryAclRepository } from '../inventory/inventory-acl.repository.js'

const enabled = process.env.TRIAL_CUSTOM_MYSQL === '1'
describe.skipIf(!enabled)('custom trial host real SQL isolation', () => {
  const db = new PrismaClient()
  const id = randomUUID()
  const hosts = new TrialCustomHosts(db, { protectedAddresses: ['9.9.9.9'] })
  let tenantId: number, ownerId: number, peerId: number, demoId: number
  let privateKey: string
  const input = { name: 'Own server', ip: '8.8.8.8', port: 22, sshUser: 'customer', authType: 'password', password: 'Synthetic-test-only' }
  const profile = { resources: ['ssh','sftp'], allowCustomHosts: true, maxCustomHosts: 2, maxHosts: 4, machineCount: 1, requestedMachines: 2, hostAddresses: ['10.250.68.10'] }
  async function removeCustom() {
    await db.session.deleteMany({ where: { host: { tenantId } } })
    await db.resourceAclEntry.deleteMany({ where: { tenantId, inventoryNode: { host: { scope: 'PERSONAL' } } } })
    await db.inventoryNode.deleteMany({ where: { tenantId, host: { scope: 'PERSONAL' } } })
    await db.host.deleteMany({ where: { tenantId, scope: 'PERSONAL' } })
    await db.pemKey.deleteMany({ where: { createdById: { in: [ownerId, peerId] } } })
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!)
    if (url.hostname !== '127.0.0.1' || url.port !== '32770' || !['/na0068', '/na0074_retention'].includes(url.pathname)) throw Error('Disposable local MySQL required')
    tenantId = (await db.tenant.create({ data: { name: 'Custom host fixture', slug: `custom-${id}` } })).id
    ownerId = (await db.user.create({ data: { tenantId, name: 'Owner', email: `owner-${id}@example.test` } })).id
    peerId = (await db.user.create({ data: { tenantId, name: 'Peer', email: `peer-${id}@example.test` } })).id
    const root = await db.inventoryNode.create({ data: { tenantId, rootTenantId: tenantId, type: 'ROOT', name: '__root__', path: '/', depth: 0 } })
    await db.resourceAclEntry.create({ data: { tenantId, inventoryNodeId: root.id, principalType: 'ROLE', principalId: 1, canView: true, canConnect: true, inheritToChildren: true, createdById: ownerId } })
    demoId = (await db.host.create({ data: { tenantId, ownerId, scope: 'GLOBAL', name: 'Demo', ip: profile.hostAddresses[0]!, sshUser: 'demo', authType: 'PASSWORD' } })).id
    const node = await db.inventoryNode.create({ data: { tenantId, parentId: root.id, type: 'HOST', hostId: demoId, name: 'Demo', path: '', depth: 1 } })
    await db.inventoryNode.update({ where: { id: node.id }, data: { path: `/${node.id}/` } })
    await db.trialRegistration.create({ data: { id, tenantId, name: 'Custom fixture', privacyVersion: 'test', status: 'ACTIVE', expiresAt: new Date(Date.now()+3600000), profileJson: profile } })
    privateKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey
  })
  beforeEach(async () => {
    await removeCustom()
    await db.trialRegistration.update({ where: { id }, data: { status: 'ACTIVE', expiresAt: new Date(Date.now()+3600000), profileJson: profile } })
    await db.user.update({ where: { id: ownerId }, data: { active: true } })
  })
  afterAll(async () => {
    if (tenantId) {
      await removeCustom()
      await db.resourceAclEntry.deleteMany({ where: { tenantId } })
      await db.inventoryNode.deleteMany({ where: { tenantId, type: 'HOST' } })
      await db.inventoryNode.deleteMany({ where: { tenantId } })
      await db.host.deleteMany({ where: { tenantId } })
      await db.trialRegistration.delete({ where: { id } })
      await db.user.deleteMany({ where: { tenantId } })
      await db.tenant.delete({ where: { id: tenantId } })
    }
    await db.$disconnect()
  })
  it('admits only two concurrent custom hosts and reserves future requested demo slots', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => hosts.create(tenantId, ownerId, input)))
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2)
    for (const rejected of results.filter((r): r is PromiseRejectedResult=>r.status==='rejected')) expect(rejected.reason).toMatchObject({ code: 'TRIAL_HOST_LIMIT' })
    expect(await hosts.listCount(tenantId, ownerId)).toEqual({ count: 2, maxCustomHosts: 2, remaining: 0 })
  })
  it('removes inherited demo access from personal hosts while both participants retain demo access', async () => {
    const created = await hosts.create(tenantId, ownerId, input)
    const acl = new InventoryAclRepository(db)
    expect(await acl.findEffectiveHostPermissions([created.id], tenantId, ownerId)).toMatchObject([{ hostId: created.id, canView: 1, canConnect: 1, canEdit: 1 }])
    expect(await acl.findEffectiveHostPermissions([created.id], tenantId, peerId)).toEqual([])
    for (const userId of [ownerId, peerId]) expect(await acl.findEffectiveHostPermissions([demoId], tenantId, userId)).toMatchObject([{ canView: 1, canConnect: 1, canEdit: 0 }])
    const stored = await db.host.findUniqueOrThrow({ where: { id: created.id } })
    expect(stored.scope).toBe('PERSONAL'); expect(stored.ownerId).toBe(ownerId)
    expect(stored.passwordEncrypted).not.toContain(input.password)
    const credentials = JSON.parse(stored.passwordEncrypted!) as { encrypted: string; iv: string }
    expect(decrypt(credentials)).toBe(input.password)
  })
  it('keeps owner boundaries, requires idle SSH for mutations and resets trust on destination edit', async () => {
    const created = await hosts.create(tenantId, ownerId, input)
    await expect(hosts.update(tenantId, peerId, created.id, input)).rejects.toMatchObject({ statusCode: 404 })
    await expect(hosts.remove(tenantId, ownerId, demoId)).rejects.toMatchObject({ statusCode: 404 })
    const session = await db.session.create({ data: { userId: ownerId, hostId: created.id } })
    await expect(hosts.update(tenantId, ownerId, created.id, input)).rejects.toMatchObject({ code: 'TRIAL_HOST_IN_USE' })
    await expect(hosts.remove(tenantId, ownerId, created.id)).rejects.toMatchObject({ code: 'TRIAL_HOST_IN_USE' })
    await db.session.update({ where: { id: session.id }, data: { active: false } })
    await db.host.update({ where: { id: created.id }, data: { trustedHostKeyFingerprint: 'fixture' } })
    await hosts.update(tenantId, ownerId, created.id, { ...input, ip: '1.1.1.1', password: undefined })
    expect((await db.host.findUniqueOrThrow({ where: { id: created.id } })).trustedHostKeyFingerprint).toBeNull()
    await hosts.remove(tenantId, ownerId, created.id)
    expect(await db.host.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ passwordEncrypted: null, pemKeyId: null })
    expect((await hosts.listCount(tenantId, ownerId)).count).toBe(0)
  })
  it('encrypts dedicated PEM and removes it after switching back to password', async () => {
    const created = await hosts.create(tenantId, ownerId, { ...input, password: undefined, authType: 'pem', privateKey })
    const stored = await db.host.findUniqueOrThrow({ where: { id: created.id } })
    const key = await db.pemKey.findUniqueOrThrow({ where: { id: stored.pemKeyId! } })
    expect(key.createdById).toBe(ownerId); expect(key.encryptedKey).not.toContain('PRIVATE KEY')
    expect(decrypt({ encrypted: key.encryptedKey, iv: key.iv })).toBe(privateKey)
    await hosts.update(tenantId, ownerId, created.id, input)
    expect(await db.pemKey.findUnique({ where: { id: key.id } })).toBeNull()
  })
  it('rejects workerless expiry, cancellation, normal tenant and disabled profile without writing', async () => {
    await db.trialRegistration.update({ where: { id }, data: { expiresAt: new Date(Date.now()-1) } })
    await expect(hosts.create(tenantId, ownerId, input)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    await db.trialRegistration.update({ where: { id }, data: { expiresAt: new Date(Date.now()+60000) } })
    await db.user.update({ where: { id: ownerId }, data: { active: false } })
    await expect(hosts.create(tenantId, ownerId, input)).rejects.toMatchObject({ code: 'TRIAL_USER_REVOKED' })
    await db.user.update({ where: { id: ownerId }, data: { active: true } })
    await db.trialRegistration.update({ where: { id }, data: { profileJson: { ...profile, allowCustomHosts: false } } })
    await expect(hosts.create(tenantId, ownerId, input)).rejects.toMatchObject({ code: 'TRIAL_CUSTOM_HOSTS_DISABLED' })
    await expect(hosts.create(-1, ownerId, input)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    expect(await db.host.count({ where: { tenantId } })).toBe(1)
  })
  it('revokes only trial-owned PEM and preserves keys referenced by a normal tenant', async () => {
    const own = await hosts.create(tenantId, ownerId, { ...input, password: undefined, authType: 'pem', privateKey })
    const shared = await hosts.create(tenantId, ownerId, { ...input, password: undefined, authType: 'pem', privateKey })
    const ownHost = await db.host.findUniqueOrThrow({ where: { id: own.id } })
    const sharedHost = await db.host.findUniqueOrThrow({ where: { id: shared.id } })
    const normal = await db.tenant.create({ data: { name: 'PEM preservation fixture', slug: `pem-normal-${randomUUID()}` } })
    try {
      await db.host.create({ data: { tenantId: normal.id, name: 'Normal reference', ip: '1.1.1.1', sshUser: 'normal', scope: 'GLOBAL', authType: 'PEM', pemKeyId: sharedHost.pemKeyId } })
      expect(await db.$transaction(tx => revokeTrialPemKeys(tx, normal.id))).toBe(0)
      expect(await db.$transaction(tx => revokeTrialPemKeys(tx, tenantId))).toBe(1)
      expect(await db.pemKey.findUniqueOrThrow({ where: { id: ownHost.pemKeyId! } })).toMatchObject({ encryptedKey: '', iv: '', encryptedPassphrase: null })
      expect((await db.pemKey.findUniqueOrThrow({ where: { id: sharedHost.pemKeyId! } })).encryptedKey).not.toBe('')
    } finally { await db.host.deleteMany({ where: { tenantId: normal.id } }); await db.tenant.delete({ where: { id: normal.id } }) }
  })
  it('fails closed when protected control-plane addresses are not configured', async () => {
    await expect(new TrialCustomHosts(db).create(tenantId, ownerId, input)).rejects.toMatchObject({ statusCode: 503, code: 'TRIAL_CUSTOM_HOSTS_UNAVAILABLE' })
    expect(await db.host.count({ where: { tenantId } })).toBe(1)
  })
  it('rejects deleted or invalid inventory roots without creating a host or key', async () => {
    const rootNode = await db.inventoryNode.findUniqueOrThrow({ where: { rootTenantId: tenantId } })
    try {
      for (const mutation of [{ deletedAt: new Date() }, { type: 'FOLDER' as const }]) {
        await db.inventoryNode.update({ where: { id: rootNode.id }, data: { type: 'ROOT', deletedAt: null, ...mutation } })
        await expect(hosts.create(tenantId, ownerId, input)).rejects.toMatchObject({ code: 'TRIAL_INVENTORY_UNAVAILABLE' })
        expect(await db.host.count({ where: { tenantId } })).toBe(1)
        expect(await db.pemKey.count({ where: { createdById: ownerId } })).toBe(0)
      }
    } finally { await db.inventoryNode.update({ where: { id: rootNode.id }, data: { type: 'ROOT', deletedAt: null } }) }
  })
  it('blocks protected IP, extra destinations/secrets and malformed keys before mutations', async () => {
    for (const payload of [{ ...input, ip: '9.9.9.9' }, { ...input, ip: '127.0.0.1' }, { ...input, bastionId: 1 }, { ...input, passwordSecretId: 1 }, { ...input, authType: 'pem', password: undefined, privateKey: 'invalid' }]) await expect(hosts.create(tenantId, ownerId, payload)).rejects.toThrow()
    expect(await db.host.count({ where: { tenantId } })).toBe(1)
  })
})
