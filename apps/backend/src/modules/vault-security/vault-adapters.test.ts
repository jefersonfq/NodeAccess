import { beforeAll, describe, expect, it, vi } from 'vitest'
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt, randomUUID, type KeyObject } from 'node:crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import * as speakeasy from 'speakeasy'
import { compactDecrypt } from 'jose'
import { JweVaultEnvelope } from './vault-envelope.js'
import { RedisVaultOrigin, MethodVaultReauthentication, vaultAuthMethod } from './vault-identity.js'
import { TotpService } from '../auth/totp.service.js'
import { encrypt } from '../../shared/crypto.js'
import type { VaultAuthority, VaultOperation } from './vault-domain.js'

const envelope = new JweVaultEnvelope()
let keys: { publicKey: KeyObject; privateKey: KeyObject }
let otherKeys: { publicKey: KeyObject; privateKey: KeyObject }
let publicKey: VaultOperation['recipient']
beforeAll(() => {
  keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 })
  publicKey = keys.publicKey.export({ format: 'jwk' }) as VaultOperation['recipient']
})
function secret(value: string) { const sealed = encrypt(value); return { encrypted: sealed.encrypted, iv: sealed.iv, version: 'fixture-version' } }

describe('Vault JWE interoperable envelope', () => {
  it('decrypts with JOSE and independent Node OAEP/GCM while binding the entire context', async () => {
    const context = { version: 1, operationId: randomUUID(), tenantId: 7, userId: 42, action: 'reveal', expiresAt: Date.now() + 30_000 }
    const value = `test-value-${randomUUID()}`
    const thumbprint = await envelope.validate(publicKey)
    expect(thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const result = await envelope.seal(publicKey, context, secret(value))
    expect(result).not.toContain(value)
    const opened = await compactDecrypt(result, keys.privateKey, { keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A256GCM'] })
    expect(new TextDecoder().decode(opened.plaintext)).toBe(value)
    expect(opened.protectedHeader).toEqual({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context })
    const [header, wrapped, iv, ciphertext, tag] = result.split('.') as [string,string,string,string,string]
    const cek = privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(wrapped, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', cek, Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(header, 'ascii'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    expect(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString()).toBe(value)
    cek.fill(0)
  })
  it('rejects another recipient and modifications to protected context, ciphertext or tag', async () => {
    const result = await envelope.seal(publicKey, { action: 'copy', tenantId: 7 }, secret('synthetic-value'))
    await expect(compactDecrypt(result, otherKeys.privateKey)).rejects.toThrow()
    const parts = result.split('.')
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as { vault: { tenantId: number } }
    header.vault.tenantId = 8
    const changedHeader = [...parts]; changedHeader[0] = Buffer.from(JSON.stringify(header)).toString('base64url')
    await expect(compactDecrypt(changedHeader.join('.'), keys.privateKey)).rejects.toThrow()
    for (const index of [3, 4]) {
      const changed = [...parts]; const bytes = Buffer.from(changed[index]!, 'base64url'); bytes[0] = bytes[0]! ^ 1; changed[index] = bytes.toString('base64url')
      await expect(compactDecrypt(changed.join('.'), keys.privateKey)).rejects.toThrow()
    }
  })
  it('rejects private, non-RSA, malformed, wrong-exponent and undersized recipients', async () => {
    const small = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ format: 'jwk' })
    for (const key of [keys.privateKey.export({ format: 'jwk' }), { ...publicKey, kty: 'oct' }, { ...publicKey, e: 'Aw' }, { ...publicKey, n: 'bad' }, { ...publicKey, n: '!'.repeat(342) }, small]) {
      await expect(envelope.validate(key as VaultOperation['recipient'])).rejects.toMatchObject({ status: 400, code: 'VAULT_RECIPIENT_INVALID' })
    }
  })
  it('accepts the 8KiB boundary and denies larger values without truncating', async () => {
    const result = await envelope.seal(publicKey, {}, secret('x'.repeat(8192)))
    expect((await compactDecrypt(result, keys.privateKey)).plaintext.byteLength).toBe(8192)
    await expect(envelope.seal(publicKey, {}, secret('é'.repeat(4097)))).rejects.toMatchObject({ status: 422, code: 'VAULT_ITEM_TOO_LARGE' })
    await expect(envelope.seal(publicKey, {}, { encrypted: 'invalid', iv: 'invalid', version: '1' })).rejects.toThrow()
  })
})

describe('Vault reference to the central refresh session', () => {
  const signingKey = `test-only-${randomUUID()}-${randomUUID()}`
  const identity = { userId: 42, tenantId: 7, sessionVersion: 3 }
  const jti = randomUUID()
  const now = Date.now()
  function token(patch: Record<string, unknown> = {}) {
    return jwt.sign({ sub: '42', stage: 'refresh', authMethod: 'local', sessionVersion: 3, jti, exp: Math.floor(now / 1000) + 120, ...patch }, signingKey, { algorithm: 'HS256' })
  }
  it('binds only the signed subject/version and the current Redis tenant; never returns the refresh token', async () => {
    const get = vi.fn().mockResolvedValue('7'); const verifier = new RedisVaultOrigin({ get }, signingKey, () => now)
    const raw = token(); const bound = await verifier.bind(raw, identity)
    expect(bound).toEqual({ jti, expiresAt: (Math.floor(now / 1000) + 120) * 1000, authMethod: 'local' })
    expect(get).toHaveBeenCalledWith(`refresh:${jti}`)
    expect(JSON.stringify(bound)).not.toContain(raw)
  })
  it.each([
    { sub: '43' }, { stage: 'authenticated' }, { sessionVersion: 4 }, { authMethod: 'oidc' },
    { authMethod: 'ldap' }, { authMethod: 'google' }, { authMethod: 'break_glass' }, { authMethod: undefined },
    { jti: 'untrusted' }, { exp: Math.floor(now / 1000) - 1 },
  ])('rejects invalid signed context %j before consulting Redis', async patch => {
    const get = vi.fn().mockResolvedValue('7'); const verifier = new RedisVaultOrigin({ get }, signingKey, () => now)
    await expect(verifier.bind(token(patch), identity)).rejects.toMatchObject({ status: 423, code: 'VAULT_ORIGIN_INVALID' })
    expect(get).not.toHaveBeenCalled()
  })
  it.each(['ldap', 'oidc', 'google'])('binds the signed external method %s only when external step-up is enabled', async method => {
    const get = vi.fn().mockResolvedValue('7'); const verifier = new RedisVaultOrigin({ get }, signingKey, () => now, 500, true)
    await expect(verifier.bind(token({ authMethod: method }), identity)).resolves.toMatchObject({ jti, authMethod: method })
  })
  it.each(['break_glass', 'saml', 'LOCAL', '', null])('never binds method %j even with external step-up enabled', async method => {
    const get = vi.fn().mockResolvedValue('7'); const verifier = new RedisVaultOrigin({ get }, signingKey, () => now, 500, true)
    await expect(verifier.bind(token({ authMethod: method }), identity)).rejects.toMatchObject({ status: 423, code: 'VAULT_ORIGIN_INVALID' })
    expect(get).not.toHaveBeenCalled()
  })
  it('maps methods without trusting unknown values', () => {
    expect(vaultAuthMethod('local', false)).toBe('local')
    expect(vaultAuthMethod('ldap', false)).toBeNull()
    expect(vaultAuthMethod('oidc', true)).toBe('oidc')
    expect(vaultAuthMethod('break_glass', true)).toBeNull()
  })
  it('rejects a bad signature and an absent expiry', async () => {
    const verifier = new RedisVaultOrigin({ get: vi.fn().mockResolvedValue('7') }, signingKey)
    await expect(verifier.bind(jwt.sign({ sub: '42' }, 'different-test-signing-key'), identity)).rejects.toMatchObject({ status: 423 })
    await expect(verifier.bind(jwt.sign({ sub: '42', jti, sessionVersion: 3, authMethod: 'local', stage: 'refresh' }, signingKey), identity)).rejects.toMatchObject({ status: 423 })
  })
  it.each([null, '8', '07'])('fails closed on revoked or mismatched authority %s', async stored => {
    const verifier = new RedisVaultOrigin({ get: vi.fn().mockResolvedValue(stored) }, signingKey, () => now)
    await expect(verifier.bind(token(), identity)).rejects.toMatchObject({ status: 423, code: 'VAULT_ORIGIN_REVOKED' })
  })
  it('bounds an indefinitely stalled Redis read and clears the deadline timer', async () => {
    vi.useFakeTimers()
    try {
      const verifier = new RedisVaultOrigin({ get: vi.fn(() => new Promise<string | null>(() => {})) }, signingKey, () => now, 10)
      const rejected = expect(verifier.assert({ jti, expiresAt: now + 60_000, authMethod: 'local' }, identity)).rejects.toMatchObject({ status: 503, code: 'VAULT_DEPENDENCY_UNAVAILABLE' })
      await vi.advanceTimersByTimeAsync(10)
      await rejected
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('distinguishes storage outage from revocation and checks the absolute deadline', async () => {
    const get = vi.fn().mockRejectedValue(new Error('private storage diagnostic'))
    const verifier = new RedisVaultOrigin({ get }, signingKey, () => now)
    await expect(verifier.assert({ jti, expiresAt: now + 1, authMethod: 'local' }, identity)).rejects.toMatchObject({ status: 503, message: 'VAULT_DEPENDENCY_UNAVAILABLE' })
    get.mockResolvedValue('7')
    await expect(verifier.assert({ jti, expiresAt: now, authMethod: 'local' }, identity)).rejects.toMatchObject({ status: 423 })
    await expect(verifier.assert({ jti, expiresAt: now + 1, authMethod: 'local' }, identity)).resolves.toBeUndefined()
  })
})

describe('Vault step-up by login method', () => {
  const identity = { userId: 42, tenantId: 7, sessionVersion: 3 }
  const allMethods = { local: true, ldap: true, oidc: true, google: true }
  function authority(patch: Partial<VaultAuthority> = {}): VaultAuthority {
    return { passwordHash: null, mfaSecret: speakeasy.generateSecret().base32, email: 'user@example.test', methods: { ...allMethods }, ...patch } as VaultAuthority
  }
  const otp = (a: VaultAuthority): string => speakeasy.totp({ secret: a.mfaSecret, encoding: 'base32' })
  it('local requires both the actual password hash and a valid TOTP', async () => {
    const password = `synthetic-${randomUUID()}`; const a = authority({ passwordHash: await bcrypt.hash(password, 4) })
    const provider = new MethodVaultReauthentication(new TotpService())
    expect(await provider.verify(password, otp(a), a, 'local', identity)).toBe(true)
    expect(await provider.verify('wrong-password', otp(a), a, 'local', identity)).toBe(false)
    expect(await provider.verify(password, 'not-a-totp', a, 'local', identity)).toBe(false)
  })
  it('local without a password hash and a method disabled by the tenant are denied', async () => {
    const provider = new MethodVaultReauthentication(new TotpService())
    const noHash = authority(); expect(await provider.verify('any', otp(noHash), noHash, 'local', identity)).toBe(false)
    const password = `synthetic-${randomUUID()}`
    const disabled = authority({ passwordHash: await bcrypt.hash(password, 4), methods: { ...allMethods, local: false } })
    expect(await provider.verify(password, otp(disabled), disabled, 'local', identity)).toBe(false)
  })
  it('does not evaluate MFA when the first factor fails', async () => {
    const totp = { verify: vi.fn().mockReturnValue(true) }
    const a = authority({ passwordHash: await bcrypt.hash(randomUUID(), 4) })
    expect(await new MethodVaultReauthentication(totp).verify('wrong', '123456', a, 'local', identity)).toBe(false)
    expect(totp.verify).not.toHaveBeenCalled()
  })
  it('ldap checks the directory password for the same user plus NodeAccess TOTP', async () => {
    const a = authority()
    const directory = { authenticate: vi.fn().mockResolvedValue({ user: { id: 42 }, passwordValid: true }) }
    const provider = new MethodVaultReauthentication(new TotpService(), directory)
    expect(await provider.verify('directory-password', otp(a), a, 'ldap', identity)).toBe(true)
    expect(directory.authenticate).toHaveBeenCalledWith({ tenantId: 7, email: 'user@example.test', password: 'directory-password' })
    expect(await provider.verify('directory-password', 'not-a-totp', a, 'ldap', identity)).toBe(false)
  })
  it.each([
    ['invalid password', { user: { id: 42 }, passwordValid: false }],
    ['other user', { user: { id: 43 }, passwordValid: true }],
    ['unknown user', { user: null, passwordValid: true }],
  ])('ldap denies %s', async (_label, result) => {
    const a = authority()
    const provider = new MethodVaultReauthentication(new TotpService(), { authenticate: vi.fn().mockResolvedValue(result) })
    expect(await provider.verify('directory-password', otp(a), a, 'ldap', identity)).toBe(false)
  })
  it('ldap fails closed on directory errors, missing adapter or tenant policy', async () => {
    const a = authority()
    const failing = new MethodVaultReauthentication(new TotpService(), { authenticate: vi.fn().mockRejectedValue(new Error('private directory diagnostic')) })
    expect(await failing.verify('p', otp(a), a, 'ldap', identity)).toBe(false)
    expect(await new MethodVaultReauthentication(new TotpService()).verify('p', otp(a), a, 'ldap', identity)).toBe(false)
    const blocked = authority({ methods: { ...allMethods, ldap: false } })
    const directory = { authenticate: vi.fn().mockResolvedValue({ user: { id: 42 }, passwordValid: true }) }
    expect(await new MethodVaultReauthentication(new TotpService(), directory).verify('p', otp(blocked), blocked, 'ldap', identity)).toBe(false)
    expect(directory.authenticate).not.toHaveBeenCalled()
  })
  it.each(['oidc', 'google'] as const)('%s cannot be confirmed with a password and TOTP', async method => {
    const password = `synthetic-${randomUUID()}`; const a = authority({ passwordHash: await bcrypt.hash(password, 4) })
    expect(await new MethodVaultReauthentication(new TotpService()).verify(password, otp(a), a, method, identity)).toBe(false)
  })
})
