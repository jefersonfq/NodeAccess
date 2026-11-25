import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { configureCurrentSessionReader } from '../auth/current-session.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { ExtensionPackage } from './vault-extension-package.js'
import { vaultExtensionRoutes } from './vault-extension.routes.js'
import { VaultError } from './vault-domain.js'
import { DpopNonces } from './vault-extension-dpop.js'
import type { VaultService } from './vault.service.js'
import type { VaultExtensionService } from './vault-extension.service.js'
import { AppError } from '../../shared/errors.js'

const opaque = (): string => randomBytes(32).toString('base64url')
const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const origin = 'https://vault.example.test'
const user: JwtPayload = { sub: '42', tenantId: 7, sessionVersion: 3, stage: 'authenticated', email: 'fixture@example.test', role: 'user', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, forcePasswordChange: false }
afterEach(() => configureCurrentSessionReader(undefined))

async function harness() {
  const service = {
    siteList: vi.fn().mockResolvedValue({ items: [], next: null }),
    siteWrite: vi.fn().mockResolvedValue({ id: 9, version: 2 }),
    siteCurrentHosts: vi.fn().mockResolvedValue({hosts:[{id:4,name:'Allowed host'}]}),
    siteHosts: vi.fn().mockResolvedValue({ hosts: [{ id: 4, name: 'Allowed host' }] }),
    siteFillAuthorize: vi.fn().mockResolvedValue({ operation: 'O'.repeat(43), expiresAt: 1000, serverNow: 0 }),
    siteFillConsume: vi.fn().mockResolvedValue({ envelope: 'sealed', context: { action: 'fill', itemRef: 'site:9' }, username: 'fixture-user', serverNow: 0 }),
    write: vi.fn().mockResolvedValue({ id: 8 }),
    nonces: new DpopNonces('routes'),
    authorize: vi.fn().mockResolvedValue({ code: opaque(), expiresAt: 1, serverNow: 0 }),
    token: vi.fn().mockResolvedValue({ accessToken: opaque(), tokenType: 'DPoP', expiresAt: 1, serverNow: 0 }),
    renew: vi.fn().mockResolvedValue({ accessToken: opaque(), tokenType: 'DPoP', expiresAt: 1, serverNow: 0 }),
    forget: vi.fn().mockResolvedValue({ state: 'FORGOTTEN' }),
    capabilities: vi.fn().mockResolvedValue({ apiVersion: 1 }),
    items: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    hosts: vi.fn().mockResolvedValue({ hosts: [], nextCursor: null }),
    devices: vi.fn().mockResolvedValue({ devices: [] }),
    revokeDevice: vi.fn().mockResolvedValue({ state: 'REVOKED' }),
    proofRequest: vi.fn().mockResolvedValue({ request: opaque(), url: 'https://portal/x', expiresAt: 1, serverNow: 0 }),
    proofClaim: vi.fn().mockResolvedValue({ state: 'PENDING' }),
    proofInfo: vi.fn().mockResolvedValue({ device: opaque(), expiresAt: 1, serverNow: 0 }),
    proofApprove: vi.fn().mockResolvedValue({ state: 'APPROVED' }),
  }
  const vault = { admitted: vi.fn((run: () => Promise<unknown>) => run()) }
  configureCurrentSessionReader(() => Promise.resolve({ tenantId: 7, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true,
    sessionVersion: 3, role: 'USER', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false }))
  const app = Fastify({ trustProxy: true })
  await app.register(fastifyJwt, { secret: randomBytes(32).toString('hex') })
  const releases = { release: vi.fn().mockResolvedValue(null), file: vi.fn().mockResolvedValue(null), verified: vi.fn().mockResolvedValue(null) }
  await app.register(async r => vaultExtensionRoutes(r, vault as unknown as VaultService, service as unknown as VaultExtensionService, releases as unknown as ExtensionPackage), { prefix: '/api/v1/vault-security' })
  const jwt = app.jwt.sign(user)
  return { app, service, jwt, releases }
}

describe('NA-0200 portal confirmation routes', () => {
  it('portal: info needs the JWT and origin, approve also the vault client; bodies are strict', async () => {
    const h = await harness()
    try {
      const request = opaque(), sessionId = opaque(), client = opaque(), id = { userId: 42, tenantId: 7, sessionVersion: 3 }
      const base = { authorization: `Bearer ${h.jwt}`, origin, 'x-forwarded-proto': 'https' }
      expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/proof-info', payload: { request }, headers: base })).statusCode).toBe(200)
      expect(h.service.proofInfo).toHaveBeenCalledWith(id, origin, request)
      const approve = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/proof-approve', payload: { request, sessionId }, headers: { ...base, 'x-vault-client': client } })
      expect(approve.json()).toEqual({ state: 'APPROVED' }); expect(h.service.proofApprove).toHaveBeenCalledWith(id, client, origin, sessionId, request)
      expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/proof-approve', payload: { request, sessionId }, headers: base })).statusCode).toBe(400)
      expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/proof-info', payload: { request: 'short' }, headers: base })).statusCode).toBe(400)
      expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/proof-info', payload: { request }, headers: { origin, 'x-forwarded-proto': 'https' } })).statusCode).toBe(401)
    } finally { await h.app.close() }
  })
})

describe('NA-0183 extension routes', () => {
  it('validates host association queries without accepting a tenant override', async () => {
    const h = await harness()
    const headers = { origin: `chrome-extension://${EXT}`, 'x-forwarded-proto': 'https', authorization: 'DPoP token' }
    const url = '/api/v1/vault-security/extension/hosts'
    try {
      const result = await h.app.inject({ method: 'GET', url: `${url}?kind=secret&sourceId=3`, headers })
      expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store')
      expect(h.service.hosts).toHaveBeenCalledWith(expect.anything(), 'DPoP token', { kind: 'secret', sourceId: 3 })
      for (const query of ['kind=secret&sourceId=-1', 'kind=secret&sourceId=3&tenantId=8', 'kind=unknown&sourceId=3', 'kind=pem']) {
        expect((await h.app.inject({ method: 'GET', url: `${url}?${query}`, headers })).statusCode).toBe(400)
      }
    } finally { await h.app.close() }
  })
  it('E3 validates strict bodies, permits large PEM payloads and never echoes domain errors', async () => {
    const h = await harness()
    const headers = { origin: `chrome-extension://${EXT}`, 'x-forwarded-proto': 'https', authorization: 'DPoP token' }
    const url = '/api/v1/vault-security/extension/write'
    try {
      const body = { operation: 'import-pem', name: 'key', key: 'x'.repeat(8192) }
      const result = await h.app.inject({ method: 'POST', url, headers, payload: body })
      expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ id: 8 }); expect(result.headers['cache-control']).toBe('no-store')
      expect(h.service.write).toHaveBeenCalledWith(expect.anything(), 'DPoP token', body)
      for (const payload of [
        { operation: 'create-secret', scope: 'GROUP', groupId: 12, alias: 'group', value: 'new' },
        { operation: 'update-secret', scope: 'GROUP', groupId: 12, id: 4, description: 'metadata' },
        { operation: 'rotate-secret', scope: 'TENANT', id: 4, value: 'replacement' },
      ]) {
        expect((await h.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(200)
        expect(h.service.write).toHaveBeenLastCalledWith(expect.anything(), 'DPoP token', payload)
      }
      for (const payload of [{ ...body, scope: 'GROUP' }, { ...body, tenantId: 9 }, { ...body, key: 'x'.repeat(65536) }, { operation: 'update-secret', id: -1 }]) {
        expect((await h.app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400)
      }
      expect((await h.app.inject({ method: 'POST', url, headers, payload: { ...body, key: 'x'.repeat(530000) } })).statusCode).toBe(413)
      for (const [status, code] of [[409, 'EXTENSION_WRITE_CONFLICT'], [400, 'EXTENSION_WRITE_INVALID'], [422, 'EXTENSION_WRITE_INVALID'], [404, 'EXTENSION_WRITE_UNAVAILABLE']] as const) {
        h.service.write.mockRejectedValueOnce(new AppError('sensitive-parser-marker', status))
        const denied = await h.app.inject({ method: 'POST', url, headers, payload: body })
        expect(denied.json()).toMatchObject({ code }); expect(denied.body).not.toContain('sensitive-parser-marker')
      }
      h.service.write.mockRejectedValueOnce(new AppError('revoked-marker', 409, 'SECRET_REVOKED'))
      const revoked = await h.app.inject({ method: 'POST', url, headers, payload: { operation: 'rotate-secret', id: 8, value: 'replacement' } })
      expect(revoked.statusCode).toBe(409); expect(revoked.json()).toMatchObject({ code: 'EXTENSION_WRITE_UNAVAILABLE' })
      expect(revoked.body).not.toContain('revoked-marker')
    } finally { await h.app.close() }
  })
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
  it('NA-0193: renewal passes origin, version and proof, validates the body and keeps the error code', async () => {
    const h = await harness()
    try {
      const headers = { origin: `chrome-extension://${EXT}`, 'x-forwarded-proto': 'https', host: 'vault.example.test', dpop: 'proof', 'x-extension-version': '0.1.0' }
      for (const body of [{ extensionId: EXT }, { extensionId: EXT, otp: '123456' }]) {
        const res = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/renew', payload: body, headers })
        expect(res.statusCode).toBe(200); expect(res.headers['dpop-nonce']).toBeTruthy()
        expect(h.service.renew).toHaveBeenLastCalledWith({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', proof: 'proof',
          url: 'https://vault.example.test/api/v1/vault-security/extension/renew' }, body)
      }
      h.service.renew.mockClear()
      for (const body of [{ extensionId: EXT, otp: '12345' }, { extensionId: EXT, otp: 123456 }, { extensionId: 'x', otp: '123456' }, { extensionId: EXT, extra: 1 }]) {
        expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/renew', payload: body, headers })).statusCode).toBe(400)
      }
      expect(h.service.renew).not.toHaveBeenCalled()
      expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/forget', payload: { extensionId: EXT }, headers })).statusCode).toBe(200)
      expect(h.service.forget).toHaveBeenLastCalledWith(expect.objectContaining({ proof: 'proof' }), { extensionId: EXT })
      expect((await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/forget', payload: {}, headers })).statusCode).toBe(400)
      h.service.renew.mockRejectedValueOnce(new VaultError('EXTENSION_REAUTH_REQUIRED', 401))
      const reauth = await h.app.inject({ method: 'POST', url: '/api/v1/vault-security/extension/renew', payload: { extensionId: EXT }, headers })
      expect(reauth.statusCode).toBe(401); expect(reauth.json()).toMatchObject({ code: 'EXTENSION_REAUTH_REQUIRED' })
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
  it('NA-0194: serves the published release files and metadata only when available, over HTTPS', async () => {
    const h = await harness()
    try {
      const https = { 'x-forwarded-proto': 'https', host: 'vault.example.test' }
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/package.crx', headers: https })).statusCode).toBe(404)
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/update.xml', headers: { host: 'vault.example.test' } })).statusCode).toBe(403)
      const release = { version: '0.2.0', extensionId: EXT, zip: { file: 'vaultnaccess-0.2.0.zip', sha256: 'a'.repeat(64), size: 3 }, crx: { file: 'vaultnaccess-0.2.0.crx', sha256: 'b'.repeat(64), size: 3 } }
      h.releases.file.mockResolvedValueOnce({ body: Buffer.from('crx'), contentType: 'application/x-chrome-extension', release })
      const crx = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/package.crx', headers: https })
      expect(crx.statusCode).toBe(200); expect(crx.headers['content-type']).toBe('application/x-chrome-extension')
      expect(crx.headers['content-disposition']).toBe('attachment; filename="vaultnaccess-0.2.0.crx"'); expect(crx.body).toBe('crx')
      expect(crx.headers.etag).toBe(`"${'b'.repeat(64)}"`)
      h.releases.file.mockResolvedValueOnce({ body: Buffer.from('crx'), contentType: 'application/x-chrome-extension', release })
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/package.crx', headers: { ...https, 'if-none-match': `"${'b'.repeat(64)}"` } })).statusCode).toBe(304)
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/update.xml', headers: https })).statusCode).toBe(404)
      h.releases.verified.mockResolvedValueOnce(release)
      const xml = await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/update.xml', headers: https })
      expect(xml.statusCode).toBe(200); expect(xml.headers['content-disposition']).toBeUndefined()
      expect(xml.body).toContain(`appid='${EXT}'`); expect(xml.body).toContain("codebase='https://vault.example.test/api/v1/vault-security/extension/package.crx'")
      const auth = { ...https, authorization: `Bearer ${h.jwt}` }
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/package', headers: https })).statusCode).toBe(401)
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/package', headers: auth })).json()).toEqual({ available: false })
      h.releases.verified.mockResolvedValueOnce(release)
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/vault-security/extension/package', headers: auth })).json()).toEqual({ available: true, version: '0.2.0', extensionId: EXT,
        zip: { sha256: 'a'.repeat(64), size: 3 }, zipUrl: '/api/v1/vault-security/extension/package.zip', crxUrl: '/api/v1/vault-security/extension/package.crx', updateUrl: '/api/v1/vault-security/extension/update.xml' })
    } finally { await h.app.close() }
  })
})


describe('NA-0203 integrated sites HTTP contracts', () => {
  const base = '/api/v1/vault-security/extension/sites'
  const headers = { origin: `chrome-extension://${EXT}`, 'x-forwarded-proto': 'https', host: 'vault.example.test', authorization: 'DPoP token', dpop: 'signed-proof', 'x-extension-version': '0.1.0' }
  const binding = { mode: 'both', origin: 'https://login.example.test', tabId: 12, frameId: 0, documentId: 'document-1' }
  const authorize = { siteId: 9, siteVersion: 2, binding, recipient: { kty: 'RSA', n: 'N'.repeat(342), e: 'AQAB' } }
  const consume = { operation: 'O'.repeat(43), binding }
  it('delegates metadata, guarded writes, host selection and fill with the proxy URL, DPoP and no-store headers', async () => {
    const h = await harness()
    try {
      const cases = [
        ['list', {}, 'siteList', [{ after: 0, limit: 50 }]],
        ['create', { kind: 'url', label: 'Portal', url: 'https://login.example.test' }, 'siteWrite', ['create', { kind: 'url', scope: 'PERSONAL', label: 'Portal', url: 'https://login.example.test/' }]],
        ['create', { kind: 'login', label: 'Login', username: 'fixture-user', password: 'request-only', origins: [binding.origin] }, 'siteWrite', ['create', { kind: 'login', scope: 'PERSONAL', label: 'Login', username: 'fixture-user', password: 'request-only', origins: [binding.origin], allowFill: false }]],
        ['update', { id: 9, version: 2, label: 'Renamed' }, 'siteWrite', ['update', { id: 9, version: 2, label: 'Renamed' }]],
        ['revoke', { id: 9, version: 2 }, 'siteWrite', ['revoke', { id: 9, version: 2 }]],
        ['delete', { id: 9, version: 2 }, 'siteWrite', ['delete', { id: 9, version: 2 }]],
        ['hosts', { q: 'Allowed' }, 'siteHosts', ['Allowed']],
        ['fill/authorize', authorize, 'siteFillAuthorize', [authorize]],
        ['fill/consume', consume, 'siteFillConsume', [consume]],
      ] as const
      for (const [path, payload, method, args] of cases) {
        const response = await h.app.inject({ method: 'POST', url: `${base}/${path}`, headers, payload })
        expect(response.statusCode).toBe(200)
        expect(response.headers['cache-control']).toBe('no-store')
        expect(response.headers['dpop-nonce']).toBeTypeOf('string')
        expect(response.body).not.toContain('request-only')
        expect(h.service[method]).toHaveBeenLastCalledWith({ requestOrigin: headers.origin, version: '0.1.0', proof: 'signed-proof', url: `${origin}${base}/${path}` }, 'DPoP token', ...args)
      }
    } finally { await h.app.close() }
  })
  it.each([
    ['list', { tenantId: 99 }], ['list', { limit: 51 }], ['list', { origin: 'https://login.example.test/path' }],
    ['create', { kind: 'url', label: 'URL', url: 'http://login.example.test' }],
    ['create', { kind: 'url', label: 'URL', url: 'https://login.example.test', ownerUserId: 1 }],
    ['create', { kind: 'url', label: 'URL', url: 'https://login.example.test', scope: 'GROUP' }],
    ['create', { kind: 'login', label: 'Login', username: 'fixture-user', password: 'value', origins: ['https://login.example.test'], tenantId: 99 }],
    ['update', { id: 9, version: 2 }], ['update', { id: 9, version: 2, scope: 'TENANT' }],
    ['revoke', { id: 9, version: 0 }], ['delete', { id: 9, version: 2, tenantId: 99 }],
    ['hosts', { q: 'x'.repeat(201) }], ['hosts', { userId: 7 }],
    ['fill/authorize', { ...authorize, binding: { ...binding, frameId: 1 } }],
    ['fill/authorize', { ...authorize, binding: { ...binding, origin: 'http://login.example.test' } }],
    ['fill/authorize', { ...authorize, recipient: { ...authorize.recipient, d: 'private' } }],
    ['fill/authorize', { ...authorize, secretId: 9 }],
    ['fill/consume', { ...consume, operation: 'short' }], ['fill/consume', { ...consume, binding: { ...binding, documentId: '' } }],
    ['fill/consume', { ...consume, tenantId: 99 }],
  ])('rejects invalid %s input before any sites service call', async (path, payload) => {
    const h = await harness()
    try {
      const response = await h.app.inject({ method: 'POST', url: `${base}/${path}`, headers, payload })
      expect(response.statusCode).toBe(400)
      for (const method of [h.service.siteList, h.service.siteWrite, h.service.siteHosts, h.service.siteFillAuthorize, h.service.siteFillConsume]) expect(method).not.toHaveBeenCalled()
    } finally { await h.app.close() }
  })
  it('preserves guarded service denials, nonce challenge and retry semantics without exposing credential errors', async () => {
    const h = await harness()
    try {
      for (const [code, status] of [['EXTENSION_UNAUTHORIZED', 401], ['EXTENSION_DPOP_NONCE', 401], ['SITE_FILL_UNAVAILABLE', 403], ['VAULT_STEP_UP_REQUIRED', 423], ['VAULT_RATE_LIMIT', 429]] as const) {
        h.service.siteFillConsume.mockRejectedValueOnce(new VaultError(code, status))
        const result = await h.app.inject({ method: 'POST', url: `${base}/fill/consume`, headers, payload: consume })
        expect(result.statusCode).toBe(status); expect(result.json()).toMatchObject({ code })
        expect(result.headers['cache-control']).toBe('no-store')
        if (code === 'EXTENSION_DPOP_NONCE') expect(result.headers['www-authenticate']).toBe('DPoP error="use_dpop_nonce"')
        if (status === 429) expect(result.headers['retry-after']).toBe('60')
      }
      h.service.siteWrite.mockRejectedValueOnce(new Error('private-password-error'))
      const failed = await h.app.inject({ method: 'POST', url: `${base}/update`, headers, payload: { id: 9, version: 2, label: 'Changed' } })
      expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('private-password-error')
    } finally { await h.app.close() }
  })
})


describe('NA0203 exact-origin host lookup and safe domain errors', () => {
  const base='/api/v1/vault-security/extension/sites'
  const headers={host:'vault.example.test','x-forwarded-proto':'https',origin:`chrome-extension://${EXT}`,'x-extension-version':'0.1.0',dpop:'signed-proof',authorization:'DPoP token'}
  it('passes exact origin through authenticated current-hosts and rejects path/tenant injection before lookup', async () => {
    const h=await harness()
    try {
      const response=await h.app.inject({method:'POST',url:`${base}/current-hosts`,headers,payload:{origin:'https://login.test'}})
      expect(response.statusCode).toBe(200);expect(response.json()).toEqual({hosts:[{id:4,name:'Allowed host'}]})
      expect(h.service.siteCurrentHosts).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({proof:'signed-proof',requestOrigin:headers.origin,url:`${origin}${base}/current-hosts`}),headers.authorization,'https://login.test')
      expect(response.headers['cache-control']).toBe('no-store');expect(response.headers['dpop-nonce']).toBeTypeOf('string')
      h.service.siteCurrentHosts.mockClear()
      for(const payload of [{origin:'https://login.test/path'},{origin:'https://u:p@login.test'},{origin:'http://login.test'},{origin:'https://login.test',tenantId:99}]){
        expect((await h.app.inject({method:'POST',url:`${base}/current-hosts`,headers,payload})).statusCode).toBe(400)
      }
      expect(h.service.siteCurrentHosts).not.toHaveBeenCalled()
    } finally {await h.app.close()}
  })
  it.each([403,404])('normalizes domain %s into indistinguishable item denial without details', async status => {
    const h=await harness()
    try {
      h.service.siteList.mockRejectedValueOnce(new AppError('private tenant item',status,'NOT_FOUND'))
      const response=await h.app.inject({method:'POST',url:`${base}/list`,headers,payload:{}})
      expect(response.statusCode).toBe(403);expect(response.json()).toMatchObject({code:'EXTENSION_ITEM_DENIED',message:'Item indisponível'})
      expect(response.body).not.toContain('private tenant item');expect(response.headers['cache-control']).toBe('no-store');expect(response.headers['dpop-nonce']).toBeTypeOf('string')
    } finally {await h.app.close()}
  })
  it('preserves optimistic site conflicts so a stale edit can refresh instead of becoming authorization denial', async () => {
    const h=await harness()
    try {
      h.service.siteWrite.mockRejectedValueOnce(new AppError('Item alterado ou indisponível; atualize a lista',409,'VAULT_SITE_CONFLICT'))
      const response=await h.app.inject({method:'POST',url:`${base}/update`,headers,payload:{id:9,version:1,label:'New'}})
      expect(response.statusCode).toBe(409);expect(response.json()).toMatchObject({code:'VAULT_SITE_CONFLICT'})
      expect(response.headers['cache-control']).toBe('no-store')
    } finally {await h.app.close()}
  })
})
