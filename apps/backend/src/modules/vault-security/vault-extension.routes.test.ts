import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { configureCurrentSessionReader } from '../auth/current-session.js'
import type { JwtPayload } from '../../shared/guards.js'
import { vaultExtensionRoutes } from './vault-extension.routes.js'
import { VaultError } from './vault-domain.js'
import { DpopNonces } from './vault-extension-dpop.js'
import type { VaultService } from './vault.service.js'
import type { VaultExtensionService } from './vault-extension.service.js'

const opaque = (): string => randomBytes(32).toString('base64url')
const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const origin = 'https://vault.example.test'
const user: JwtPayload = { sub: '42', tenantId: 7, sessionVersion: 3, stage: 'authenticated', email: 'fixture@example.test', role: 'user', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, forcePasswordChange: false }
afterEach(() => configureCurrentSessionReader(undefined))

async function harness() {
  const service = {
    nonces: new DpopNonces('routes'),
    authorize: vi.fn().mockResolvedValue({ code: opaque(), expiresAt: 1, serverNow: 0 }),
    token: vi.fn().mockResolvedValue({ accessToken: opaque(), tokenType: 'DPoP', expiresAt: 1, serverNow: 0 }),
    capabilities: vi.fn().mockResolvedValue({ apiVersion: 1 }),
    items: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    devices: vi.fn().mockResolvedValue({ devices: [] }),
    revokeDevice: vi.fn().mockResolvedValue({ state: 'REVOKED' }),
  }
  const vault = { admitted: vi.fn((run: () => Promise<unknown>) => run()) }
  configureCurrentSessionReader(() => Promise.resolve({ tenantId: 7, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true,
    sessionVersion: 3, role: 'USER', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false }))
  const app = Fastify({ trustProxy: true })
  await app.register(fastifyJwt, { secret: randomBytes(32).toString('hex') })
  await app.register(async r => vaultExtensionRoutes(r, vault as unknown as VaultService, service as unknown as VaultExtensionService), { prefix: '/api/v1/vault-security' })
  const jwt = app.jwt.sign(user)
  return { app, service, jwt }
}

describe('NA-0183 extension routes', () => {
  it('passes the proxy-visible URL, origin, version and proof to the token exchange and always sends a nonce', async () => {
    const h = await harness()
    try {
      const body = { code: opaque(), codeVerifier: randomBytes(48).toString('base64url'), redirectUri: `https://${EXT}.chromiumapp.org/`, extensionId: EXT }
      const res = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/token?x=1', payload: body,
        headers: { origin: `chrome-extension://${EXT}`, 'x-forwarded-proto': 'https', host: 'vault.example.test', dpop: 'proof', 'x-extension-version': '0.1.0' } })
      expect(res.statusCode).toBe(200)
      expect(res.headers['dpop-nonce']).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{32}$/)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(h.service.token).toHaveBeenCalledWith({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', proof: 'proof',
        url: 'https://vault.example.test/api/v1/vault-security/extension/token' }, body)
    } finally { await h.app.close() }
  })
  it('rejects plain HTTP, malformed bodies and maps DPoP errors to WWW-Authenticate', async () => {
    const h = await harness()
    try {
      const http = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/capabilities', headers: { host: 'vault.example.test' } })
      expect(http.statusCode).toBe(403)
      const bad = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/token', payload: { code: 'x', extra: true }, headers: { 'x-forwarded-proto': 'https' } })
      expect(bad.statusCode).toBe(400)
      expect(h.service.token).not.toHaveBeenCalled()
      h.service.capabilities.mockRejectedValueOnce(new VaultError('EXTENSION_DPOP_NONCE', 401))
      const nonce = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/capabilities', headers: { 'x-forwarded-proto': 'https' } })
      expect(nonce.statusCode).toBe(401)
      expect(nonce.headers['www-authenticate']).toBe('DPoP error="use_dpop_nonce"')
      expect(nonce.headers['dpop-nonce']).toBeTruthy()
      h.service.items.mockRejectedValueOnce(new VaultError('EXTENSION_UNAUTHORIZED', 401))
      const invalid = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/items?q=db', headers: { 'x-forwarded-proto': 'https' } })
      expect(invalid.headers['www-authenticate']).toBe('DPoP error="invalid_token"')
      h.service.items.mockRejectedValueOnce(new Error('ORM detail with secret material'))
      const opaqueError = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/items', headers: { 'x-forwarded-proto': 'https' } })
      expect(opaqueError.statusCode).toBe(503)
      expect(opaqueError.body).not.toContain('secret material')
      const query = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/items?unknown=1', headers: { 'x-forwarded-proto': 'https' } })
      expect(query.statusCode).toBe(400)
    } finally { await h.app.close() }
  })
  it('requires the portal JWT, origin and vault client for consent; devices need no vault client', async () => {
    const h = await harness()
    try {
      const body = { extensionId: EXT, redirectUri: `https://${EXT}.chromiumapp.org/`, state: opaque(), codeChallenge: opaque(), deviceJkt: opaque(), sessionId: opaque() }
      const client = opaque()
      const ok = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/authorize', payload: body,
        headers: { authorization: `Bearer ${h.jwt}`, origin, 'x-forwarded-proto': 'https', 'x-vault-client': client } })
      expect(ok.statusCode).toBe(200)
      expect(h.service.authorize).toHaveBeenCalledWith({ userId: 42, tenantId: 7, sessionVersion: 3 }, client, origin, body)
      const anonymous = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/authorize', payload: body, headers: { origin, 'x-forwarded-proto': 'https', 'x-vault-client': client } })
      expect(anonymous.statusCode).toBe(401)
      const noOrigin = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/authorize', payload: body, headers: { authorization: `Bearer ${h.jwt}`, 'x-forwarded-proto': 'https', 'x-vault-client': client } })
      expect(noOrigin.statusCode).toBe(403)
      const devices = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/devices', payload: {}, headers: { authorization: `Bearer ${h.jwt}`, origin, 'x-forwarded-proto': 'https' } })
      expect(devices.statusCode).toBe(200)
      const revoke = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/devices/revoke', payload: { jkt: 'short' }, headers: { authorization: `Bearer ${h.jwt}`, origin, 'x-forwarded-proto': 'https' } })
      expect(revoke.statusCode).toBe(400)
    } finally { await h.app.close() }
  })
})
