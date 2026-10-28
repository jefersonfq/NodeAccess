/** Local SQL only: no SMTP, provisioner or production resources. */
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { trialRoutes } from './trial.routes.js'
import type { AuthRateLimitService } from '../auth/auth-rate-limit.service.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { TrialService, tokenHash } from './trial.service.js'
import type { TrialProfile } from './trial-contract.js'
const connection = process.env.TRIAL_MYSQL_TEST_URL
const profile: TrialProfile = { name: 'Lifecycle fixture', durationDays: 7, expiryNoticeHours: 24, maxUsers: 3, maxHosts: 1,
  machineCount: 1, maxSessions: 2, templateId: 'fixture', networkCidr: '10.64.0.0/24', maxActiveTrials: 15,
  retentionDays: 17, privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms', privacyVersion: 'fixture-v1', resources: ['ssh'], lifecycleNoticeVersion: 'trial-lifecycle-v1' }
const password = 'Synthetic-lifecycle-2026'
describe.skipIf(!connection)('trial lifecycle acknowledgement in real SQL', () => {
  let db: PrismaClient
  let service: TrialService
  const tenants: number[] = []
  beforeAll(async () => {
    const url = new URL(connection!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/nodeaccess_test_na0079') throw new Error('Use the isolated local NA0079 schema')
    db = new PrismaClient({ datasourceUrl: connection! }); await db.$connect()
    service = new TrialService(db, { registrationsEnabled: false })
  })
  afterAll(async () => {
    if (!db) return
    await db.trialRegistration.deleteMany({ where: { tenantId: { in: tenants } } })
    await db.user.deleteMany({ where: { tenantId: { in: tenants } } })
    await db.tenant.deleteMany({ where: { id: { in: tenants } } }); await db.$disconnect()
  })
  async function fixture(legacy = false) {
    const id = randomUUID(), token = randomUUID().replaceAll('-', '').repeat(2)
    const tenant = await db.tenant.create({ data: { name: 'Synthetic lifecycle', slug: `lifecycle-${id}` } }); tenants.push(tenant.id)
    const email = `${id}@example.test`
    const user = await db.user.create({ data: { name: 'Synthetic owner', email, tenantId: tenant.id, active: false, passwordHash: null } })
    const expiresAt = new Date(Date.now() + 3600_000)
    const old = { ...profile }; delete old.lifecycleNoticeVersion
    const trial = await db.trialRegistration.create({ data: { id, tenantId: tenant.id, name: 'Synthetic owner', email,
      status: 'ACTIVE', expiresAt, managementHash: tokenHash(token), privacyVersion: profile.privacyVersion,
      profileJson: legacy ? old : profile, marketingConsent: false, researchConsent: false } })
    const acknowledgement = { accepted: true, version: 'trial-lifecycle-v1', expiresAt: expiresAt.toISOString(), retentionDays: 17 }
    return { trial, user, token, acknowledgement }
  }
  it('rejects missing/stale policy before activating, with no consent or preference change', async () => {
    const f = await fixture()
    await expect(service.activate(f.token, { password })).rejects.toMatchObject({ statusCode: 422 })
    await expect(service.activate(f.token, { password, lifecycleAcknowledgement: { ...f.acknowledgement, expiresAt: new Date(0).toISOString() } })).rejects.toMatchObject({ statusCode: 422 })
    expect(await db.user.findUnique({ where: { id: f.user.id } })).toMatchObject({ active: false, passwordHash: null })
    expect(await db.trialConsentEvent.count({ where: { trialId: f.trial.id } })).toBe(0)
    expect(await db.trialRegistration.findUnique({ where: { id: f.trial.id } })).toMatchObject({ marketingConsent: false, researchConsent: false, activatedAt: null })
  })
  it('concurrent activation persists exactly one immutable snapshot and keeps expiry/preferences', async () => {
    const f = await fixture()
    const results = await Promise.allSettled([1, 2].map(() => service.activate(f.token, { password, lifecycleAcknowledgement: f.acknowledgement })))
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    const events = await db.trialConsentEvent.findMany({ where: { trialId: f.trial.id } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'LIFECYCLE_ACK', participantId: null, marketing: false, research: false,
      metadataJson: { noticeVersion: 'trial-lifecycle-v1', expiresAt: f.trial.expiresAt!.toISOString(), retentionDays: 17,
        retentionStarts: 'closedAt', externalMachinesDeleted: false, backupsSeparate: true } })
    expect(await db.trialRegistration.findUnique({ where: { id: f.trial.id } })).toMatchObject({ expiresAt: f.trial.expiresAt, marketingConsent: false, researchConsent: false })
    expect(await service.status(f.token)).toMatchObject({ activated: true, lifecycleAcknowledgementRequired: false, retentionDays: 17 })
    expect(await service.status(f.token)).not.toHaveProperty('metadataJson')
  })
  it('public HTTP status and activation enforce acknowledgement without exposing event metadata', async () => {
    const f = await fixture()
    const app = Fastify()
    await app.register(jwt, { secret: 'synthetic-lifecycle-test-signing-key' })
    const limiter = { check: vi.fn(async (): Promise<void> => {}) } as unknown as AuthRateLimitService
    await app.register(async scope => trialRoutes(scope, service, limiter), { prefix: '/api/v1' })
    try {
      const headers = { authorization: `Bearer ${f.token}` }
      const status = await app.inject({ url: '/api/v1/trials/public/status', headers })
      expect(status.statusCode).toBe(200)
      expect(status.json()).toMatchObject({ lifecycleAcknowledgementRequired: true, retentionDays: 17, lifecycleNoticeVersion: 'trial-lifecycle-v1' })
      expect(status.json()).not.toHaveProperty('metadataJson')
      const denied = await app.inject({ method: 'POST', url: '/api/v1/trials/public/activate', headers, payload: { password } })
      expect(denied.statusCode).toBe(422)
      const accepted = await app.inject({ method: 'POST', url: '/api/v1/trials/public/activate', headers, payload: { password, lifecycleAcknowledgement: f.acknowledgement } })
      expect(accepted.statusCode).toBe(200)
      expect(await db.trialConsentEvent.count({ where: { trialId: f.trial.id, kind: 'LIFECYCLE_ACK' } })).toBe(1)
    } finally { await app.close() }
  })

  it('legacy snapshots activate without a checkbox and do not create retrospective evidence', async () => {
    const f = await fixture(true)
    expect(await service.status(f.token)).toMatchObject({ lifecycleNoticeVersion: null, lifecycleAcknowledgementRequired: false })
    await service.activate(f.token, { password })
    expect(await db.trialConsentEvent.count({ where: { trialId: f.trial.id } })).toBe(0)
  })
  it('invited participant records their own acknowledgement without changing owner choices', async () => {
    const f = await fixture(); const guestToken = 'ef'.repeat(32)
    const guest = await db.trialParticipant.create({ data: { id: randomUUID(), trialId: f.trial.id, name: 'Synthetic guest', email: `${randomUUID()}@example.test`,
      verificationExpiresAt: new Date(Date.now() + 3600_000), verifiedAt: new Date(), managementHash: tokenHash(guestToken) } })
    await service.activate(guestToken, { password, lifecycleAcknowledgement: f.acknowledgement, termsAccepted: true, privacyVersion: profile.privacyVersion })
    expect(await db.trialConsentEvent.findFirst({ where: { trialId: f.trial.id, participantId: guest.id, kind: 'LIFECYCLE_ACK' } })).toMatchObject({ marketing: false, research: false, metadataJson: { retentionDays: 17 } })
    expect(await db.trialRegistration.findUnique({ where: { id: f.trial.id } })).toMatchObject({ activatedAt: null, marketingConsent: false, researchConsent: false })
    expect(await db.trialParticipant.findUnique({ where: { id: guest.id } })).toMatchObject({ marketingConsent: false, researchConsent: false })
  })
})
