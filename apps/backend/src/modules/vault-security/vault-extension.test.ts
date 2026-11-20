import { describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { DpopNonces, DpopVerifier, pkceMatches, sha256b64 } from './vault-extension-dpop.js'
import { catalogSummaries, pageOf, VaultExtensionService, type VaultCatalog } from './vault-extension.service.js'
import { extensionRedirectUri, versionAtLeast, type ExtensionAccess, type ExtensionCode, type ExtensionDeviceRow, type ExtensionRecords, type ExtensionTokenKind } from './vault-extension-domain.js'
import { VaultError, type VaultAuthority, type VaultIdentity, type VaultOrigin } from './vault-domain.js'
import type { OriginVerifier, VaultStore, VaultTransaction } from './vault-ports.js'
import type { VaultService } from './vault.service.js'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const PORTAL = 'https://vault.example.test'
const TOKEN_URL = `${PORTAL}/api/v1/vault-security/extension/token`
const ITEMS_URL = `${PORTAL}/api/v1/vault-security/extension/items`
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
function harness(options: { entitled?: boolean; role?: 'ADMIN' | 'USER' } = {}) {
  const state = { entitled: options.entitled ?? true, policyVersion: 1, originAlive: true, methods: { local: true, ldap: true, oidc: true, google: true } }
  const tokens = new Map<string, { kind: ExtensionTokenKind; owner: string; jkt: string; value: ExtensionCode | ExtensionAccess }>()
  const devices = new Map<string, ExtensionDeviceRow>()
  const audits: Array<{ type: string; reasonCode?: string | undefined }> = []
  const owner = (i: VaultIdentity): string => `${i.tenantId}:${i.userId}`
  const records = (i: VaultIdentity): ExtensionRecords => ({
    entitled: () => Promise.resolve(state.entitled),
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
    put: (kind, t, jkt, value) => { tokens.set(t, { kind, owner: owner(i), jkt, value }); return Promise.resolve() },
    get: <T extends ExtensionCode | ExtensionAccess>(kind: ExtensionTokenKind, t: string) => {
      const row = tokens.get(t)
      return Promise.resolve(row && row.kind === kind && row.owner === owner(i) ? { jkt: row.jkt, value: row.value as T } : null)
    },
    take: <T extends ExtensionCode | ExtensionAccess>(kind: ExtensionTokenKind, t: string) => {
      const row = tokens.get(t)
      if (!row || row.kind !== kind || row.owner !== owner(i)) return Promise.resolve(null)
      tokens.delete(t); return Promise.resolve({ jkt: row.jkt, value: row.value as T })
    },
  })
  const authority = (): VaultAuthority => ({ policy: { version: state.policyVersion, unlock: true, reveal: true, copy: true, localReauth: true, origin: PORTAL, tenantQuota: 300 },
    validUntil: Number.MAX_SAFE_INTEGER, role: options.role ?? 'USER', passwordHash: null, mfaSecret: 's', credentialVersion: 'c', email: 'u@example.test', methods: state.methods })
  const store: VaultStore = { transaction: async <T>(i: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> => {
    const tx = { authority: authority(), now: Date.now, extension: records(i), limit: () => Promise.resolve(),
      audit: (e: { type: string; reasonCode?: string }) => { audits.push({ type: e.type, reasonCode: e.reasonCode }); return Promise.resolve() } } as unknown as VaultTransaction
    return run(tx)
  } }
  const vault = {
    admitted: <T>(run: () => Promise<T>) => run(),
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
    { token, digest: v => createHash('sha256').update(v).digest('hex') }, catalog, { enabled: true, extensionIds: [EXT], minVersion: '0.1.0' })
  return { state, tokens, devices, audits, service, nonces }
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
    await expect(call(h, c.device, accessToken, `${PORTAL}/api/v1/vault-security/extension/capabilities`)).resolves.toMatchObject({ apiVersion: 1, features: { reveal: false, copy: false, create: false } })
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
  it('refuses a request addressed to another portal origin', async () => {
    const h = harness(), c = await connect(h)
    const { accessToken } = await c.exchange()
    await expect(call(h, c.device, accessToken, 'https://other.example.test/api/v1/vault-security/extension/items')).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
  })
  it('lists and revokes only the caller devices, from the portal origin', async () => {
    const h = harness(), c = await connect(h)
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
