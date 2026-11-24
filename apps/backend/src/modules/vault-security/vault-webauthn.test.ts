import { describe, expect, it, vi } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { VaultService } from './vault.service.js'
import { VaultWebauthnService } from './vault-webauthn.service.js'
import { SimpleWebauthnVerifier } from './vault-webauthn.js'
import { VaultError, webauthnRpId, type VaultAuthority, type VaultEvent, type VaultIdentity } from './vault-domain.js'
import type { VaultStore, VaultTransaction, WebauthnCredential, WebauthnRecords, WebauthnVerifier } from './vault-ports.js'

// NA-0198 — Windows Hello / passkey: unlock answers the same challenge, registration needs a fresh session.
const identity: VaultIdentity = { userId: 1, tenantId: 2, sessionVersion: 3 }
const ORIGIN = 'https://vault.example.test'
const entropy = { token: () => randomBytes(32).toString('base64url'), digest: (s: string) => createHash('sha256').update(s).digest('hex') }
const response = (id = 'cred-1') => ({ id })
function fixture(origin = ORIGIN) {
  let time = 1000
  const records = new Map<string, unknown>(), counts = new Map<string, number>(), events: VaultEvent[] = []
  const credentials = new Map<string, WebauthnCredential>()
  const authority: VaultAuthority = { policy: { version: 1, unlock: true, reveal: true, copy: true, localReauth: true, origin, tenantQuota: 100 },
    validUntil: Number.MAX_SAFE_INTEGER, role: 'USER', passwordHash: 'h', mfaSecret: 'm', credentialVersion: 'c1', email: 'user@example.test',
    methods: { local: true, ldap: true, oidc: true, google: true } }
  const webauthn: WebauthnRecords = {
    list: () => Promise.resolve([...credentials.values()].map(c => structuredClone(c))),
    find: id => Promise.resolve(credentials.has(id) ? structuredClone(credentials.get(id)!) : null),
    add: c => { if (credentials.has(c.id)) return Promise.resolve(false); credentials.set(c.id, { ...c, createdAt: time, lastUsedAt: null }); return Promise.resolve(true) },
    used: (id, counter) => { const c = credentials.get(id); if (c) { c.counter = counter; c.lastUsedAt = time } return Promise.resolve() },
    remove: id => Promise.resolve(credentials.delete(id)),
  }
  const verifier = {
    authenticationOptions: vi.fn<WebauthnVerifier['authenticationOptions']>(i => Promise.resolve({ challenge: i.challenge, rpId: i.rpID, allowCredentials: i.allow })),
    verifyAuthentication: vi.fn<WebauthnVerifier['verifyAuthentication']>(i => Promise.resolve({ counter: i.credential.counter + 1 })),
    registrationOptions: vi.fn<WebauthnVerifier['registrationOptions']>(i => Promise.resolve({ challenge: i.challenge, rp: { id: i.rpID } })),
    verifyRegistration: vi.fn<WebauthnVerifier['verifyRegistration']>(() => Promise.resolve({ id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] })),
  }
  const store: VaultStore = { transaction: async <T>(_i: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> => {
    const before = structuredClone(records), beforeCounts = new Map(counts), beforeEvents = [...events], beforeCreds = structuredClone(credentials)
    try {
      return await run({ authority: structuredClone(authority), now: () => time,
        get: <V>(k: string, t: string) => Promise.resolve(structuredClone(records.get(k + ':' + t) ?? null) as V | null),
        put: (k, t, v) => { records.set(k + ':' + t, structuredClone(v)); return Promise.resolve() },
        remove: (k, t) => { records.delete(k + ':' + t); return Promise.resolve() },
        limit: (name, window, max) => { const k = name + Math.floor(time / window), n = (counts.get(k) ?? 0) + 1; counts.set(k, n); if (n > max) throw new VaultError('VAULT_RATE_LIMIT', 429); return Promise.resolve() },
        secret: () => Promise.reject(new Error('unused')), audit: e => { events.push(e); return Promise.resolve() },
        propose: () => Promise.resolve(), approve: () => Promise.reject(new Error('unused')), webauthn })
    } catch (e) {
      records.clear(); for (const [k, v] of before) records.set(k, v)
      counts.clear(); for (const [k, v] of beforeCounts) counts.set(k, v)
      events.length = 0; events.push(...beforeEvents)
      credentials.clear(); for (const [k, v] of beforeCreds) credentials.set(k, v)
      throw e
    }
  } }
  const origins = { bind: vi.fn(() => Promise.resolve({ jti: 'o', expiresAt: 10_000_000, authMethod: 'local' as const })), assert: vi.fn(() => Promise.resolve()) }
  const reauth = { verify: vi.fn(() => Promise.resolve(true)), verifySecondFactor: vi.fn(() => true) }
  const sealer = { validate: vi.fn(() => Promise.resolve('t')), seal: vi.fn(() => Promise.resolve('e')) }
  const service = new VaultService(store, origins, reauth, sealer, entropy, () => time, undefined, verifier)
  const hello = new VaultWebauthnService(service, entropy, verifier)
  async function client() {
    const c = await service.register(identity, 'refresh', origin)
    return c.clientId
  }
  async function fresh(clientId: string) {
    const ch = await service.challenge(identity, clientId, origin)
    return service.unlock(identity, clientId, origin, ch.challengeId, 'password', '123456')
  }
  return { service, hello, verifier, credentials, events, records, client, fresh, advance: (ms: number) => { time += ms },
    seed: () => credentials.set('cred-1', { id: 'cred-1', publicKey: new Uint8Array([1]), counter: 5, transports: ['internal'], name: 'Notebook', createdAt: 0, lastUsedAt: null }) }
}

describe('NA-0198 WebAuthn RP ID', () => {
  it('uses the vault host name and refuses IP literals', () => {
    expect(webauthnRpId('https://localhost:5173')).toBe('localhost')
    expect(webauthnRpId('https://vault.example.test')).toBe('vault.example.test')
    for (const ip of ['https://127.0.0.1:5173', 'https://[::1]:5173', 'not a url']) expect(webauthnRpId(ip)).toBeNull()
  })
})

describe('NA-0198 unlock with Windows Hello / passkey', () => {
  it('offers WebAuthn on the unlock challenge only when the user has a credential, and opens a session with the same proof rules', async () => {
    const f = fixture(), clientId = await f.client()
    expect((await f.service.challenge(identity, clientId, ORIGIN)).webauthn).toBeUndefined()
    f.seed(); f.advance(300_000)
    const ch = await f.service.challenge(identity, clientId, ORIGIN)
    const options = ch.webauthn as { challenge: string; rpId: string; allowCredentials: Array<{ id: string }> }
    expect(options.rpId).toBe('vault.example.test'); expect(options.allowCredentials.map(c => c.id)).toEqual(['cred-1'])
    const session = await f.service.unlockWebauthn(identity, clientId, ORIGIN, ch.challengeId, response())
    expect(session.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const call = f.verifier.verifyAuthentication.mock.calls[0]![0]
    expect(call).toMatchObject({ challenge: options.challenge, origin: ORIGIN, rpID: 'vault.example.test' }); expect(call.credential.id).toBe('cred-1')
    expect(f.credentials.get('cred-1')?.counter).toBe(6); expect(f.credentials.get('cred-1')?.lastUsedAt).toBeTypeOf('number')
    expect(f.events.map(e => e.type)).toContain('VAULT_UNLOCKED')
    // The challenge is single use.
    await expect(f.service.unlockWebauthn(identity, clientId, ORIGIN, ch.challengeId, response())).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
  })
  it('refuses, audits and burns the challenge on a failed assertion, an unknown credential or a challenge without WebAuthn', async () => {
    const f = fixture(), clientId = await f.client(); f.seed()
    f.verifier.verifyAuthentication.mockResolvedValueOnce(null)
    const ch = await f.service.challenge(identity, clientId, ORIGIN)
    await expect(f.service.unlockWebauthn(identity, clientId, ORIGIN, ch.challengeId, response())).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED', status: 403 })
    expect(f.events.filter(e => e.type === 'UNLOCK_DENIED').map(e => e.reasonCode)).toEqual(['WEBAUTHN_FAILED'])
    await expect(f.service.unlockWebauthn(identity, clientId, ORIGIN, ch.challengeId, response())).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    const other = await f.service.challenge(identity, clientId, ORIGIN)
    await expect(f.service.unlockWebauthn(identity, clientId, ORIGIN, other.challengeId, response('someone-else'))).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
    expect(f.verifier.verifyAuthentication).toHaveBeenCalledTimes(1)
    // A challenge issued before the credential existed carries no WebAuthn challenge.
    f.credentials.clear()
    const plain = await f.service.challenge(identity, clientId, ORIGIN); f.seed()
    await expect(f.service.unlockWebauthn(identity, clientId, ORIGIN, plain.challengeId, response())).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
  })
  it('never offers WebAuthn on an IP origin and refuses an expired challenge', async () => {
    const ip = fixture('https://127.0.0.1:5173'), ipClient = await ip.client(); ip.seed()
    expect((await ip.service.challenge(identity, ipClient, 'https://127.0.0.1:5173')).webauthn).toBeUndefined()
    const f = fixture(), clientId = await f.client(); f.seed()
    const ch = await f.service.challenge(identity, clientId, ORIGIN); f.advance(121_000)
    await expect(f.service.unlockWebauthn(identity, clientId, ORIGIN, ch.challengeId, response())).rejects.toMatchObject({ status: 403 })
  })
})

describe('NA-0198 registration, list and removal', () => {
  it('registers with a fresh session only, excludes existing credentials and audits', async () => {
    const f = fixture(), clientId = await f.client(), { sessionId } = await f.fresh(clientId)
    const { options } = await f.hello.registrationOptions(identity, clientId, ORIGIN, sessionId, 'Notebook')
    expect(options).toMatchObject({ rp: { id: 'vault.example.test' } })
    const call = f.verifier.registrationOptions.mock.calls[0]![0]
    expect(call.userName).toBe('user@example.test'); expect(call.userHandle).toHaveLength(32); expect(call.exclude).toEqual([])
    expect(await f.hello.register(identity, clientId, ORIGIN, sessionId, response())).toEqual({ id: 'cred-1' })
    expect(f.credentials.get('cred-1')).toMatchObject({ name: 'Notebook', transports: ['internal'] })
    expect(f.events.map(e => e.type)).toContain('WEBAUTHN_REGISTERED')
    expect(JSON.stringify(f.events)).not.toContain('cred-1')
    // The registration challenge is single use.
    await expect(f.hello.register(identity, clientId, ORIGIN, sessionId, response())).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect(f.events.map(e => e.type)).toContain('WEBAUTHN_REGISTRATION_DENIED')
    await f.hello.registrationOptions(identity, clientId, ORIGIN, sessionId, 'Again')
    expect(f.verifier.registrationOptions.mock.calls[1]![0].exclude).toEqual([{ id: 'cred-1', transports: ['internal'] }])
    // An identity confirmation older than a minute is not fresh enough.
    f.advance(61_000)
    await expect(f.hello.registrationOptions(identity, clientId, ORIGIN, sessionId, 'Late')).rejects.toMatchObject({ status: 423 })
  })
  it('refuses a failed or duplicate registration, lists without keys and removes with a fresh session', async () => {
    const f = fixture(), clientId = await f.client(), { sessionId } = await f.fresh(clientId)
    await f.hello.registrationOptions(identity, clientId, ORIGIN, sessionId, 'Notebook')
    f.verifier.verifyRegistration.mockResolvedValueOnce(null)
    await expect(f.hello.register(identity, clientId, ORIGIN, sessionId, response())).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect(f.credentials.size).toBe(0)
    f.seed()
    await f.hello.registrationOptions(identity, clientId, ORIGIN, sessionId, 'Copy')
    await expect(f.hello.register(identity, clientId, ORIGIN, sessionId, response())).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    const listed = await f.hello.credentials(identity, ORIGIN)
    expect(listed).toEqual({ supported: true, credentials: [{ id: 'cred-1', name: 'Notebook', createdAt: 0, lastUsedAt: null }] })
    await f.hello.remove(identity, clientId, ORIGIN, sessionId, 'cred-1')
    expect(f.credentials.size).toBe(0); expect(f.events.map(e => e.type)).toContain('WEBAUTHN_REMOVED')
    await expect(f.hello.remove(identity, clientId, ORIGIN, sessionId, 'cred-1')).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
  })
  it('reports WebAuthn as unsupported on an IP origin and never registers there', async () => {
    const f = fixture('https://127.0.0.1:5173'), o = 'https://127.0.0.1:5173', clientId = await f.client()
    const ch = await f.service.challenge(identity, clientId, o)
    const { sessionId } = await f.service.unlock(identity, clientId, o, ch.challengeId, 'password', '123456')
    expect(await f.hello.credentials(identity, o)).toEqual({ supported: false, credentials: [] })
    await expect(f.hello.registrationOptions(identity, clientId, o, sessionId, 'x')).rejects.toMatchObject({ code: 'VAULT_WEBAUTHN_UNSUPPORTED', status: 409 })
  })
})

describe('NA-0198 maintained verifier adapter', () => {
  it('asks for user verification, no attestation, and turns malformed responses into a refusal', async () => {
    const v = new SimpleWebauthnVerifier(), challenge = randomBytes(32).toString('base64url')
    const auth = await v.authenticationOptions({ rpID: 'localhost', challenge, allow: [{ id: 'AAAA', transports: ['internal', 'bogus'] }] }) as Record<string, unknown>
    expect(auth).toMatchObject({ rpId: 'localhost', challenge, userVerification: 'required', allowCredentials: [{ id: 'AAAA', type: 'public-key', transports: ['internal'] }] })
    const reg = await v.registrationOptions({ rpID: 'localhost', rpName: 'NodeAccess', userHandle: new Uint8Array(32), userName: 'u@example.test', challenge, exclude: [] }) as Record<string, unknown>
    expect(reg).toMatchObject({ rp: { id: 'localhost', name: 'NodeAccess' }, challenge, attestation: 'none', authenticatorSelection: { userVerification: 'required' } })
    // Only ES256 and RS256: post-quantum ML-DSA signatures (~2.4 KB) are neither offered nor accepted.
    expect((reg as { pubKeyCredParams: Array<{ alg: number }> }).pubKeyCredParams.map(p => p.alg)).toEqual([-7, -257])
    const credential = { id: 'AAAA', publicKey: new Uint8Array([1]), counter: 0, transports: [], name: 'x', createdAt: 0, lastUsedAt: null }
    expect(await v.verifyAuthentication({ response: { id: 'AAAA', rawId: 'AAAA', type: 'public-key', response: {}, clientExtensionResults: {} }, challenge, origin: 'https://localhost', rpID: 'localhost', credential })).toBeNull()
    expect(await v.verifyRegistration({ response: { id: 'AAAA' }, challenge, origin: 'https://localhost', rpID: 'localhost' })).toBeNull()
  })
})

// Real cryptography through the maintained library: a local P-256 authenticator builds genuine assertions.
function authenticatorKey(): { privateKey: KeyObject; cose: Uint8Array } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x!, 'base64url'), y = Buffer.from(jwk.y!, 'base64url')
  // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y} in canonical CBOR.
  const cose = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y])
  return { privateKey, cose: new Uint8Array(cose) }
}
function assertion(input: { key: KeyObject; challenge: string; origin: string; rpID: string; flags?: number; counter?: number; id?: string }): object {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: input.challenge, origin: input.origin, crossOrigin: false }))
  const counter = Buffer.alloc(4); counter.writeUInt32BE(input.counter ?? 1)
  const authenticatorData = Buffer.concat([createHash('sha256').update(input.rpID).digest(), Buffer.from([input.flags ?? 0x05]), counter])
  const signature = sign('sha256', Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]), input.key)
  const id = input.id ?? 'Y3JlZGVudGlhbA'
  return { id, rawId: id, type: 'public-key', clientExtensionResults: {},
    response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'), signature: signature.toString('base64url') } }
}
describe('NA-0198 real WebAuthn verification (library, local P-256 authenticator)', () => {
  const v = new SimpleWebauthnVerifier(), origin = 'https://localhost:5173', rpID = 'localhost'
  const { privateKey, cose } = authenticatorKey(), stranger = authenticatorKey()
  const credential = { id: 'Y3JlZGVudGlhbA', publicKey: cose, counter: 0, transports: ['internal'], name: 'x', createdAt: 0, lastUsedAt: null }
  const challenge = randomBytes(32).toString('base64url')
  const check = (response: object, overrides: Partial<{ challenge: string; origin: string; rpID: string; counter: number }> = {}) =>
    v.verifyAuthentication({ response, challenge: overrides.challenge ?? challenge, origin: overrides.origin ?? origin, rpID: overrides.rpID ?? rpID,
      credential: { ...credential, counter: overrides.counter ?? 0 } })
  it('accepts a genuine user-verified assertion and returns the new counter', async () => {
    expect(await check(assertion({ key: privateKey, challenge, origin, rpID, counter: 9 }))).toEqual({ counter: 9 })
  })
  it('refuses a wrong origin, RP ID, challenge, missing user verification, counter regression or another key', async () => {
    expect(await check(assertion({ key: privateKey, challenge, origin: 'https://evil.example', rpID }))).toBeNull()
    expect(await check(assertion({ key: privateKey, challenge, origin, rpID }), { origin: 'https://localhost:5174' })).toBeNull()
    expect(await check(assertion({ key: privateKey, challenge, origin, rpID: 'evil.example' }))).toBeNull()
    expect(await check(assertion({ key: privateKey, challenge, origin, rpID }), { challenge: randomBytes(32).toString('base64url') })).toBeNull()
    // User present but not verified (UP only).
    expect(await check(assertion({ key: privateKey, challenge, origin, rpID, flags: 0x01 }))).toBeNull()
    expect(await check(assertion({ key: privateKey, challenge, origin, rpID, counter: 5 }), { counter: 10 })).toBeNull()
    expect(await check(assertion({ key: stranger.privateKey, challenge, origin, rpID }))).toBeNull()
  })
})
