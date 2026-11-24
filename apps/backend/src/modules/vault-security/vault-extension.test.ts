import { describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { DpopNonces, DpopVerifier, pkceMatches, sha256b64 } from './vault-extension-dpop.js'
import { catalogSummaries, pageOf, VaultExtensionService, type VaultCatalog } from './vault-extension.service.js'
import { extensionRedirectUri, versionAtLeast, type ExtensionAccess, type ExtensionDeviceRow, type ExtensionRecords, type ExtensionTokenKind, type ExtensionTokenValue, type ExtensionTrust } from './vault-extension-domain.js'
import { VaultError, type VaultAuthority, type VaultIdentity, type VaultOrigin } from './vault-domain.js'
import type { OriginVerifier, VaultStore, VaultTransaction } from './vault-ports.js'
import type { VaultService } from './vault.service.js'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const PORTAL = 'https://vault.example.test'
const TOKEN_URL = `${PORTAL}/api/v1/vault-security/extension/token`
const ITEMS_URL = `${PORTAL}/api/v1/vault-security/extension/items`
const RENEW_URL = `${PORTAL}/api/v1/vault-security/extension/renew`
const identity: VaultIdentity = { userId: 7, tenantId: 3, sessionVersion: 2 }
const centralOrigin: VaultOrigin = { jti: '00000000-0000-4000-8000-000000000000', expiresAt: Date.now() + 3_600_000, authMethod: 'local' }
const token = (): string => randomBytes(32).toString('base64url')

async function deviceKey(): Promise<{ privateKey: CryptoKey; jwk: JWK; jkt: string }> {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  return { privateKey, jwk, jkt: await calculateJwkThumbprint(jwk, 'sha256') }
}
async function proof(key: { privateKey: CryptoKey; jwk: JWK }, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ jti: token().slice(0, 22), iat: Math.floor(Date.now() / 1000), ...claims })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.jwk, ...header }).sign(key.privateKey)
}
function replayGuard(): { claim(key: string): Promise<boolean> } {
  const seen = new Set<string>()
  return { claim: (key: string) => Promise.resolve(!seen.has(key) && !!seen.add(key)) }
}

describe('NA-0183 extension primitives', () => {
  it('matches PKCE S256 exactly and rejects any other verifier', () => {
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(pkceMatches(verifier, challenge)).toBe(true)
    expect(pkceMatches(`${verifier}x`, challenge)).toBe(false)
    expect(pkceMatches(verifier, verifier)).toBe(false)
  })
  it('accepts nonces of the current and previous window only', () => {
    let now = 1_800_000_000_000
    const nonces = new DpopNonces('k', () => now)
    const issued = nonces.issue()
    expect(nonces.valid(issued)).toBe(true)
    now += 300_000; expect(nonces.valid(issued)).toBe(true)
    now += 300_000; expect(nonces.valid(issued)).toBe(false)
    expect(nonces.valid(issued.replace(/.$/, c => (c === 'A' ? 'B' : 'A')))).toBe(false)
    expect(new DpopNonces('other', () => now).valid(nonces.issue())).toBe(false)
    expect(nonces.valid(undefined)).toBe(false)
  })
  it('compares versions numerically and treats malformed input as too old', () => {
    expect(versionAtLeast('0.10.0', '0.9.9')).toBe(true)
    expect(versionAtLeast('0.1.0', '0.1.0')).toBe(true)
    expect(versionAtLeast('0.0.9', '0.1.0')).toBe(false)
    expect(versionAtLeast('1.0', '0.1.0')).toBe(false)
    expect(versionAtLeast(undefined, '0.1.0')).toBe(false)
  })
  it('projects only labels and scope, never values, and pages deterministically', () => {
    const items = catalogSummaries(
      [{ id: 1, alias: 'b-db', description: 'prod', scope: 'PERSONAL', ownerUserId: 7, encryptedValue: 'x' } as never,
        { id: 2, alias: 'a-api', description: null, scope: 'TENANT', ownerUserId: null }],
      [{ id: 9, name: 'deploy', createdById: 8, key: 'PRIVATE' } as never], 7)
    expect(items).toEqual([
      { kind: 'secret', sourceId: 1, label: 'b-db', description: 'prod', scope: 'personal', portalPath: '/vault?kind=secret&id=1' },
      { kind: 'secret', sourceId: 2, label: 'a-api', description: null, scope: 'shared', portalPath: '/vault?kind=secret&id=2' },
      { kind: 'pem', sourceId: 9, label: 'deploy', description: null, scope: 'shared', portalPath: '/vault?kind=pem&id=9' },
    ])
    expect(JSON.stringify(items)).not.toMatch(/PRIVATE|encryptedValue/)
    expect(pageOf(items, 'PROD', undefined, undefined).items.map(i => i.sourceId)).toEqual([1])
    expect(pageOf(items, undefined, 'pem', undefined).items.map(i => i.sourceId)).toEqual([9])
    const many = Array.from({ length: 51 }, (_, i) => ({ ...items[1]!, sourceId: i + 1, label: `x${String(i).padStart(2, '0')}` }))
    const first = pageOf(many, undefined, undefined, undefined)
    expect(first.items).toHaveLength(50); expect(first.nextCursor).toBe('50')
    expect(pageOf(many, undefined, undefined, '50')).toEqual({ items: [many[50]], nextCursor: null })
  })
})

describe('NA-0183 DPoP verification', () => {
  const nonces = new DpopNonces('dpop-test')
  it('returns the key thumbprint for a valid proof and refuses its replay', async () => {
    const key = await deviceKey(), verifier = new DpopVerifier(nonces, replayGuard())
    const p = await proof(key, { htm: 'POST', htu: TOKEN_URL, nonce: nonces.issue() })
    await expect(verifier.verify(p, { method: 'POST', url: TOKEN_URL })).resolves.toBe(key.jkt)
    await expect(verifier.verify(p, { method: 'POST', url: TOKEN_URL })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID', status: 401 })
  })
  it('asks for a nonce when it is missing or stale', async () => {
    const key = await deviceKey(), verifier = new DpopVerifier(nonces, replayGuard())
    await expect(verifier.verify(await proof(key, { htm: 'POST', htu: TOKEN_URL }), { method: 'POST', url: TOKEN_URL }))
      .rejects.toMatchObject({ code: 'EXTENSION_DPOP_NONCE' })
  })
  it.each([
    ['method', { htm: 'GET' }],
    ['url', { htu: `${PORTAL}/api/v1/vault-security/extension/items` }],
    ['old iat', { iat: Math.floor(Date.now() / 1000) - 120 }],
    ['future iat', { iat: Math.floor(Date.now() / 1000) + 120 }],
    ['missing jti', { jti: undefined }],
    ['unexpected ath', { ath: 'x' }],
  ])('rejects a proof with wrong %s', async (_name, override) => {
    const key = await deviceKey(), verifier = new DpopVerifier(nonces, replayGuard())
    const p = await proof(key, { htm: 'POST', htu: TOKEN_URL, nonce: nonces.issue(), ...override })
    await expect(verifier.verify(p, { method: 'POST', url: TOKEN_URL })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
  })
  it('binds resource proofs to the access token hash', async () => {
    const key = await deviceKey(), verifier = new DpopVerifier(nonces, replayGuard()), access = token()
    const good = await proof(key, { htm: 'GET', htu: ITEMS_URL, nonce: nonces.issue(), ath: sha256b64(access) })
    await expect(verifier.verify(good, { method: 'GET', url: ITEMS_URL, accessToken: access })).resolves.toBe(key.jkt)
    const other = await proof(key, { htm: 'GET', htu: ITEMS_URL, nonce: nonces.issue(), ath: sha256b64(token()) })
    await expect(verifier.verify(other, { method: 'GET', url: ITEMS_URL, accessToken: access })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
    const none = await proof(key, { htm: 'GET', htu: ITEMS_URL, nonce: nonces.issue() })
    await expect(verifier.verify(none, { method: 'GET', url: ITEMS_URL, accessToken: access })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
  })
  it('rejects other algorithms, types, embedded private keys and garbage', async () => {
    const key = await deviceKey(), verifier = new DpopVerifier(nonces, replayGuard())
    const claims = { htm: 'POST', htu: TOKEN_URL, nonce: nonces.issue() }
    await expect(verifier.verify(await proof(key, claims, { typ: 'JWT' }), { method: 'POST', url: TOKEN_URL })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
    const leaked = { ...key, jwk: { ...key.jwk, d: 'secret' } }
    await expect(verifier.verify(await proof(leaked, claims), { method: 'POST', url: TOKEN_URL })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
    const otherKey = await deviceKey()
    const swapped = await proof({ privateKey: otherKey.privateKey, jwk: key.jwk }, claims)
    await expect(verifier.verify(swapped, { method: 'POST', url: TOKEN_URL })).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
    for (const bad of [undefined, 42, 'a.b.c', 'x'.repeat(5000)]) await expect(verifier.verify(bad, { method: 'POST', url: TOKEN_URL })).rejects.toBeInstanceOf(VaultError)
  })
})

/** In-memory model of the locked SQL records, scoped by identity like the real adapter. */
const envelope = { validate: vi.fn(() => Promise.resolve('T'.repeat(43))), seal: vi.fn((_key: unknown, context: object) => Promise.resolve(`sealed:${JSON.stringify(context)}`)) }
function harness(options: { entitled?: boolean; role?: 'ADMIN' | 'USER'; secondFactor?: boolean } = {}) {
  const state = { entitled: options.entitled ?? true, policyVersion: 1, originAlive: true, methods: { local: true, ldap: true, oidc: true, google: true },
    grants: { reveal: true, copy: false } as Record<'reveal' | 'copy', boolean>, policy: { reveal: true, copy: true }, eligible: true, confirmationSeconds: 60 }
  const tokens = new Map<string, { kind: ExtensionTokenKind; owner: string; jkt: string; value: ExtensionTokenValue }>()
  const devices = new Map<string, ExtensionDeviceRow>()
  const audits: Array<{ type: string; reasonCode?: string | undefined }> = []
  const owner = (i: VaultIdentity): string => `${i.tenantId}:${i.userId}`
  const records = (i: VaultIdentity): ExtensionRecords => ({
    entitled: () => Promise.resolve(state.entitled),
    granted: action => Promise.resolve(state.grants[action]),
    device: jkt => Promise.resolve(devices.get(`${owner(i)}:${jkt}`) ?? null),
    activateDevice: (jkt, extensionId) => { devices.set(`${owner(i)}:${jkt}`, { jkt, extensionId, state: 'ACTIVE', createdAt: Date.now(), lastUsedAt: null }); return Promise.resolve() },
    touchDevice: jkt => { const d = devices.get(`${owner(i)}:${jkt}`); if (d) d.lastUsedAt = Date.now(); return Promise.resolve() },
    revokeDevice: jkt => {
      const d = devices.get(`${owner(i)}:${jkt}`)
      if (!d || d.state !== 'ACTIVE') return Promise.resolve(false)
      d.state = 'REVOKED'; for (const [k, t] of tokens) if (t.jkt === jkt) tokens.delete(k)
      return Promise.resolve(true)
    },
    devices: () => Promise.resolve([...devices.entries()].filter(([k]) => k.startsWith(`${owner(i)}:`)).map(([, d]) => d)),
    put: (kind, t, jkt, value) => {
      if (tokens.has(t)) return Promise.reject(new Error('duplicate key'))
      tokens.set(t, { kind, owner: owner(i), jkt, value }); return Promise.resolve()
    },
    releaseTrust: jkt => { tokens.delete(`trust:${jkt}`); return Promise.resolve() },
    dropAccess: jkt => { for (const [k, t] of tokens) if (t.kind === 'access' && t.jkt === jkt && t.owner === owner(i)) tokens.delete(k); return Promise.resolve() },
    get: <T extends ExtensionTokenValue>(kind: ExtensionTokenKind, t: string) => {
      const row = tokens.get(t)
      return Promise.resolve(row && row.kind === kind && row.owner === owner(i) ? { jkt: row.jkt, value: row.value as T } : null)
    },
    take: <T extends ExtensionTokenValue>(kind: ExtensionTokenKind, t: string) => {
      const row = tokens.get(t)
      if (!row || row.kind !== kind || row.owner !== owner(i)) return Promise.resolve(null)
      tokens.delete(t); return Promise.resolve({ jkt: row.jkt, value: row.value as T })
    },
  })
  const authority = (): VaultAuthority => ({ policy: { version: state.policyVersion, unlock: true, reveal: state.policy.reveal, copy: state.policy.copy, localReauth: true, origin: PORTAL, tenantQuota: 300, confirmationSeconds: state.confirmationSeconds },
    validUntil: Number.MAX_SAFE_INTEGER, role: options.role ?? 'USER', passwordHash: null, mfaSecret: 's', credentialVersion: 'c', email: 'u@example.test', methods: state.methods })
  const vaultRecords = new Map<string, object>()
  const store: VaultStore = { transaction: async <T>(i: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> => {
    const key = (kind: string, t: string): string => `${i.tenantId}:${i.userId}:${kind}:${t}`
    const tx = { authority: authority(), now: Date.now, extension: records(i), limit: () => Promise.resolve(),
      get: (kind: string, t: string) => Promise.resolve(structuredClone(vaultRecords.get(key(kind, t)) ?? null)),
      put: (kind: string, t: string, value: object) => { vaultRecords.set(key(kind, t), structuredClone(value)); return Promise.resolve() },
      remove: (kind: string, t: string) => { vaultRecords.delete(key(kind, t)); return Promise.resolve() },
      secret: (id: number, action: 'reveal' | 'copy') => (id === 1 && state.eligible && state.grants[action] && state.policy[action]
        ? Promise.resolve({ encrypted: 'e', iv: 'i', version: 'f'.repeat(64) }) : Promise.reject(new VaultError('VAULT_FORBIDDEN', 403))),
      audit: (e: { type: string; reasonCode?: string }) => { audits.push({ type: e.type, reasonCode: e.reasonCode }); return Promise.resolve() } } as unknown as VaultTransaction
    return run(tx)
  } }
  const vault = {
    admitted: <T>(run: () => Promise<T>) => run(),
    inspect: <T>(i: VaultIdentity, o: string, _k: string, run: (tx: VaultTransaction) => Promise<T>) =>
      o === PORTAL ? store.transaction(i, run) : Promise.reject(new VaultError('VAULT_FORBIDDEN', 403)),
    confirmed: <T>(i: VaultIdentity, _c: string, _o: string, _s: string, _k: string, run: (tx: VaultTransaction, client: { origin: VaultOrigin }) => Promise<T>) =>
      store.transaction(i, tx => run(tx, { origin: centralOrigin })),
  } as unknown as VaultService
  const originVerifier: OriginVerifier = { bind: () => Promise.resolve(centralOrigin),
    assert: () => (state.originAlive ? Promise.resolve() : Promise.reject(new VaultError('VAULT_ORIGIN_REVOKED', 423))) }
  const locator = { locate: (kind: ExtensionTokenKind, t: string) => {
    const row = tokens.get(t)
    if (!row || row.kind !== kind) return Promise.resolve(null)
    const [tenantId, userId] = row.owner.split(':').map(Number) as [number, number]
    return Promise.resolve({ tenantId, userId, sessionVersion: row.value.sessionVersion })
  } }
  const nonces = new DpopNonces('svc')
  const catalog: VaultCatalog = { list: (_i, admin) => Promise.resolve(catalogSummaries([{ id: 1, alias: admin ? 'admin-item' : 'mine', description: null, scope: 'PERSONAL', ownerUserId: 7 }], [], 7)) }
  const service = new VaultExtensionService(vault, store, locator, originVerifier, new DpopVerifier(nonces, replayGuard()), nonces,
    { token, digest: v => createHash('sha256').update(v).digest('hex') }, catalog, { enabled: true, extensionIds: [EXT], minVersion: '0.1.0' },
    Date.now, options.secondFactor === false ? undefined : { verifySecondFactor: (otp: string) => otp === '123456' }, envelope)
  return { state, tokens, devices, audits, service, nonces, vaultRecords }
}
async function connect(h: ReturnType<typeof harness>, key?: Awaited<ReturnType<typeof deviceKey>>) {
  const device = key ?? await deviceKey()
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const { code } = await h.service.authorize(identity, 'client', PORTAL, { extensionId: EXT, redirectUri: extensionRedirectUri(EXT), state: token(), codeChallenge: challenge, deviceJkt: device.jkt, sessionId: token() })
  const exchange = async (override: Partial<{ code: string; codeVerifier: string; key: typeof device; origin: string; version: string }> = {}) => h.service.token({
    requestOrigin: override.origin ?? `chrome-extension://${EXT}`, version: override.version ?? '0.1.0', url: TOKEN_URL,
    proof: await proof(override.key ?? device, { htm: 'POST', htu: TOKEN_URL, nonce: h.nonces.issue() }),
  }, { code: override.code ?? code, codeVerifier: override.codeVerifier ?? verifier, redirectUri: extensionRedirectUri(EXT), extensionId: EXT })
  return { device, code, verifier, exchange }
}
async function call(h: ReturnType<typeof harness>, device: Awaited<ReturnType<typeof deviceKey>>, access: string, url = ITEMS_URL) {
  const req = { requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url, proof: await proof(device, { htm: 'GET', htu: url, nonce: h.nonces.issue(), ath: sha256b64(access) }) }
  return url.endsWith('/items') ? h.service.items(req, `DPoP ${access}`, {}) : h.service.capabilities(req, `DPoP ${access}`)
}

describe('NA-0183 extension service', () => {
  it('connects, lists metadata and records the audit trail', async () => {
    const h = harness(), c = await connect(h)
    const { accessToken, tokenType } = await c.exchange()
    expect(tokenType).toBe('DPoP')
    await expect(call(h, c.device, accessToken)).resolves.toEqual({ items: [expect.objectContaining({ label: 'mine', scope: 'personal' })], nextCursor: null })
    await expect(call(h, c.device, accessToken, `${PORTAL}/api/v1/vault-security/extension/capabilities`)).resolves.toMatchObject({ apiVersion: 1, features: { reveal: true, copy: false, create: false } })
    expect(h.audits.map(a => a.type)).toEqual(['EXTENSION_AUTHORIZED', 'EXTENSION_CLIENT_REGISTERED'])
  })
  it('denies consent without the extension permission and audits it', async () => {
    const h = harness({ entitled: false })
    await expect(connect(h)).rejects.toMatchObject({ code: 'EXTENSION_FORBIDDEN', status: 403 })
    expect(h.tokens.size).toBe(0)
    expect(h.audits).toContainEqual({ type: 'EXTENSION_DENIED', reasonCode: 'NOT_ENTITLED' })
  })
  it('rejects unknown extension IDs and redirect URIs before any token exists', async () => {
    const h = harness(), device = await deviceKey()
    const base = { extensionId: EXT, redirectUri: extensionRedirectUri(EXT), state: token(), codeChallenge: token(), deviceJkt: device.jkt, sessionId: token() }
    await expect(h.service.authorize(identity, 'c', PORTAL, { ...base, extensionId: 'p'.repeat(32), redirectUri: extensionRedirectUri('p'.repeat(32)) })).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    await expect(h.service.authorize(identity, 'c', PORTAL, { ...base, redirectUri: `${extensionRedirectUri(EXT)}x` })).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    expect(h.tokens.size).toBe(0)
  })
  it.each([
    ['wrong verifier', { codeVerifier: randomBytes(48).toString('base64url') }],
    ['unknown code', { code: token() }],
  ])('refuses a code exchange with %s', async (_name, override) => {
    const h = harness(), c = await connect(h)
    await expect(c.exchange(override)).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
  })
  it('burns the code on a failed exchange and never accepts it twice', async () => {
    const h = harness(), c = await connect(h)
    await expect(c.exchange({ key: await deviceKey() })).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
    await expect(c.exchange()).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
    const d = harness(), ok = await connect(d)
    await ok.exchange()
    await expect(ok.exchange()).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
  })
  it('refuses foreign origins and old extension versions', async () => {
    const h = harness(), c = await connect(h)
    await expect(c.exchange({ origin: 'https://evil.example' })).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    await expect(c.exchange({ version: '0.0.1' })).rejects.toMatchObject({ code: 'EXTENSION_UPGRADE_REQUIRED', status: 426 })
  })
  it('expires codes after their deadline', async () => {
    const h = harness(), c = await connect(h)
    for (const row of h.tokens.values()) row.value.expiresAt = Date.now() - 1
    await expect(c.exchange()).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
  })
  it('cuts access after revoking the permission, the device, the central session or a policy change', async () => {
    for (const cut of ['permission', 'device', 'origin', 'policy', 'method'] as const) {
      const h = harness(), c = await connect(h)
      const { accessToken } = await c.exchange()
      await call(h, c.device, accessToken)
      if (cut === 'permission') h.state.entitled = false
      if (cut === 'device') await h.service.revokeDevice(identity, PORTAL, c.device.jkt)
      if (cut === 'origin') h.state.originAlive = false
      if (cut === 'policy') h.state.policyVersion++
      if (cut === 'method') h.state.methods.local = false
      await expect(call(h, c.device, accessToken)).rejects.toMatchObject({ status: cut === 'permission' ? 403 : 401 })
    }
  })
  it('refuses authorizations presented with another device key or without DPoP', async () => {
    const h = harness(), c = await connect(h)
    const { accessToken } = await c.exchange()
    await expect(call(h, await deviceKey(), accessToken)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await expect(h.service.items({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: ITEMS_URL, proof: undefined }, `DPoP ${accessToken}`, {}))
      .rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
    await expect(h.service.items({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: ITEMS_URL, proof: 'x' }, `Bearer ${accessToken}`, {}))
      .rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
  })
  it('accepts resource GETs without Origin (Chromium omits it) but never a foreign one', async () => {
    const h = harness(), c = await connect(h)
    const { accessToken } = await c.exchange()
    const request = async (requestOrigin: unknown) => h.service.items({ requestOrigin, version: '0.1.0', url: ITEMS_URL,
      proof: await proof(c.device, { htm: 'GET', htu: ITEMS_URL, nonce: h.nonces.issue(), ath: sha256b64(accessToken) }) }, `DPoP ${accessToken}`, {})
    await expect(request(undefined)).resolves.toMatchObject({ items: [expect.anything()] })
    await expect(request('https://evil.example')).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    await expect(request(`chrome-extension://${'p'.repeat(32)}`)).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    const fresh = await connect(h)
    await expect(h.service.token({ requestOrigin: undefined, version: '0.1.0', url: TOKEN_URL, proof: await proof(fresh.device, { htm: 'POST', htu: TOKEN_URL, nonce: h.nonces.issue() }) },
      { code: fresh.code, codeVerifier: fresh.verifier, redirectUri: extensionRedirectUri(EXT), extensionId: EXT })).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
  })
  it('refuses a request addressed to another portal origin', async () => {
    const h = harness(), c = await connect(h)
    const { accessToken } = await c.exchange()
    await expect(call(h, c.device, accessToken, 'https://other.example.test/api/v1/vault-security/extension/items')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
  })
  it('activates the device only after its key completes the exchange', async () => {
    const h = harness(), c = await connect(h)
    expect(h.devices.size).toBe(0)
    await expect(c.exchange({ key: await deviceKey() })).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
    expect(h.devices.size).toBe(0)
  })
  it('lists and revokes only the caller devices, from the portal origin', async () => {
    const h = harness(), c = await connect(h)
    await c.exchange()
    await expect(h.service.devices(identity, PORTAL)).resolves.toEqual({ devices: [expect.objectContaining({ jkt: c.device.jkt, state: 'ACTIVE' })] })
    await expect(h.service.devices(identity, 'https://evil.example')).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    await expect(h.service.revokeDevice({ ...identity, userId: 99 }, PORTAL, c.device.jkt)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    await h.service.revokeDevice(identity, PORTAL, c.device.jkt)
    await expect(h.service.revokeDevice(identity, PORTAL, c.device.jkt)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect(h.audits.map(a => a.type)).toContain('DEVICE_REVOKED')
  })
  it('is entirely off when the flag is disabled', async () => {
    const h = harness()
    Object.assign((h.service as unknown as { config: { enabled: boolean } }).config, { enabled: false })
    await expect(connect(h)).rejects.toMatchObject({ code: 'EXTENSION_DISABLED', status: 404 })
    await expect(h.service.devices(identity, PORTAL)).rejects.toMatchObject({ code: 'EXTENSION_DISABLED' })
  })
})

async function renew(h: ReturnType<typeof harness>, device: Awaited<ReturnType<typeof deviceKey>>, otp?: string, override: Partial<{ origin: string; version: string; extensionId: string }> = {}) {
  return h.service.renew({ requestOrigin: override.origin ?? `chrome-extension://${EXT}`, version: override.version ?? '0.1.0', url: RENEW_URL,
    proof: await proof(device, { htm: 'POST', htu: RENEW_URL, nonce: h.nonces.issue() }) }, { extensionId: override.extensionId ?? EXT, ...(otp ? { otp } : {}) })
}
const trustOf = (h: ReturnType<typeof harness>, jkt: string) => h.tokens.get(`trust:${jkt}`)?.value as ExtensionTrust | undefined
describe('NA-0193 trusted device renewal', () => {
  it('a full consent trusts the device for 7 days; renewal is automatic while the consenting portal login lives', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    const trust = trustOf(h, c.device.jkt)!
    expect(trust).toMatchObject({ extensionId: EXT, failures: 0, sessionVersion: 2 })
    expect(trust.expiresAt - Date.now()).toBeGreaterThan(7 * 24 * 3_600_000 - 5_000)
    const renewed = await renew(h, c.device)
    expect(renewed.tokenType).toBe('DPoP')
    await expect(call(h, c.device, renewed.accessToken)).resolves.toMatchObject({ items: [expect.objectContaining({ label: 'mine' })] })
    expect(h.audits).toContainEqual({ type: 'EXTENSION_RENEWED', reasonCode: 'SESSION' })
    expect((h.tokens.get(renewed.accessToken)?.value as ExtensionAccess).origin).toEqual(centralOrigin)
  })
  it('after the portal login ended it asks for the code; a right code renews without a central session', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    h.state.originAlive = false
    await expect(renew(h, c.device)).rejects.toMatchObject({ code: 'EXTENSION_REAUTH_REQUIRED', status: 401 })
    await expect(renew(h, c.device, '000000')).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED', status: 403 })
    expect(trustOf(h, c.device.jkt)?.failures).toBe(1)
    expect(h.audits).toContainEqual({ type: 'EXTENSION_RENEW_DENIED', reasonCode: 'OTP_INVALID' })
    const renewed = await renew(h, c.device, '123456')
    expect(trustOf(h, c.device.jkt)?.failures).toBe(0)
    expect((h.tokens.get(renewed.accessToken)?.value as ExtensionAccess).origin).toBeNull()
    await expect(call(h, c.device, renewed.accessToken)).resolves.toMatchObject({ items: [expect.objectContaining({ label: 'mine' })] })
    expect(h.audits).toContainEqual({ type: 'EXTENSION_RENEWED', reasonCode: 'OTP' })
  })
  it('the fifth wrong code ends the trust: a full consent is needed again', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    for (let i = 1; i < 5; i++) await expect(renew(h, c.device, '000000')).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
    await expect(renew(h, c.device, '000000')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED', status: 401 })
    expect(trustOf(h, c.device.jkt)).toBeUndefined()
    expect(h.audits).toContainEqual({ type: 'EXTENSION_RENEW_DENIED', reasonCode: 'TRUST_ENDED' })
    await expect(renew(h, c.device, '123456')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
  })
  it('ends with the device or the 7 days (session version: MySQL test); keeps the trust while the permission is off', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    h.state.entitled = false
    await expect(renew(h, c.device)).rejects.toMatchObject({ code: 'EXTENSION_FORBIDDEN', status: 403 })
    expect(trustOf(h, c.device.jkt)).toBeDefined()
    h.state.entitled = true
    trustOf(h, c.device.jkt)!.expiresAt = Date.now() - 1
    await expect(renew(h, c.device)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    expect(trustOf(h, c.device.jkt)).toBeUndefined()
    const d = await connect(h); await d.exchange()
    h.devices.get(`3:7:${d.device.jkt}`)!.state = 'REVOKED'
    await expect(renew(h, d.device)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
  })
  it('refuses another key, extension, origin or an old version before looking at any code', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    await expect(renew(h, await deviceKey(), '123456')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await expect(renew(h, c.device, '123456', { extensionId: 'p'.repeat(32) })).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    await expect(renew(h, c.device, '123456', { origin: `chrome-extension://${'p'.repeat(32)}` })).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
    await expect(renew(h, c.device, '123456', { version: '0.0.9' })).rejects.toMatchObject({ code: 'EXTENSION_UPGRADE_REQUIRED', status: 426 })
    expect(trustOf(h, c.device.jkt)?.failures).toBe(0)
  })
  it('renews across a policy change with the current version; without a TOTP checker no code is accepted', async () => {
    const h = harness(), c = await connect(h), first = await c.exchange()
    h.state.policyVersion = 2
    await expect(call(h, c.device, first.accessToken)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    const renewed = await renew(h, c.device)
    expect((h.tokens.get(renewed.accessToken)?.value as ExtensionAccess).policyVersion).toBe(2)
    const strict = harness({ secondFactor: false }), d = await connect(strict); await d.exchange()
    strict.state.originAlive = false
    await expect(renew(strict, d.device, '123456')).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
  })
  it('"Disconnect" ends the trust and authorizations by the device key alone, even with an expired authorization', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    const forget = async (key = c.device, extensionId = EXT) => h.service.forget({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${PORTAL}/api/v1/vault-security/extension/forget`,
      proof: await proof(key, { htm: 'POST', htu: `${PORTAL}/api/v1/vault-security/extension/forget`, nonce: h.nonces.issue() }) }, { extensionId })
    h.state.originAlive = false
    await expect(forget()).resolves.toEqual({ state: 'FORGOTTEN' })
    expect(trustOf(h, c.device.jkt)).toBeUndefined(); expect(h.tokens.has(accessToken)).toBe(false)
    expect(h.audits).toContainEqual({ type: 'EXTENSION_TRUST_ENDED', reasonCode: 'USER_DISCONNECTED' })
    await expect(renew(h, c.device, '123456')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await expect(forget()).resolves.toEqual({ state: 'FORGOTTEN' })
    await expect(forget(c.device, 'p'.repeat(32))).rejects.toMatchObject({ code: 'EXTENSION_CLIENT_INVALID' })
  })
  it('one trust per device key: a full consent by another user on the same browser replaces it', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    const other: VaultIdentity = { userId: 8, tenantId: 3, sessionVersion: 2 }
    const verifier = randomBytes(48).toString('base64url')
    const { code } = await h.service.authorize(other, 'client', PORTAL, { extensionId: EXT, redirectUri: extensionRedirectUri(EXT), state: token(),
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'), deviceJkt: c.device.jkt, sessionId: token() })
    await h.service.token({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: TOKEN_URL, proof: await proof(c.device, { htm: 'POST', htu: TOKEN_URL, nonce: h.nonces.issue() }) },
      { code, codeVerifier: verifier, redirectUri: extensionRedirectUri(EXT), extensionId: EXT })
    expect(h.tokens.get(`trust:${c.device.jkt}`)?.owner).toBe('3:8')
  })
  it('code mode still obeys the tenant login-method policy, on renewal and on every request', async () => {
    const h = harness(), c = await connect(h); await c.exchange()
    h.state.originAlive = false
    const byCode = await renew(h, c.device, '123456')
    expect((h.tokens.get(byCode.accessToken)?.value as ExtensionAccess).method).toBe('local')
    h.state.methods = { ...h.state.methods, local: false }
    await expect(call(h, c.device, byCode.accessToken)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await expect(renew(h, c.device, '123456')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    expect(trustOf(h, c.device.jkt)).toBeDefined()
  })

  const recipient = { kty: 'RSA' as const, n: 'n'.repeat(342), e: 'AQAB' as const }
  async function post(h: ReturnType<typeof harness>, device: Awaited<ReturnType<typeof deviceKey>>, access: string, path: 'unlock' | 'deliver' | 'proof-request' | 'proof-claim') {
    const url = `${PORTAL}/api/v1/vault-security/extension/${path}`
    return { requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url, proof: await proof(device, { htm: 'POST', htu: url, nonce: h.nonces.issue(), ath: sha256b64(access) }) }
  }
  it('NA-0200: a portal confirmation approves a request that only the same key redeems, once, into a proof for the tenant window', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    const asked = await h.service.proofRequest(await post(h, c.device, accessToken, 'proof-request'), `DPoP ${accessToken}`)
    expect(asked.request).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(asked.url).toBe(`${PORTAL}/vault/extension/confirm?request=${asked.request}`)
    expect(asked.expiresAt - asked.serverNow).toBeLessThanOrEqual(120_000)
    expect(JSON.stringify([...h.vaultRecords.values()])).not.toContain(accessToken)
    // The portal page shows which device asks (its key thumbprint).
    expect(await h.service.proofInfo(identity, PORTAL, asked.request)).toMatchObject({ device: c.device.jkt })
    // Pending: nothing changes.
    expect(await h.service.proofClaim(await post(h, c.device, accessToken, 'proof-claim'), `DPoP ${accessToken}`, { request: asked.request })).toEqual({ state: 'PENDING' })
    expect((h.tokens.get(accessToken)?.value as ExtensionAccess).proofAt).toBeUndefined()
    expect(await h.service.proofApprove(identity, 'client', PORTAL, 's'.repeat(43), asked.request)).toEqual({ state: 'APPROVED' })
    expect(h.audits).toContainEqual({ type: 'EXTENSION_PROOF_APPROVED', reasonCode: undefined })
    // Approved once; the page cannot approve it again nor read it.
    await expect(h.service.proofApprove(identity, 'client', PORTAL, 's'.repeat(43), asked.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE', status: 409 })
    await expect(h.service.proofInfo(identity, PORTAL, asked.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    const claimed = await h.service.proofClaim(await post(h, c.device, accessToken, 'proof-claim'), `DPoP ${accessToken}`, { request: asked.request })
    expect(claimed).toMatchObject({ state: 'APPROVED' })
    expect((h.tokens.get(accessToken)?.value as ExtensionAccess).proofAt).toBeTypeOf('number')
    expect(h.audits).toContainEqual({ type: 'EXTENSION_UNLOCKED', reasonCode: 'PORTAL_CONFIRMATION' })
    // Redeemed once.
    await expect(h.service.proofClaim(await post(h, c.device, accessToken, 'proof-claim'), `DPoP ${accessToken}`, { request: asked.request })).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
  })
  it('NA-0200: another key cannot redeem, an unknown or expired request is refused, and a revoked device is not approved', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    const other = await connect(h), { accessToken: otherToken } = await other.exchange()
    const asked = await h.service.proofRequest(await post(h, c.device, accessToken, 'proof-request'), `DPoP ${accessToken}`)
    await h.service.proofApprove(identity, 'client', PORTAL, 's'.repeat(43), asked.request)
    await expect(h.service.proofClaim(await post(h, other.device, otherToken, 'proof-claim'), `DPoP ${otherToken}`, { request: asked.request })).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    expect((h.tokens.get(otherToken)?.value as ExtensionAccess).proofAt).toBeUndefined()
    await expect(h.service.proofApprove(identity, 'client', PORTAL, 's'.repeat(43), 'u'.repeat(43))).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    await expect(h.service.proofInfo(identity, 'https://other.test', asked.request)).rejects.toMatchObject({ status: 403 })
    // Another user (or tenant) sees nothing and cannot approve it: records are scoped to the identity.
    const stranger = { userId: identity.userId + 1, tenantId: identity.tenantId, sessionVersion: identity.sessionVersion }
    const fresh = await h.service.proofRequest(await post(h, c.device, accessToken, 'proof-request'), `DPoP ${accessToken}`)
    await expect(h.service.proofInfo(stranger, PORTAL, fresh.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    await expect(h.service.proofApprove(stranger, 'client', PORTAL, 's'.repeat(43), fresh.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    await expect(h.service.proofApprove({ ...identity, tenantId: identity.tenantId + 1 }, 'client', PORTAL, 's'.repeat(43), fresh.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    const late = await h.service.proofRequest(await post(h, c.device, accessToken, 'proof-request'), `DPoP ${accessToken}`)
    for (const [k, v] of h.vaultRecords) h.vaultRecords.set(k, { ...v, expiresAt: Date.now() - 1 })
    await expect(h.service.proofApprove(identity, 'client', PORTAL, 's'.repeat(43), late.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
    const again = await h.service.proofRequest(await post(h, c.device, accessToken, 'proof-request'), `DPoP ${accessToken}`)
    for (const d of h.devices.values()) if (d.jkt === c.device.jkt) d.state = 'REVOKED'
    await expect(h.service.proofApprove(identity, 'client', PORTAL, 's'.repeat(43), again.request)).rejects.toMatchObject({ code: 'EXTENSION_PROOF_UNAVAILABLE' })
  })
  it('NA-0195: the authenticator code opens a proof for the tenant window; a wrong code is refused and audited', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    await expect(h.service.unlock(await post(h, c.device, accessToken, 'unlock'), `DPoP ${accessToken}`, { otp: '000000' })).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED', status: 403 })
    expect(h.audits).toContainEqual({ type: 'EXTENSION_UNLOCK_DENIED', reasonCode: 'OTP_INVALID' })
    expect(trustOf(h, c.device.jkt)?.failures).toBe(1)
    h.state.confirmationSeconds = 300
    const { proofUntil, serverNow } = await h.service.unlock(await post(h, c.device, accessToken, 'unlock'), `DPoP ${accessToken}`, { otp: '123456' })
    expect(proofUntil - serverNow).toBeGreaterThan(299_000); expect(proofUntil - serverNow).toBeLessThanOrEqual(300_000)
    expect((h.tokens.get(accessToken)?.value as ExtensionAccess).proofAt).toBeTypeOf('number')
    expect(trustOf(h, c.device.jkt)?.failures).toBe(0)
    const caps = await call(h, c.device, accessToken, `${PORTAL}/api/v1/vault-security/extension/capabilities`) as { features: object; proofUntil?: number }
    expect(caps.features).toEqual({ reveal: true, copy: false, create: false }); expect(caps.proofUntil).toBe(proofUntil)
  })
  it('NA-0195: releases a sealed value only with a fresh proof, the grant, an eligible item and the policy', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    const deliver = async (input: Partial<{ secretId: number; action: 'reveal' | 'copy' }> = {}) =>
      h.service.deliver(await post(h, c.device, accessToken, 'deliver'), `DPoP ${accessToken}`, { secretId: 1, action: 'reveal', recipient, ...input })
    await expect(deliver()).rejects.toMatchObject({ code: 'VAULT_STEP_UP_REQUIRED', status: 423 })
    await h.service.unlock(await post(h, c.device, accessToken, 'unlock'), `DPoP ${accessToken}`, { otp: '123456' })
    const released = await deliver()
    expect(released.context).toMatchObject({ version: 1, action: 'reveal', itemRef: 'secret:1', tenantId: 3, userId: 7, recipientThumbprint: 'T'.repeat(43), origin: PORTAL, secretVersion: 'f'.repeat(64) })
    expect(released.context.clientId).toMatch(/^[a-f0-9]{64}$/); expect(released.envelope).toBe(`sealed:${JSON.stringify(released.context)}`)
    expect(released.context.expiresAt).toBeLessThanOrEqual(released.serverNow + 30_000)
    expect(h.audits).toContainEqual({ type: 'DELIVERY_RELEASE_COMMITTED', reasonCode: undefined })
    await expect(deliver({ action: 'copy' })).rejects.toMatchObject({ code: 'EXTENSION_ITEM_DENIED', status: 403 })
    await expect(deliver({ secretId: 2 })).rejects.toMatchObject({ code: 'EXTENSION_ITEM_DENIED' })
    h.state.eligible = false
    await expect(deliver()).rejects.toMatchObject({ code: 'EXTENSION_ITEM_DENIED' })
    expect(h.tokens.has(accessToken)).toBe(true)
  })
  it('NA-0195: the fifth wrong code ends the trust and the authorization (shared counter with renewal)', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    for (let i = 1; i < 5; i++) await expect(h.service.unlock(await post(h, c.device, accessToken, 'unlock'), `DPoP ${accessToken}`, { otp: '000000' })).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
    await expect(h.service.unlock(await post(h, c.device, accessToken, 'unlock'), `DPoP ${accessToken}`, { otp: '000000' })).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED', status: 401 })
    expect(trustOf(h, c.device.jkt)).toBeUndefined(); expect(h.tokens.has(accessToken)).toBe(false)
    expect(h.audits).toContainEqual({ type: 'EXTENSION_UNLOCK_DENIED', reasonCode: 'TRUST_ENDED' })
  })
  it('NA-0195: the proof expires with the tenant window and does not survive a renewed authorization', async () => {
    const h = harness(), c = await connect(h), { accessToken } = await c.exchange()
    await h.service.unlock(await post(h, c.device, accessToken, 'unlock'), `DPoP ${accessToken}`, { otp: '123456' })
    const row = h.tokens.get(accessToken)!.value as ExtensionAccess
    row.proofAt = Date.now() - 61_000
    await expect(h.service.deliver(await post(h, c.device, accessToken, 'deliver'), `DPoP ${accessToken}`, { secretId: 1, action: 'reveal', recipient })).rejects.toMatchObject({ code: 'VAULT_STEP_UP_REQUIRED' })
    const renewed = await renew(h, c.device)
    expect((h.tokens.get(renewed.accessToken)?.value as ExtensionAccess).proofAt).toBeUndefined()
  })
})
