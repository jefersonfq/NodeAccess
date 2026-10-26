/** Real disposable SQL: normal CRUD, concurrent quotas, explicit target promotion. */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { configureTrialPolicy, configureTrialProtectedAddresses } from './trial-policy.js'
import { configureTrialAiQuota, reserveTrialAiRequest } from './trial-ai-quota.js'
import { withUserSlot } from '../../shared/user-quota.js'
import { HostRepository } from '../hosts/host.repository.js'
import { HostBulkActionRepository } from '../hosts/host-bulk-action.repository.js'
import { TagRepository } from '../tags/tag.repository.js'
import { TrialService } from './trial.service.js'
import { trialProfileSchema } from './trial-contract.js'

const url = process.env.TRIAL_MYSQL_TEST_URL
const run = randomUUID()
describe.skipIf(!url)('full trial real SQL', () => {
  let db: PrismaClient, peer: PrismaClient, tenantId: number, ownerId: number, demoId: number, rootId: number, normalTenant: number, operatorId: number
  const trialId = randomUUID()
  const profile = trialProfileSchema.parse({ name: 'Full fixture', durationDays: 7, maxUsers: 3, maxHosts: 4, machineCount: 1, maxMachines: 2, allowCustomHosts: true, maxCustomHosts: 2, maxSessions: 2, templateId: 'fixture', networkCidr: '10.91.0.0/24', maxActiveTrials: 2, retentionDays: 30, privacyUrl: 'https://example.invalid/privacy', termsUrl: 'https://example.invalid/terms', privacyVersion: 'fixture', resources: ['ssh','sftp','sharing','audit'] })
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/nodeaccess_test_na0074') throw new Error('Dedicated NA0074 disposable database required')
    db = new PrismaClient({ datasources: { db: { url } } }); peer = new PrismaClient({ datasources: { db: { url } } })
    tenantId = (await db.tenant.create({ data: { name: 'Full fixture', slug: `full-${run}` } })).id
    normalTenant = (await db.tenant.create({ data: { name: 'Normal fixture', slug: `normal-${run}` } })).id
    operatorId = (await db.user.create({ data: { tenantId: normalTenant, name: 'Operator fixture', email: `operator-${run}@example.invalid`, role: 'ADMIN', isPlatformAdmin: true } })).id
    ownerId = (await db.user.create({ data: { tenantId, name: 'Owner fixture', email: `owner-${run}@example.invalid`, passwordHash: 'fixture-password-hash', mfaEnabled: true, mfaSecret: 'fixture-encrypted-mfa', role: 'USER' } })).id
    rootId = (await db.inventoryNode.create({ data: { tenantId, rootTenantId: tenantId, type: 'ROOT', name: '__root__', path: '/', depth: 0 } })).id
    demoId = (await db.host.create({ data: { tenantId, ownerId, name: 'Demo fixture', ip: '10.91.0.5', port: 22, sshUser: 'visitor', authType: 'PASSWORD', scope: 'GLOBAL', passwordEncrypted: 'fixture-demo-secret' } })).id
    await db.license.create({ data: { tenantId, maxUsers: 3, maxHosts: 4, active: true } })
    await db.trialRegistration.create({ data: { id: trialId, tenantId, name: 'Owner fixture', email: `owner-${run}@example.invalid`, activatedAt: new Date(), status: 'ACTIVE', expiresAt: new Date(Date.now()+86400000), privacyVersion: 'fixture', profileJson: { ...profile, hostAddresses: ['10.91.0.5'] } } })
    configureTrialPolicy(id => db.trialRegistration.findUnique({ where: { tenantId: id } }))
    configureTrialProtectedAddresses(['9.9.9.9']); configureTrialAiQuota(db)
  })
  afterAll(async () => {
    configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([])
    if (db) {
      await db.adminLog.deleteMany({ where: { adminId: operatorId } })
      await db.trialParticipant.deleteMany({ where: { trialId } })
      await db.trialRegistration.deleteMany({ where: { id: trialId } })
      await db.inventoryNode.deleteMany({ where: { tenantId, type: 'HOST' } })
      await db.inventoryNode.deleteMany({ where: { tenantId } })
      await db.host.deleteMany({ where: { tenantId } })
      await db.license.deleteMany({ where: { tenantId } })
      await db.user.deleteMany({ where: { tenantId: { in: [tenantId, normalTenant] } } })
      await db.tenant.deleteMany({ where: { id: { in: [tenantId, normalTenant] } } })
      await db.$disconnect(); await peer.$disconnect()
    }
  })
  it('promotes only the explicit trial owner, preserving credentials, host and deadline; repeated conversion is a no-op', async () => {
    const service = new TrialService(db, { registrationsEnabled: true })
    const before = await db.trialRegistration.findUniqueOrThrow({ where: { id: trialId } })
    const user = await db.user.findUniqueOrThrow({ where: { id: ownerId } })
    const host = await db.host.findUniqueOrThrow({ where: { id: demoId } })
    const input = { trialId, tenantId, ownerId, actorId: operatorId }
    await expect(service.promoteToFull({ ...input, actorId: ownerId })).rejects.toThrow()
    await expect(service.promoteToFull({ ...input, tenantId: normalTenant })).rejects.toThrow()
    const expected = { expiresAt: before.expiresAt!.toISOString(), profileJson: before.profileJson, sessionVersion: user.sessionVersion, ownerUpdatedAt: user.updatedAt.toISOString() }
    await expect(service.promoteToFull({ ...input, expected: { ...expected, sessionVersion: user.sessionVersion + 1 } })).rejects.toThrow('snapshot')
    await expect(service.promoteToFull({ ...input, expected })).resolves.toEqual({ changed: true, tenantId })
    await expect(service.promoteToFull(input)).resolves.toEqual({ changed: false, tenantId })
    const after = await db.user.findUniqueOrThrow({ where: { id: ownerId } })
    expect(after).toMatchObject({ role: 'ADMIN', isPlatformAdmin: false, canManageHosts: true, passwordHash: user.passwordHash, mfaSecret: user.mfaSecret, mfaEnabled: true, sessionVersion: user.sessionVersion + 1 })
    expect(await db.host.findUnique({ where: { id: demoId } })).toEqual(host)
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: trialId } })).expiresAt).toEqual(before.expiresAt)
    const license = await db.license.findUniqueOrThrow({ where: { tenantId } })
    expect(license.featureEntitlementsJson).toMatchObject({ agents: true, secrets: true, snippets: true, portForwarding: true, localAi: true, mcp: true })
    expect(await db.adminLog.count({ where: { adminId: operatorId, action: 'TRIAL_FULL_PROFILE_ENABLED' } })).toBe(1)
    expect((await db.user.findUniqueOrThrow({ where: { id: operatorId } })).isPlatformAdmin).toBe(true)
  })
  it('ordinary host repository admits exactly three own hosts across eight concurrent transactions', async () => {
    const make = (database: PrismaClient) => new HostRepository(database, new TagRepository(database))
    const first = make(db), second = make(peer)
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).create({ tenantId, ownerId, inventoryParentId: rootId, name: `Own ${i}`, ip: `8.8.8.${i+1}`, port: 22, sshUser: 'fixture', authType: 'PASSWORD', scope: 'PERSONAL', accessProtocol: 'SSH', operatingSystem: 'LINUX', connectionMode: 'DIRECT' })))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(3)
    expect(await db.host.count({ where: { tenantId, deletedAt: null } })).toBe(4)
    for (const result of attempts) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'TRIAL_HOST_LIMIT' })
    await expect(first.delete(demoId)).rejects.toMatchObject({ code: 'TRIAL_MANAGED_HOST' })
    await expect(new HostBulkActionRepository(db).applyAction([demoId], tenantId, { type: 'set_bastion', bastionId: null }, ownerId)).rejects.toMatchObject({ code: 'TRIAL_MANAGED_HOST' })
    expect((await db.host.findUniqueOrThrow({ where: { id: demoId } })).deletedAt).toBeNull()
  })
  it('administrative user creation counts invitation reservations in concurrent transactions', async () => {
    await db.trialParticipant.create({ data: { id: randomUUID(), trialId, email: `invite-${run}@example.invalid`, name: 'Pending fixture', verificationExpiresAt: new Date(Date.now()+3600000) } })
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => withUserSlot(i%2 ? db : peer, tenantId, tx => tx.user.create({ data: { tenantId, name: 'Member fixture', email: `member-${i}-${run}@example.invalid` } }))))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await db.user.count({ where: { tenantId, active: true } })).toBe(2)
    for (const result of attempts) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'TRIAL_USER_LIMIT' })
  })
  it('AI concurrency is shared across requests and the lifetime budget cannot be reset by release', async () => {
    const row = await db.trialRegistration.findUniqueOrThrow({ where: { id: trialId } })
    await db.trialRegistration.update({ where: { id: trialId }, data: { profileJson: { ...(row.profileJson as object), maxAiRequests: 2, maxAiConcurrentRequests: 1 } } })
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => reserveTrialAiRequest(tenantId)))
    const accepted = attempts.filter(result => result.status === 'fulfilled')
    expect(accepted).toHaveLength(1)
    for (const item of accepted) if (item.status === 'fulfilled') await item.value()
    await (await reserveTrialAiRequest(tenantId))()
    await expect(reserveTrialAiRequest(tenantId)).rejects.toMatchObject({ code: 'TRIAL_AI_LIMIT' })
  })
})
