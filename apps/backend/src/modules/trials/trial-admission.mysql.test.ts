/** Opt-in: real disposable MySQL, no remote host or SMTP. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient, type TrialRegistration } from '@prisma/client'
import { TrialService, tokenHash } from './trial.service.js'
import type { TrialProfile } from './trial-contract.js'
import { SshRepository } from '../ssh/ssh.repository.js'

const url = process.env.TRIAL_MYSQL_TEST_URL
const integration = describe.skipIf(!url)
integration('trial live SQL session admission', () => {
  let db: PrismaClient
  let peer: PrismaClient
  let tenantId: number
  let userId: number
  let hostId: number
  let normalTenantId: number
  let normalUserId: number
  let normalHostId: number
  const trialId = randomUUID()
  const overlapIds: string[] = []

  beforeAll(async () => {
    const parsed = new URL(url!)
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(na0068|nodeaccess_test)/.test(parsed.pathname)) throw new Error('Disposable local trial database required')
    db = new PrismaClient({ datasources: { db: { url } } })
    peer = new PrismaClient({ datasources: { db: { url } } })
    await Promise.all([db.$connect(), peer.$connect()])
    const tenant = await db.tenant.create({ data: { name: 'Admission fixture', slug: `admission-${trialId}` } })
    tenantId = tenant.id
    const user = await db.user.create({ data: { tenantId, name: 'Admission visitor', email: `${trialId}@example.test` } })
    userId = user.id
    const host = await db.host.create({ data: { tenantId, name: 'Admission host', ip: '10.64.0.10', sshUser: 'visitor', authType: 'PASSWORD', scope: 'GLOBAL' } })
    hostId = host.id
    await db.trialRegistration.create({ data: { id: trialId, tenantId, name: 'Admission fixture', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000), privacyVersion: 'fixture', profileJson: { maxSessions: 2, maxUsers: 2 } } })
    const normal = await db.tenant.create({ data: { name: 'Ordinary fixture', slug: `ordinary-${trialId}` } })
    normalTenantId = normal.id
    normalUserId = (await db.user.create({ data: { tenantId: normalTenantId, name: 'Ordinary user', email: `ordinary-${trialId}@example.test` } })).id
    normalHostId = (await db.host.create({ data: { tenantId: normalTenantId, name: 'Ordinary host', ip: '10.64.1.10', sshUser: 'fixture', authType: 'PASSWORD', scope: 'GLOBAL' } })).id
  }, 30000)
  beforeEach(async () => {
    await db.session.deleteMany({ where: { hostId } })
    await db.trialRegistration.update({ where: { id: trialId }, data: { status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000) } })
  })
  afterAll(async () => {
    if (db) {
      // Fixture IDs only: never reset database, global profile or existing trials.
      const overlap = await db.trialRegistration.findMany({ where: { id: { in: overlapIds } }, select: { tenantId: true } })
      const tenants = [tenantId, normalTenantId, ...overlap.map(row => row.tenantId).filter((id): id is number => id !== null)].filter(Number.isInteger)
      await db.resourceAclEntry.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.inventoryNode.deleteMany({ where: { tenantId: { in: tenants }, type: 'HOST' } })
      await db.inventoryNode.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.license.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.session.deleteMany({ where: { host: { tenantId: { in: tenants } } } })
      await db.trialRegistration.deleteMany({ where: { id: { in: [trialId, ...overlapIds] } } })
      await db.host.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.user.deleteMany({ where: { tenantId: { in: tenants } } })
      await db.tenant.deleteMany({ where: { id: { in: tenants } } })
      await db.$disconnect()
    }
    await peer?.$disconnect()
  })

  it('admits exactly two of eight concurrent requests across independent SQL clients', async () => {
    const one = new SshRepository(db), two = new SshRepository(peer)
    const requests = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => (i % 2 ? one : two).startSession(userId, hostId, {}, tenantId)))
    expect(requests.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    const denied = requests.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(denied).toHaveLength(6)
    for (const rejection of denied) expect(rejection.reason).toMatchObject({ code: 'TRIAL_SESSION_LIMIT' })
    expect(await db.session.count({ where: { hostId, active: true } })).toBe(2)
  }, 30000)

  it('observes cancellation committed while admission waits for the same trial row lock', async () => {
    let release!: () => void
    let acquired!: () => void
    const locked = new Promise<void>(resolve => { acquired = resolve })
    const proceed = new Promise<void>(resolve => { release = resolve })
    const cancellation = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM trial_registrations WHERE id = ${trialId} FOR UPDATE`
      await tx.trialRegistration.update({ where: { id: trialId }, data: { status: 'EXPIRED' } })
      acquired()
      await proceed
    })
    await locked
    const attempt = new SshRepository(peer).startSession(userId, hostId, {}, tenantId)
    const result = Promise.allSettled([attempt])
    release()
    await cancellation
    expect((await result)[0]).toMatchObject({ status: 'rejected', reason: { code: 'TRIAL_EXPIRED' } })
    expect(await db.session.count({ where: { hostId } })).toBe(0)
  }, 30000)

  it('denies elapsed deadline without a cleanup worker and preserves ordinary admission', async () => {
    await db.trialRegistration.update({ where: { id: trialId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(new SshRepository(peer).startSession(userId, hostId, {}, tenantId)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    const sessionId = await new SshRepository(db).startSession(normalUserId, normalHostId)
    expect(sessionId).toBeGreaterThan(0)
    expect(await db.trialRegistration.findUnique({ where: { tenantId: normalTenantId } })).toBeNull()
    expect((await db.tenant.findUniqueOrThrow({ where: { id: normalTenantId } })).active).toBe(true)
  })

  it('cancels the user created after cancellation read an unactivated participant snapshot', async () => {
    const token = 'b'.repeat(64)
    const participant = await db.trialParticipant.create({ data: { id: randomUUID(), trialId, name: 'Race participant', email: `race-${trialId}@example.test`, verifiedAt: new Date(), verificationExpiresAt: new Date(Date.now()+60000), managementHash: tokenHash(token) } })
    const owner = new TrialService(db, { registrationsEnabled: false })
    const activation = new TrialService(peer, { registrationsEnabled: false })
    const controlled = owner as unknown as { managed: (token: string) => Promise<TrialRegistration> }
    const original = controlled.managed.bind(owner)
    let read!: () => void
    let release!: () => void
    const readDone = new Promise<void>(resolve => { read = resolve })
    const continueCancel = new Promise<void>(resolve => { release = resolve })
    const spy = vi.spyOn(controlled, 'managed').mockImplementation(async input => {
      const snapshot = await original(input)
      read()
      await continueCancel
      return snapshot
    })
    const cancellation = owner.cancel(token)
    try {
      await readDone
      await activation.activate(token, { password: 'Trial-Race-Password-2026', termsAccepted: true, privacyVersion: 'fixture' })
    } finally { release(); spy.mockRestore() }
    await cancellation
    const updated = await db.trialParticipant.findUniqueOrThrow({ where: { id: participant.id } })
    expect(updated.cancelledAt).not.toBeNull()
    expect(updated.userId).not.toBeNull()
    expect(await db.user.findUniqueOrThrow({ where: { id: updated.userId! } })).toMatchObject({ active: false, sessionVersion: 1 })
  }, 30000)

  it('rejects overlapping VM addresses across concurrent activation transactions', async () => {
    const profile: TrialProfile = { name: 'Overlap fixture', durationDays: 1, maxUsers: 2, maxHosts: 1, machineCount: 1, maxSessions: 1,
      templateId: 'fixture-v1', networkCidr: '10.250.68.0/24', maxActiveTrials: 100, retentionDays: 1,
      privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms', privacyVersion: 'fixture', resources: ['ssh'] }
    const provisioner = { ensure: (id: string) => Promise.resolve({ trialId: id, state: 'ready' as const, isolated: true as const, hosts: [{ name: 'Lab', ip: '10.250.68.44', port: 22, sshUser: 'visitor', password: 'Synthetic-test-secret-2026', fingerprint: `SHA256:${'a'.repeat(43)}` }] }), remove: () => Promise.resolve() }
    const rows: TrialRegistration[] = []
    for (let n = 0; n < 2; n++) {
      const id = randomUUID(); overlapIds.push(id)
      rows.push(await db.trialRegistration.create({ data: { id, email: `${id}@example.test`, name: 'Overlap fixture', status: 'PROVISIONING', verifiedAt: new Date(), profileJson: profile, privacyVersion: 'fixture' } }))
    }
    const services = [new TrialService(db, { registrationsEnabled: false, provisioner }), new TrialService(peer, { registrationsEnabled: false, provisioner })]
    const outcomes = await Promise.allSettled(services.map((service, i) => (service as unknown as { provision: (row: TrialRegistration) => Promise<void> }).provision(rows[i]!)))
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejection = outcomes.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejection?.reason).toMatchObject({ message: 'LAB_ADDRESS_ALREADY_ASSIGNED' })
    expect(await db.trialRegistration.count({ where: { id: { in: overlapIds }, status: 'ACTIVE' } })).toBe(1)
    expect(await db.host.count({ where: { ip: '10.250.68.44', deletedAt: null } })).toBe(1)
  }, 30000)

})
