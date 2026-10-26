/** Opt-in real SQL integration. SMTP and VM provisioner are simulated; no external hosts. */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient, type Prisma } from '@prisma/client'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { TrialService } from './trial.service.js'
import { trialRoutes } from './trial.routes.js'
import { assertTrialAccess, configureTrialPolicy, configureTrialUserReader, assertTrialUserAccess, assertTrialHostAccess } from './trial-policy.js'
import { SshRepository } from '../ssh/ssh.repository.js'
import { InventoryAclRepository } from '../inventory/inventory-acl.repository.js'
import type { TrialProfile, TrialLab } from './trial-contract.js'
import type { AuthRateLimitService } from '../auth/auth-rate-limit.service.js'

const url = process.env.TRIAL_MYSQL_TEST_URL
const integration = describe.skipIf(!url)
const run = `trial-sql-${randomUUID().slice(0, 8)}`
const profile: TrialProfile = { name: 'SQL fixture', durationDays: 7, maxUsers: 2, maxHosts: 1, machineCount: 1, maxSessions: 2,
  templateId: 'linux-v1', networkCidr: '10.64.0.0/24', maxActiveTrials: 10, retentionDays: 30, expiryNoticeHours: 6,
  privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms', privacyVersion: 'test-v1', resources: ['ssh', 'sftp', 'sharing'] }
const password = 'Sql-Fixture-Password-2026'

integration('trial real MySQL transactions (fake SMTP and VM infrastructure)', () => {
  let db: PrismaClient
  let peer: PrismaClient
  let service: TrialService
  let servicePeer: TrialService
  let standardTenantId: number
  let standardUserId: number
  let savedProfile: Prisma.JsonValue | undefined
  const ids = new Set<string>()
  const mails: { to: string; link: string }[] = []
  let sequence = 0
  const mailer = { send: vi.fn((to: string, link: string): Promise<void> => { mails.push({ to, link }); return Promise.resolve() }) }
  const provisioner = {
    ensure: vi.fn((id: string): Promise<TrialLab> => Promise.resolve({ trialId: id, state: 'ready', isolated: true, hosts: [{ name: 'Demo Linux', ip: '10.64.0.10', port: 22, sshUser: 'visitor', password: 'Synthetic-host-password-2026', fingerprint: `SHA256:${'a'.repeat(43)}` }] })),
    remove: vi.fn(async (_id: string): Promise<void> => {}),
  }
  const email = (label: string): string => `${run}-${label}-${++sequence}@example.test`
  const latestToken = (to: string): string => {
    const message = mails.filter(m => m.to === to).at(-1)
    if (!message) throw new Error('Expected simulated SMTP delivery')
    return new URLSearchParams(new URL(message.link).hash.slice(1)).get('token')!
  }
  async function registered(label: string, phone?: string): Promise<{ id: string; email: string; token: string }> {
    const address = email(label)
    await service.register({ name: 'SQL Visitor', phone, email: address, termsAccepted: true, privacyVersion: profile.privacyVersion, marketingConsent: false, researchConsent: false })
    const row = await db.trialRegistration.findUniqueOrThrow({ where: { email: address } })
    ids.add(row.id)
    return { id: row.id, email: address, token: latestToken(address) }
  }
  async function ready(label: string, phone?: string): Promise<{ id: string; email: string; token: string; tenantId: number; userId: number }> {
    const row = await registered(label, phone)
    const { accessToken } = await service.verify(row.token)
    await service.tick()
    const trial = await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })
    expect(trial.status).toBe('ACTIVE')
    expect(trial.tenantId).not.toBeNull()
    await service.activate(accessToken, { password })
    const user = await db.user.findFirstOrThrow({ where: { tenantId: trial.tenantId!, email: row.email } })
    return { ...row, token: accessToken, tenantId: trial.tenantId!, userId: user.id }
  }
  beforeAll(async () => {
    const parsed = new URL(url!)
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(na0068|nodeaccess_test)/.test(parsed.pathname)) throw new Error('Use an explicitly disposable local trial test database')
    db = new PrismaClient({ datasources: { db: { url } } })
    peer = new PrismaClient({ datasources: { db: { url } } })
    await Promise.all([db.$connect(), peer.$connect()])
    savedProfile = (await db.trialProfile.findUnique({ where: { id: 1 } }))?.configJson
    service = new TrialService(db, { registrationsEnabled: true, publicUrl: 'https://demo.example.test', mailer, provisioner })
    servicePeer = new TrialService(peer, { registrationsEnabled: true, publicUrl: 'https://demo.example.test', mailer, provisioner })
    const tenant = await db.tenant.create({ data: { name: 'Normal SQL fixture', slug: run, active: true } })
    standardTenantId = tenant.id
    const user = await db.user.create({ data: { tenantId: tenant.id, email: email('normal'), name: 'Normal administrator', role: 'ADMIN', active: true, canManageHosts: true } })
    standardUserId = user.id
    await db.license.create({ data: { tenantId: tenant.id, maxUsers: 5, maxHosts: 5, active: true } })
    await service.updateProfile(profile, standardUserId)
    configureTrialPolicy(tenantId => db.trialRegistration.findUnique({ where: { tenantId } }))
    configureTrialUserReader(async (tenantId, userId, sessionVersion) => !!await db.user.findFirst({ where: { id: userId, tenantId, active: true, deletedAt: null, ...(sessionVersion === undefined ? {} : { sessionVersion }) } }))
  }, 30_000)
  afterEach(async () => {
    provisioner.ensure.mockReset().mockImplementation(id => Promise.resolve({ trialId: id, state: 'ready', isolated: true, hosts: [{ name: 'Demo Linux', ip: '10.64.0.10', port: 22, sshUser: 'visitor', password: 'Synthetic-host-password-2026', fingerprint: `SHA256:${'a'.repeat(43)}` }] }))
    provisioner.remove.mockReset().mockResolvedValue(undefined)
    for (const id of ids) await service.cancelById(id)
    await service.tick()
    await service.updateProfile(profile, standardUserId)
  })
  afterAll(async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    configureTrialUserReader(() => Promise.resolve(true))
    if (db) {
      if (savedProfile) await db.trialProfile.update({ where: { id: 1 }, data: { configJson: savedProfile } })
      await db.$disconnect()
    }
    await peer?.$disconnect()
  })

  it('deduplicates concurrent registration and consumes verification exactly once across SQL clients', async () => {
    const address = email('concurrent')
    const input = { name: 'Concurrent Visitor', email: address, termsAccepted: true, privacyVersion: profile.privacyVersion }
    const result = await Promise.all([service.register(input), servicePeer.register(input)])
    expect(result[0]).toEqual(result[1])
    const rows = await db.trialRegistration.findMany({ where: { email: address } })
    expect(rows).toHaveLength(1); ids.add(rows[0]!.id)
    expect(mails.filter(m => m.to === address)).toHaveLength(1)
    const token = latestToken(address)
    const verification = await Promise.allSettled([service.verify(token), servicePeer.verify(token)])
    expect(verification.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(verification.filter(r => r.status === 'rejected')).toHaveLength(1)
    const stored = await db.trialRegistration.findUniqueOrThrow({ where: { id: rows[0]!.id } })
    expect(stored).toMatchObject({ status: 'QUEUED', verificationHash: null, marketingConsent: false, researchConsent: false })
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  it('preserves normal/admin-created accounts while trial flag changes and expires without cleanup worker', async () => {
    const standardBefore = await db.user.findUniqueOrThrow({ where: { id: standardUserId } })
    const normalRegistration = await service.register({ name: 'Normal administrator', email: standardBefore.email, termsAccepted: true, privacyVersion: profile.privacyVersion })
    expect(normalRegistration.message).toContain('Se o cadastro')
    expect(await db.trialRegistration.findUnique({ where: { email: standardBefore.email } })).toBeNull()
    const row = await ready('expiry')
    const disabled = new TrialService(peer, { registrationsEnabled: false, mailer, provisioner })
    expect((await disabled.publicConfig()).enabled).toBe(false)
    await expect(disabled.register({ name: 'Blocked Signup', email: email('off'), termsAccepted: true, privacyVersion: profile.privacyVersion })).rejects.toMatchObject({ statusCode: 503 })
    await db.trialRegistration.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(assertTrialAccess(row.tenantId)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    expect(await assertTrialAccess(standardTenantId)).toBeNull()
    expect((await disabled.status(row.token)).status).toBe('EXPIRED')
    expect(await db.user.findUniqueOrThrow({ where: { id: standardUserId } })).toEqual(standardBefore)
    expect(await db.trialRegistration.findUnique({ where: { tenantId: standardTenantId } })).toBeNull()
  })

  it('provisions one tenant on repeated concurrent reconciliation and preserves the profile snapshot', async () => {
    const row = await registered('snapshot')
    await service.verify(row.token)
    await service.updateProfile({ ...profile, durationDays: 3, templateId: 'linux-v2', maxUsers: 4 }, standardUserId)
    await Promise.all([service.tick(), servicePeer.tick()])
    const stored = await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.status).toBe('ACTIVE')
    expect(stored.profileJson).toMatchObject({ durationDays: 7, templateId: 'linux-v1', maxUsers: 2 })
    expect(await db.tenant.count({ where: { slug: `trial-${row.id}` } })).toBe(1)
    expect(await db.host.count({ where: { tenantId: stored.tenantId! } })).toBe(1)
    const expiry = stored.expiresAt
    await service.tick()
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })).expiresAt).toEqual(expiry)
  })

  it('grants real inventory ACL to trial owner/participant without edit or cross-tenant permission', async () => {
    const row = await ready('acl')
    const host = await db.host.findFirstOrThrow({ where: { tenantId: row.tenantId } })
    const repository = new SshRepository(db, new InventoryAclRepository(db))
    expect(await repository.hasEffectiveHostPermission(host.id, row.tenantId, row.userId, 'view', 'USER')).toBe(true)
    expect(await repository.hasEffectiveHostPermission(host.id, row.tenantId, row.userId, 'connect', 'USER')).toBe(true)
    expect(await repository.hasEffectiveHostPermission(host.id, row.tenantId, row.userId, 'edit', 'USER')).toBe(false)
    expect(await repository.hasEffectiveHostPermission(host.id, standardTenantId, standardUserId, 'connect', 'USER')).toBe(false)
    const credentials = await repository.findHostWithCredentials(host.id, row.tenantId)
    expect(credentials).not.toBeNull()
    await expect(assertTrialHostAccess(row.tenantId, credentials!)).resolves.not.toBeNull()
    await expect(assertTrialHostAccess(row.tenantId, { ...credentials!, ip: '10.64.0.99' })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })

  it('serializes invitation quotas and requires the invited person’s own terms/consent', async () => {
    const row = await ready('invite')
    const guestA = email('guest-a'), guestB = email('guest-b')
    const results = await Promise.allSettled([service.invite(row.token, { name: 'Guest A', email: guestA }), servicePeer.invite(row.token, { name: 'Guest B', email: guestB })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((await service.status(row.token)).users).toBe(2) // Pending invite reserves the last slot.
    const guest = await db.trialParticipant.findFirstOrThrow({ where: { trialId: row.id } })
    const capability = (await service.verify(latestToken(guest.email))).accessToken
    expect(await service.status(capability)).toMatchObject({ owner: false, consentRequired: true, marketingConsent: false, researchConsent: false })
    await expect(service.activate(capability, { password })).rejects.toMatchObject({ statusCode: 422 })
    await service.activate(capability, { password, termsAccepted: true, privacyVersion: profile.privacyVersion, marketingConsent: false, researchConsent: true })
    const activatedGuest = await db.trialParticipant.findUniqueOrThrow({ where: { id: guest.id } })
    const user = await db.user.findUniqueOrThrow({ where: { id: activatedGuest.userId! } })
    expect(user).toMatchObject({ role: 'USER', canManageHosts: false, active: true })
    const host = await db.host.findFirstOrThrow({ where: { tenantId: row.tenantId } })
    expect(await new SshRepository(db, new InventoryAclRepository(db)).hasEffectiveHostPermission(host.id, row.tenantId, user.id, 'connect', 'USER')).toBe(true)
    expect(await db.trialConsentEvent.findFirst({ where: { trialId: row.id, participantId: guest.id, kind: 'INVITATION_ACCEPTED' } })).toMatchObject({ marketing: false, research: true })
    await expect(service.invite(capability, { name: 'Forbidden', email: email('forbidden') })).rejects.toMatchObject({ statusCode: 409 })
    await service.cancel(capability)
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('ACTIVE')
    await expect(assertTrialUserAccess(row.tenantId, user.id, user.sessionVersion)).rejects.toMatchObject({ code: 'TRIAL_USER_REVOKED' })
    expect((await db.user.findUniqueOrThrow({ where: { id: row.userId } })).active).toBe(true)
    expect(await service.status(capability)).toMatchObject({ status: 'CANCELLED', owner: false })
    await service.preferences(capability, { marketingConsent: false, researchConsent: false })
    expect((await service.status(row.token)).users).toBe(1)
  })

  it('reconciles provider failure and cancellation while provisioning without publishing a tenant', async () => {
    const row = await registered('cancel-race')
    await service.verify(row.token)
    provisioner.ensure.mockRejectedValueOnce(new Error('private-provider-secret'))
    await service.tick()
    expect(await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'PROVISIONING', lastError: 'RECONCILIATION_RETRY', tenantId: null })
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const enteredProvider = new Promise<void>(resolve => { entered = resolve })
    const pauseProvider = new Promise<void>(resolve => { release = resolve })
    provisioner.ensure.mockImplementationOnce(async id => { entered!(); await pauseProvider; return { trialId: id, state: 'ready', isolated: true, hosts: [] } })
    const reconciliation = service.tick()
    await enteredProvider
    await servicePeer.cancelById(row.id)
    release!()
    await reconciliation
    const cancelled = await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })
    expect(cancelled.tenantId).toBeNull()
    expect(['CANCELLED', 'REMOVING', 'REMOVED']).toContain(cancelled.status)
    await service.tick()
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('REMOVED')
    expect(provisioner.remove).toHaveBeenCalledWith(row.id)
    expect(await db.tenant.count({ where: { slug: `trial-${row.id}` } })).toBe(0)
  })

  it('retains failed cleanup for retry and clears credentials before successful removal', async () => {
    const row = await ready('cleanup')
    await service.cancel(row.token)
    provisioner.remove.mockRejectedValueOnce(new Error('provider cleanup unavailable'))
    await service.tick()
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('REMOVING')
    expect((await db.user.findUniqueOrThrow({ where: { id: row.userId } })).active).toBe(false)
    const host = await db.host.findFirstOrThrow({ where: { tenantId: row.tenantId } })
    expect(host.passwordEncrypted).toBeNull()
    expect(host.deletedAt).not.toBeNull()
    await service.tick()
    expect((await db.trialRegistration.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('REMOVED')
    expect((await db.tenant.findUniqueOrThrow({ where: { id: standardTenantId } })).active).toBe(true)
  })

  it('enforces platform authorization and opaque public capability using actual Fastify routes', async () => {
    const contact = await ready('contact-auth', '+1 (202) 555-0123')
    const list = vi.spyOn(service, 'list')
    const app = Fastify()
    await app.register(jwt, { secret: 'sql-integration-only-key' })
    const limiter = { check: vi.fn(async (): Promise<void> => {}) } as unknown as AuthRateLimitService
    await app.register(async scope => trialRoutes(scope, service, limiter), { prefix: '/api/v1' })
    await app.ready()
    try {
      expect((await app.inject({ url: '/api/v1/platform/trials' })).statusCode).toBe(401)
      const normalJwt = app.jwt.sign({ sub: String(standardUserId), tenantId: standardTenantId, role: 'admin', isPlatformAdmin: false, stage: 'authenticated' })
      expect((await app.inject({ url: '/api/v1/platform/trials', headers: { authorization: `Bearer ${normalJwt}` } })).statusCode).toBe(403)
      const userJwt = app.jwt.sign({ sub: String(standardUserId), tenantId: standardTenantId, role: 'user', isPlatformAdmin: false, stage: 'authenticated' })
      const trialJwt = app.jwt.sign({ sub: String(contact.userId), tenantId: contact.tenantId, role: 'admin', isPlatformAdmin: false, stage: 'authenticated' })
      for (const jwtValue of [userJwt, trialJwt]) expect((await app.inject({ url: '/api/v1/platform/trials', headers: { authorization: `Bearer ${jwtValue}` } })).statusCode).toBe(403)
      expect(list).not.toHaveBeenCalled()
      const platformJwt = app.jwt.sign({ sub: String(standardUserId), tenantId: standardTenantId, role: 'admin', isPlatformAdmin: true, stage: 'authenticated' })
      const adminResponse = await app.inject({ url: '/api/v1/platform/trials', headers: { authorization: `Bearer ${platformJwt}` } })
      expect(adminResponse.statusCode).toBe(200)
      expect(adminResponse.headers['cache-control']).toBe('no-store')
      expect(adminResponse.json<{ trials: Array<{ id: string; phone: string | null }> }>().trials.find(row => row.id === contact.id)?.phone).toBe('+12025550123')
      expect(adminResponse.body).not.toContain('phoneEncrypted')
      expect(list).toHaveBeenCalledTimes(1)
      const status = await app.inject({ url: '/api/v1/trials/public/status', headers: { authorization: `Bearer ${contact.token}` } })
      expect(status.statusCode).toBe(200)
      expect(status.body).not.toContain('phone')
      expect(status.body).not.toContain('+12025550123')
      expect((await app.inject({ url: '/api/v1/trials/public/status', headers: { authorization: `Bearer ${normalJwt}` } })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', url: '/api/v1/trials/public/verify', payload: { token: 'bad' } })).statusCode).toBe(422)
    } finally { list.mockRestore(); await app.close() }
  })
})
