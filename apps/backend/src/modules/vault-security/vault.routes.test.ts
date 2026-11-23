import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { configureCurrentSessionReader } from '../auth/current-session.js'
import { requireAuth, type JwtPayload } from '../../shared/guards.js'
import { vaultRoutes } from './vault.routes.js'
import { VaultError } from './vault-domain.js'
import { VaultService } from './vault.service.js'
import type { VaultAdministrationService } from './vault-administration.service.js'

const opaque = () => randomBytes(32).toString('base64url')
const origin = 'https://vault.example.test'
const user: JwtPayload = { sub: '42', tenantId: 7, sessionVersion: 3, stage: 'authenticated', email: 'fixture@example.test', role: 'user', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, forcePasswordChange: false }
afterEach(() => configureCurrentSessionReader(undefined))
async function harness(patch: Partial<JwtPayload> = {}, withAdministration = false) {
  const service = {
    admitted: vi.fn((run: () => Promise<unknown>) => run()),
    recordDenial: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue({ clientId: opaque(), expiresAt: 123 }),
    challenge: vi.fn().mockResolvedValue({ challengeId: opaque(), expiresAt: 123 }),
    unlock: vi.fn().mockResolvedValue({ sessionId: opaque(), idleUntil: 123, expiresAt: 456 }),
    lock: vi.fn().mockResolvedValue(undefined),
    current: vi.fn().mockResolvedValue({ state: 'LOCKED' }),
    request: vi.fn().mockResolvedValue({ operationId: opaque(), expiresAt: 123, state: 'AUTHORIZED' }),
    consume: vi.fn().mockResolvedValue({ envelope: 'opaque.encrypted.envelope' }),
    operation: vi.fn().mockResolvedValue({ state: 'AUTHORIZED' }),
    providerBegin: vi.fn().mockResolvedValue({ kind: 'redirect', authorizationUrl: 'https://idp.example.test/authorize' }),
    providerComplete: vi.fn().mockResolvedValue({ totpRequired: true }),
    unlockProvider: vi.fn().mockResolvedValue({ sessionId: opaque(), idleUntil: 123, expiresAt: 456 }),
  }
  const administration = { propose: vi.fn().mockResolvedValue({ proposalId: opaque() }), approve: vi.fn().mockResolvedValue({ state: 'APPLIED' }),
    approveReference: vi.fn().mockResolvedValue({ state: 'APPLIED' }), status: vi.fn().mockResolvedValue({ manager: true }),
    overview: vi.fn().mockResolvedValue({ users: [], proposals: [], serverNow: 1 }) }
  configureCurrentSessionReader(() => Promise.resolve({ tenantId: 7, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true,
    sessionVersion: 3, role: patch.role === 'admin' ? 'ADMIN' : 'USER', isPlatformAdmin: patch.isPlatformAdmin ?? false,
    canManageHosts: patch.canManageHosts ?? false, canViewLiveSessions: false }))
  const app = Fastify({ trustProxy: true })
  await app.register(fastifyJwt, { secret: randomBytes(32).toString('hex') })
  await app.register(async instance => vaultRoutes(instance, service as unknown as VaultService, withAdministration ? administration as unknown as VaultAdministrationService : undefined), { prefix: '/api/v1/vault-security' })
  app.get('/central-session', { preHandler: [requireAuth] }, req => ({ userId: req.jwtUser?.sub }))
  const token = app.jwt.sign({ ...user, ...patch })
  const clientId = opaque()
  const headers = { authorization: `Bearer ${token}`, origin, 'x-forwarded-proto': 'https', 'x-vault-client': clientId }
  const post = (path: string, body: object = {}, customHeaders: Record<string,string> = headers) => app.inject({ method: 'POST', url: `/api/v1/vault-security${path}`, headers: customHeaders, payload: body })
  return { app, service, administration, headers, clientId, post }
}

describe('Vault provider step-up routes (NA-0184)', () => {
  it('forwards validated provider requests with the verified identity and client', async () => {
    const h = await harness()
    try {
      const identity = { userId: 42, tenantId: 7, sessionVersion: 3 }, challengeId = opaque()
      expect((await h.post('/sessions/provider/begin', { challengeId })).statusCode).toBe(200)
      expect(h.service.providerBegin).toHaveBeenCalledWith(identity, h.clientId, origin, challengeId)
      const state = `vsu.${'s'.repeat(43)}`
      expect((await h.post('/sessions/provider/complete', { challengeId, state, code: 'provider-code' })).json()).toEqual({ totpRequired: true })
      expect(h.service.providerComplete).toHaveBeenCalledWith(identity, h.clientId, origin, challengeId, { state, code: 'provider-code', idToken: undefined })
      const unlocked = await h.post('/sessions/unlock-provider', { challengeId, token: '123456' })
      expect(unlocked.statusCode).toBe(200); expect(unlocked.headers['cache-control']).toBe('no-store')
      expect(h.service.unlockProvider).toHaveBeenCalledWith(identity, h.clientId, origin, challengeId, '123456')
    } finally { await h.app.close() }
  })
})

describe('Vault private HTTP adapter', () => {
  it('binds registration to the verified central identity and never returns the refresh credential', async () => {
    const h = await harness()
    try {
      const refreshToken = opaque(); const response = await h.post('/clients', { refreshToken })
      expect(response.statusCode).toBe(200)
      expect(h.service.register).toHaveBeenCalledWith({ userId: 42, tenantId: 7, sessionVersion: 3 }, refreshToken, origin)
      expect(response.body).not.toContain(refreshToken)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['referrer-policy']).toBe('no-referrer')
    } finally { await h.app.close() }
  })
  it.each([
    ['/clients', { refreshToken: 'x'.repeat(43), tenantId: 8 }],
    ['/sessions/challenges', { userId: 8 }],
    ['/sessions/unlock', { challengeId: 'x'.repeat(43), password: 'synthetic', token: '123456', role: 'admin' }],
    ['/operations', { sessionId: 'x'.repeat(43), action: 'fill', secretId: 1, recipient: { kty: 'RSA', n: 'x'.repeat(342), e: 'AQAB' } }],
    ['/operations', { sessionId: 'x'.repeat(43), action: 'copy', secretId: 1, recipient: { kty: 'RSA', n: 'x'.repeat(342), e: 'AQAB', d: 'private-key-rejected' } }],
    ['/operations/consume', { sessionId: 'x'.repeat(43), operationId: 'x'.repeat(43), recipient: {} }],
    ['/sessions/provider/begin', { challengeId: 'x'.repeat(43), method: 'oidc' }],
    ['/sessions/provider/complete', { challengeId: 'x'.repeat(43), state: 'plainloginstate123456', code: 'c' }],
    ['/sessions/provider/complete', { challengeId: 'x'.repeat(43), idToken: 'g'.repeat(64), userId: 9 }],
    ['/sessions/unlock-provider', { challengeId: 'x'.repeat(43), token: '12' }],
    ['/sessions/unlock-provider', { challengeId: 'x'.repeat(43), password: 'not-accepted' }],
  ])('rejects unknown or unsupported body fields for %s', async (path, body) => {
    const h = await harness()
    try {
      const response = await h.post(path, body)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ code: 'VAULT_INPUT_INVALID' })
      expect(h.service.admitted).not.toHaveBeenCalled()
      expect(response.body).not.toContain('private-key-rejected')
    } finally { await h.app.close() }
  })
  it('rejects missing authentication, HTTPS, origin or valid client before invoking use cases', async () => {
    const h = await harness()
    try {
      const noAuth = { ...h.headers }; delete (noAuth as Partial<typeof noAuth>).authorization
      expect((await h.post('/sessions/current', {}, noAuth)).statusCode).toBe(401)
      expect((await h.post('/sessions/current', {}, { ...h.headers, 'x-forwarded-proto': 'http' })).statusCode).toBe(403)
      const noOrigin = { ...h.headers }; delete (noOrigin as Partial<typeof noOrigin>).origin
      expect((await h.post('/sessions/current', {}, noOrigin)).statusCode).toBe(403)
      expect((await h.post('/sessions/current', {}, { ...h.headers, 'x-vault-client': 'bad' })).statusCode).toBe(400)
      expect(h.service.admitted).not.toHaveBeenCalled()
    } finally { await h.app.close() }
  })
  it.each([{ forcePasswordChange: true }, { sub: '0' }, { sub: 'invalid' }, { role: 'admin' as const, isPlatformAdmin: true, canManageHosts: true, platformTenantId: 7, actingTenantId: 7, impersonatedByUserId: 42 }])('rejects an ineligible central context %j', async patch => {
    const h = await harness(patch)
    try {
      expect((await h.post('/sessions/current')).statusCode).toBeGreaterThanOrEqual(400)
      expect(h.service.current).not.toHaveBeenCalled()
    } finally { await h.app.close() }
  })
  it('forwards only validated operation parameters and returns only the encrypted delivery', async () => {
    const h = await harness()
    try {
      const sessionId = opaque(), operationId = opaque(), challengeId = opaque()
      await h.post('/sessions/challenges')
      expect(h.service.challenge).toHaveBeenCalledWith({ userId: 42, tenantId: 7, sessionVersion: 3 }, h.clientId, origin)
      await h.post('/sessions/unlock', { challengeId, password: 'synthetic', token: '123456' })
      expect(h.service.unlock).toHaveBeenCalledWith(expect.anything(), h.clientId, origin, challengeId, 'synthetic', '123456')
      const recipient = { kty: 'RSA', n: 'x'.repeat(342), e: 'AQAB' }
      await h.post('/operations', { sessionId, action: 'copy', secretId: 19, recipient })
      expect(h.service.request).toHaveBeenCalledWith(expect.anything(), h.clientId, origin, sessionId, 'copy', 19, recipient)
      const delivery = await h.post('/operations/consume', { sessionId, operationId })
      expect(delivery.json()).toEqual({ envelope: 'opaque.encrypted.envelope' })
      expect(h.service.consume).toHaveBeenCalledWith(expect.anything(), h.clientId, origin, sessionId, operationId)
      await h.post('/operations/status', { operationId })
      expect(h.service.operation).toHaveBeenLastCalledWith(expect.anything(), h.clientId, origin, operationId)
      await h.post('/operations/cancel', { operationId })
      expect(h.service.operation).toHaveBeenLastCalledWith(expect.anything(), h.clientId, origin, operationId, true)
      expect((await h.post('/sessions/lock')).json()).toEqual({ state: 'LOCKED' })
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/operations/consume', headers: h.headers })).statusCode).toBe(404)
    } finally { await h.app.close() }
  })
  it('does not bypass saturated admission through diagnostic audit during a request flood', async () => {
    const h = await harness()
    const pool = new VaultService({ transaction: vi.fn() }, { bind: vi.fn(), assert: vi.fn() },
      { verify: vi.fn() }, { validate: vi.fn(), seal: vi.fn() }, { token: opaque, digest: vi.fn() })
    h.service.admitted.mockImplementation(run => pool.admitted(run))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const occupied = Array.from({ length: 4 }, () => pool.admitted(() => gate))
    try {
      const responses = await Promise.all(Array.from({ length: 10 }, () => h.post('/operations/status', { operationId: opaque() })))
      expect(responses.map(response => response.statusCode)).toEqual(Array(10).fill(503))
      expect(h.service.operation).not.toHaveBeenCalled()
      expect(h.service.recordDenial).not.toHaveBeenCalled()
      expect(h.service.admitted).toHaveBeenCalledTimes(20)
    } finally { release(); await Promise.all(occupied); await h.app.close() }
  })
  it('returns vault lock as 423, retains the central JWT, and sanitizes dependency failures', async () => {
    const h = await harness()
    try {
      h.service.current.mockRejectedValueOnce(new VaultError('VAULT_LOCKED', 423))
      const locked = await h.post('/sessions/current')
      expect(locked.statusCode).toBe(423)
      expect(locked.json()).toMatchObject({ code: 'VAULT_LOCKED' })
      expect(locked.headers['cache-control']).toBe('no-store')
      expect((await h.app.inject({ method: 'GET', url: '/central-session', headers: h.headers })).json()).toEqual({ userId: '42' })
      h.service.current.mockRejectedValueOnce(new Error('secret-private-upstream-data'))
      const failure = await h.post('/sessions/current')
      expect(failure.statusCode).toBe(503)
      expect(failure.json()).toMatchObject({ code: 'VAULT_DEPENDENCY_UNAVAILABLE' })
      expect(failure.body).not.toContain('secret-private-upstream-data')
      h.service.current.mockRejectedValueOnce(new VaultError('VAULT_RATE_LIMIT', 429))
      const limited = await h.post('/sessions/current')
      expect(limited.statusCode).toBe(429)
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    } finally { await h.app.close() }
  })
  it('validates administrative proposals and delegates approval with the authenticated actor', async () => {
    const h = await harness({}, true)
    try {
      const sessionId = opaque(), proposalId = opaque()
      const changes = [
        { kind: 'grant', userId: 99, action: 'copy', enabled: true },
        { kind: 'item', secretId: 19, enabled: false },
        { kind: 'policy', reveal: false, copy: true, tenantQuota: 30 },
        { kind: 'confirmation', seconds: 60 },
        { kind: 'confirmation', seconds: 900 },
        { kind: 'manager', userId: 98, enabled: true },
        { kind: 'manager', userId: 98, enabled: false },
        { kind: 'proposalWindow', seconds: 120 },
        { kind: 'proposalWindow', seconds: 86400 },
      ]
      for (const change of changes) {
        expect((await h.post('/administration/proposals', { sessionId, change })).statusCode).toBe(200)
        expect(h.administration.propose).toHaveBeenLastCalledWith({ userId: 42, tenantId: 7, sessionVersion: 3 }, h.clientId, origin, sessionId, change)
      }
      expect((await h.post('/administration/approve', { sessionId, proposalId })).json()).toEqual({ state: 'APPLIED' })
      expect(h.administration.approve).toHaveBeenCalledWith({ userId: 42, tenantId: 7, sessionVersion: 3 }, h.clientId, origin, sessionId, proposalId)
      h.administration.propose.mockClear()
      for (const change of [{ kind: 'grant', userId: 99, action: 'fill', enabled: true }, { kind: 'policy', reveal: true, copy: true, tenantQuota: 301 }, { kind: 'item', secretId: 19, enabled: 'true' }, { ...changes[0], approvedBy: 42 },
        { kind: 'confirmation', seconds: 59 }, { kind: 'confirmation', seconds: 901 }, { kind: 'confirmation', seconds: 90.5 }, { kind: 'confirmation', seconds: 90 }, { kind: 'confirmation', seconds: 120, extra: 1 },
        { kind: 'manager', userId: 0, enabled: true }, { kind: 'manager', userId: 98 }, { kind: 'manager', userId: 98, enabled: true, action: 'copy' },
        { kind: 'proposalWindow', seconds: 60 }, { kind: 'proposalWindow', seconds: 86460 }, { kind: 'proposalWindow', seconds: 150 }, { kind: 'proposalWindow', seconds: '600' }]) {
        expect((await h.post('/administration/proposals', { sessionId, change })).statusCode).toBe(400)
      }
      expect(h.administration.propose).not.toHaveBeenCalled()
    } finally { await h.app.close() }
  })
  it('NA-0183: lists for managers and approves a listed proposal by its stored reference', async () => {
    const h = await harness({}, true)
    try {
      const actor = { userId: 42, tenantId: 7, sessionVersion: 3 }, sessionId = opaque(), reference = 'a'.repeat(64)
      expect((await h.post('/administration/status')).json()).toEqual({ manager: true })
      expect(h.administration.status).toHaveBeenCalledWith(actor, origin)
      expect((await h.post('/administration/overview', { sessionId })).json()).toEqual({ users: [], proposals: [], serverNow: 1 })
      expect(h.administration.overview).toHaveBeenCalledWith(actor, h.clientId, origin, sessionId)
      expect((await h.post('/administration/approve', { sessionId, reference })).json()).toEqual({ state: 'APPLIED' })
      expect(h.administration.approveReference).toHaveBeenCalledWith(actor, h.clientId, origin, sessionId, reference)
      for (const body of [{ sessionId, reference: 'A'.repeat(64) }, { sessionId, reference, proposalId: opaque() }, { sessionId }]) {
        expect((await h.post('/administration/approve', body)).statusCode).toBe(400)
      }
      expect((await h.post('/administration/status', { extra: 1 })).statusCode).toBe(400)
      expect((await h.post('/administration/overview', {})).statusCode).toBe(400)
      expect(h.administration.approve).not.toHaveBeenCalled()
    } finally { await h.app.close() }
  })
  it('records only denial context and does not turn denial-audit outage into a release', async () => {
    const h = await harness()
    try {
      h.service.consume.mockRejectedValue(new VaultError('VAULT_FORBIDDEN', 403))
      h.service.recordDenial.mockRejectedValue(new Error('private audit storage failure'))
      const response = await h.post('/operations/consume', { sessionId: opaque(), operationId: opaque() })
      expect(response.statusCode).toBe(403)
      expect(h.service.recordDenial).toHaveBeenCalledWith({ userId: 42, tenantId: 7, sessionVersion: 3 }, 'VAULT_FORBIDDEN')
      expect(response.body).not.toContain('private audit storage failure')
      expect(response.json()).not.toHaveProperty('envelope')
    } finally { await h.app.close() }
  })
  it('rejects bodies over 16KiB without invoking the domain', async () => {
    const h = await harness()
    try {
      const response = await h.post('/clients', { refreshToken: 'x'.repeat(17 * 1024) })
      expect(response.statusCode).toBe(413)
      expect(h.service.admitted).not.toHaveBeenCalled()
    } finally { await h.app.close() }
  })
})
