import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { TrialService } from './trial.service.js'

const url = process.env.TRIAL_RETENTION_DATABASE_URL
const real = describe.skipIf(!url)
real('explicit full trial promotion with real MySQL locks', () => {
  let db: PrismaClient
  const tenants: number[] = []
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/na0074_retention') throw new Error('Isolated NA0074 schema required')
    db = new PrismaClient({ datasourceUrl: url! }); await db.$connect()
  })
  afterAll(async () => {
    if (!db) return
    const scoped = { in: tenants }
    await db.adminLog.deleteMany({ where: { admin: { tenantId: scoped } } })
    await db.trialRegistration.deleteMany({ where: { tenantId: scoped } })
    await db.host.deleteMany({ where: { tenantId: scoped } })
    await db.license.deleteMany({ where: { tenantId: scoped } })
    await db.user.deleteMany({ where: { tenantId: scoped } })
    await db.tenant.deleteMany({ where: { id: scoped } }); await db.$disconnect()
  })
  async function fixture() {
    const suffix = randomUUID()
    const tenant = await db.tenant.create({ data: { name: 'Synthetic trial', slug: `promotion-${suffix}` } }); tenants.push(tenant.id)
    const operatorTenant = await db.tenant.create({ data: { name: 'Synthetic normal', slug: `operator-${suffix}` } }); tenants.push(operatorTenant.id)
    const actor = await db.user.create({ data: { tenantId: operatorTenant.id, name: 'Synthetic operator', email: `operator-${suffix}@example.test`, isPlatformAdmin: true, role: 'ADMIN' } })
    const owner = await db.user.create({ data: { tenantId: tenant.id, name: 'Synthetic owner', email: `owner-${suffix}@example.test`, role: 'USER', passwordHash: 'preserve-synthetic-password-hash', mfaSecret: 'preserve-synthetic-mfa', mfaEnabled: true, sessionVersion: 7 } })
    const expiresAt = new Date(Date.now() + 3 * 86400_000)
    const profile = { name: 'Synthetic profile', resources: ['ssh', 'sftp', 'sharing', 'audit'], durationDays: 7, expiryNoticeHours: 6, maxUsers: 3, maxHosts: 4, machineCount: 1, maxMachines: 2, maxCustomHosts: 2, allowCustomHosts: true, maxSessions: 2, templateId: 'synthetic', networkCidr: '10.64.0.0/24', maxActiveTrials: 2, retentionDays: 30, privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms', privacyVersion: 'synthetic', hostAddresses: ['10.64.0.4'], requestedMachines: 1 }
    const trial = await db.trialRegistration.create({ data: { id: randomUUID(), tenantId: tenant.id, name: owner.name, email: owner.email, status: 'ACTIVE', activatedAt: new Date(), expiresAt, profileJson: profile, privacyVersion: 'synthetic' } })
    const license = await db.license.create({ data: { tenantId: tenant.id, maxUsers: 3, maxHosts: 4, expiresAt, maxActiveSessionsTenant: 2, maxActiveSessionsPerUser: 2 } })
    const host = await db.host.create({ data: { tenantId: tenant.id, ownerId: owner.id, name: 'Existing synthetic host', ip: '10.64.0.4', sshUser: 'demo', authType: 'PASSWORD', scope: 'PERSONAL', passwordEncrypted: 'preserve-synthetic-host-credential' } })
    const input = { trialId: trial.id, tenantId: tenant.id, ownerId: owner.id, actorId: actor.id }
    return { tenant, owner, actor, trial, license, host, input, service: new TrialService(db, { registrationsEnabled: true }) }
  }
  it('promotes once under concurrency without changing credentials, MFA, hosts, lifetime or normal administrator', async () => {
    const f = await fixture()
    const results = await Promise.all([f.service.promoteToFull(f.input), f.service.promoteToFull(f.input)])
    expect(results.map(row => row.changed).sort()).toEqual([false, true])
    const owner = await db.user.findUniqueOrThrow({ where: { id: f.owner.id } })
    expect(owner).toMatchObject({ role: 'ADMIN', isPlatformAdmin: false, canManageHosts: true, passwordHash: f.owner.passwordHash, mfaSecret: f.owner.mfaSecret, mfaEnabled: true, sessionVersion: 8, forcePasswordChange: f.owner.forcePasswordChange })
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    expect(await db.user.findUnique({ where: { id: f.actor.id } })).toEqual(f.actor)
    expect(await db.trialRegistration.findUnique({ where: { id: f.trial.id } })).toMatchObject({ expiresAt: f.trial.expiresAt, activatedAt: f.trial.activatedAt, profileJson: { experience: 'full', maxUsers: 3, maxHosts: 4, machineCount: 1, maxMachines: 1, maxCustomHosts: 3, maxSessions: 2, expiryNoticeHours: 24, requestedMachines: 1, hostAddresses: ['10.64.0.4'] } })
    expect(await db.license.findUnique({ where: { tenantId: f.tenant.id } })).toMatchObject({ expiresAt: f.license.expiresAt, maxUsers: 3, maxHosts: 4, multiConnect: true, maxActiveSessionsTenant: 2 })
    const logs = await db.adminLog.findMany({ where: { targetId: f.tenant.id, action: 'TRIAL_FULL_PROFILE_ENABLED' } })
    expect(logs).toHaveLength(1)
    expect(logs[0]!.details).not.toContain(f.owner.email)
    expect(await f.service.promoteToFull(f.input)).toEqual({ changed: false, tenantId: f.tenant.id })
  })
  it('refuses wrong tenant, wrong owner, non-platform actor and expired trial without partial writes', async () => {
    const f = await fixture()
    await expect(f.service.promoteToFull({ ...f.input, tenantId: f.actor.tenantId })).rejects.toThrow()
    await expect(f.service.promoteToFull({ ...f.input, ownerId: f.actor.id })).rejects.toThrow()
    await expect(f.service.promoteToFull({ ...f.input, actorId: f.owner.id })).rejects.toThrow()
    await db.trialRegistration.update({ where: { id: f.trial.id }, data: { expiresAt: new Date(Date.now() - 1) } })
    await expect(f.service.promoteToFull(f.input)).rejects.toThrow()
    expect(await db.user.findUnique({ where: { id: f.owner.id } })).toEqual(f.owner)
    expect(await db.host.findUnique({ where: { id: f.host.id } })).toEqual(f.host)
    expect(await db.license.findUnique({ where: { tenantId: f.tenant.id } })).toEqual(f.license)
    expect(await db.adminLog.count({ where: { targetId: f.tenant.id, action: 'TRIAL_FULL_PROFILE_ENABLED' } })).toBe(0)
  })
})
