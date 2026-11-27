import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { Redis } from 'ioredis'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import * as speakeasy from 'speakeasy'
import { createHash, randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto'
import type { VaultExtensionWrite } from '@nodeaccess/shared'
import { calculateJwkThumbprint, compactDecrypt, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { VaultService } from './vault.service.js'
import { VaultAdministrationService } from './vault-administration.service.js'
import { SqlVaultStore } from './vault.repository.js'
import { RedisVaultOrigin, MethodVaultReauthentication } from './vault-identity.js'
import { JweVaultEnvelope } from './vault-envelope.js'
import { SqlExtensionLocator } from './vault-extension.repository.js'
import { DpopNonces, DpopVerifier, sha256b64 } from './vault-extension-dpop.js'
import { catalogSummaries, VaultExtensionService } from './vault-extension.service.js'
import { extensionRedirectUri } from './vault-extension-domain.js'
import { TotpService } from '../auth/totp.service.js'
import { SecretService } from '../secrets/secret.service.js'
import { SecretRepository } from '../secrets/secret.repository.js'
import { PemKeyService } from '../pem-keys/pem-key.service.js'
import { PemKeyRepository } from '../pem-keys/pem-key.repository.js'
import { LogRepository } from '../logs/log.repository.js'
import { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import { encrypt } from '../../shared/crypto.js'
import type { VaultIdentity } from './vault-domain.js'

/** NA-0183: extension E1 against the disposable MySQL/Redis of the vault harness (RUN_VAULT_MYSQL=true). */
const enabled = process.env.RUN_VAULT_MYSQL === 'true'
const origin = 'https://vault.example.test'
const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const BASE = `${origin}/api/v1/vault-security/extension`
const entropy = { token: () => randomBytes(32).toString('base64url'), digest: (v: string) => createHash('sha256').update(v).digest('hex') }
const policy = { unlock: true, reveal: true, copy: true, localReauth: true, origin, tenantQuota: 300 }

describe.skipIf(!enabled)('Vault extension E1 SQL/Redis integration', () => {
  let db: PrismaClient
  const connections: Redis[] = []
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '')
    if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/na0178_') || !/^[a-f0-9]{24}$/.test(process.env.VAULT_DISPOSABLE_NONCE ?? '')) {
      throw new Error('Requires the disposable Vault harness; refusing an unverified database')
    }
    db = new PrismaClient(); await db.$connect()
  })
  afterAll(async () => { for (const r of connections) r.disconnect(); await db?.$disconnect() })

  async function fixture() {
    const suffix = randomUUID(), password = `test-only-${suffix}`, mfaSecret = speakeasy.generateSecret().base32
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, enableOfflineQueue: false }); connections.push(redis)
    if (redis.status !== 'ready') await new Promise<void>((resolve, reject) => { redis.once('ready', resolve); redis.once('error', reject) })
    const secure = { passwordHash: await bcrypt.hash(password, 4), mfaSecret, mfaEnabled: true, forcePasswordChange: false, sessionVersion: 1 }
    async function tenant(label: string) {
      const t = await db.tenant.create({ data: { name: `Extension ${label}`, slug: `na0183-${label}-${suffix}` } })
      await db.license.create({ data: { tenantId: t.id, maxUsers: 10, featureEntitlementsJson: { secrets: true } } })
      await db.tenantAuthPolicy.create({ data: { tenantId: t.id } })
      await db.$executeRaw`INSERT INTO vault_policies(tenant_id,version,config) VALUES(${t.id},1,${JSON.stringify(policy)})`
      return t
    }
    const a = await tenant('a'), b = await tenant('b')
    const user = await db.user.create({ data: { name: 'Owner', email: `u-${suffix}@example.test`, tenantId: a.id, ...secure } })
    const peer = await db.user.create({ data: { name: 'Peer', email: `p-${suffix}@example.test`, tenantId: a.id, ...secure } })
    const outsider = await db.user.create({ data: { name: 'Other tenant', email: `o-${suffix}@example.test`, tenantId: b.id, ...secure } })
    const m1 = await db.user.create({ data: { name: 'Manager A', email: `m1-${suffix}@example.test`, tenantId: a.id, role: 'ADMIN', ...secure } })
    const m2 = await db.user.create({ data: { name: 'Manager B', email: `m2-${suffix}@example.test`, tenantId: a.id, role: 'ADMIN', ...secure } })
    for (const m of [m1, m2]) await db.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${a.id},${m.id},TRUE)`
    const group = await db.group.create({ data: { name: 'Ops', tenantId: a.id } })
    await db.userGroup.create({ data: { userId: user.id, groupId: group.id } })
    const value = encrypt(`never-leaves-${suffix}`)
    const secret = (tenantId: number, alias: string, extra: object) => db.secret.create({ data: { tenantId, alias, encryptedValue: value.encrypted, iv: value.iv, ...extra } })
    const mine = await secret(a.id, 'mine', { scope: 'PERSONAL', ownerUserId: user.id })
    await secret(a.id, 'peer-only', { scope: 'PERSONAL', ownerUserId: peer.id })
    await secret(a.id, 'tenant-shared', { scope: 'TENANT' })
    await secret(a.id, 'ops-group', { scope: 'GROUP', groupId: group.id })
    await secret(b.id, 'other-tenant', { scope: 'TENANT' })
    const keyBody = encrypt('PRIVATE KEY BODY')
    await db.pemKey.create({ data: { name: 'my-key', encryptedKey: keyBody.encrypted, iv: keyBody.iv, createdById: user.id } })
    await db.pemKey.create({ data: { name: 'peer-key', encryptedKey: keyBody.encrypted, iv: keyBody.iv, createdById: peer.id } })
    await db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${a.id},${user.id},'extension',${m1.id},${m2.id},TRUE)`

    const signingKey = process.env.JWT_SECRET!
    const store = new SqlVaultStore(db), originVerifier = new RedisVaultOrigin(redis, signingKey)
    const reauth = new MethodVaultReauthentication(new TotpService())
    const vault = new VaultService(store, originVerifier, reauth, new JweVaultEnvelope(), entropy)
    const nonces = new DpopNonces(`test-${suffix}`)
    const replay = { claim: async (key: string, ttl: number) => (await redis.set(`vault-ext-dpop:${createHash('sha256').update(key).digest('hex')}`, '1', 'PX', ttl, 'NX')) === 'OK' }
    const prismaCatalog = { secrets: new SecretService(new SecretRepository(db), new LogRepository(db), new LicenseEntitlementService(db)), pems: new PemKeyService(new PemKeyRepository(db), new LogRepository(db)) }
    const service = new VaultExtensionService(vault, store, new SqlExtensionLocator(db), originVerifier, new DpopVerifier(nonces, replay), nonces, entropy, {
      list: async (i: VaultIdentity, admin: boolean) => catalogSummaries(await prismaCatalog.secrets.list(i.userId, i.tenantId, admin ? 'admin' : 'user'),
        await prismaCatalog.pems.list(i.userId, i.tenantId, admin), i.userId),
    }, { enabled: true, extensionIds: [EXT], minVersion: '0.1.0' }, Date.now, reauth, new JweVaultEnvelope())

    async function portal(u: { id: number; tenantId: number }) {
      const identity: VaultIdentity = { userId: u.id, tenantId: u.tenantId, sessionVersion: 1 }, jti = randomUUID()
      await redis.set(`refresh:${jti}`, String(u.tenantId), 'EX', 600)
      const refresh = jwt.sign({ sub: String(u.id), sessionVersion: 1, authMethod: 'local', stage: 'refresh', jti }, signingKey, { expiresIn: 600 })
      const { clientId } = await vault.register(identity, refresh, origin)
      const { challengeId } = await vault.challenge(identity, clientId, origin)
      const { sessionId } = await vault.unlock(identity, clientId, origin, challengeId, password, speakeasy.totp({ secret: mfaSecret, encoding: 'base32' }))
      return { identity, clientId, sessionId, jti }
    }
    const code = (): string => speakeasy.totp({ secret: mfaSecret, encoding: 'base32' })
    return { a, b, user, peer, outsider, m1, m2, redis, vault, service, nonces, portal, code, mine, value: `never-leaves-${suffix}` }
  }
  type F = Awaited<ReturnType<typeof fixture>>
  async function device(): Promise<{ privateKey: CryptoKey; jwk: JWK; jkt: string }> {
    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const jwk = await exportJWK(publicKey)
    return { privateKey, jwk, jkt: await calculateJwkThumbprint(jwk, 'sha256') }
  }
  const proof = (f: F, key: { privateKey: CryptoKey; jwk: JWK }, claims: object) => new SignJWT({ jti: randomBytes(16).toString('base64url'), iat: Math.floor(Date.now() / 1000), nonce: f.nonces.issue(), ...claims })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.jwk }).sign(key.privateKey)
  async function connect(f: F, u: { id: number; tenantId: number }, existing?: Awaited<ReturnType<typeof device>>) {
    const session = await f.portal(u), key = existing ?? await device()
    const verifier = randomBytes(48).toString('base64url')
    const { code } = await f.service.authorize(session.identity, session.clientId, origin, { extensionId: EXT, redirectUri: extensionRedirectUri(EXT), state: randomBytes(24).toString('base64url'),
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'), deviceJkt: key.jkt, sessionId: session.sessionId })
    const exchange = async () => f.service.token({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${BASE}/token`, proof: await proof(f, key, { htm: 'POST', htu: `${BASE}/token` }) },
      { code, codeVerifier: verifier, redirectUri: extensionRedirectUri(EXT), extensionId: EXT })
    return { session, key, code, exchange }
  }
  async function items(f: F, key: { privateKey: CryptoKey; jwk: JWK }, access: string, fixedProof?: string) {
    const p = fixedProof ?? await proof(f, key, { htm: 'GET', htu: `${BASE}/items`, ath: sha256b64(access) })
    return f.service.items({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${BASE}/items`, proof: p }, `DPoP ${access}`, {})
  }
  const audits = async (f: F, type: string) => Number((await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM vault_audit WHERE tenant_id=${f.a.id} AND event_type=${type}`)[0]!.n)

  it('E3 writes and audits on the authorization transaction, enforces ACL and rolls back together', async () => {
    const f = await fixture(), c = await connect(f, f.user), { accessToken } = await c.exchange()
    const write = async (input: VaultExtensionWrite) => f.service.write({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${BASE}/write`,
      proof: await proof(f, c.key, { htm: 'POST', htu: `${BASE}/write`, ath: sha256b64(accessToken) }) }, `DPoP ${accessToken}`, input)
    const created = await write({ operation: 'create-secret', alias: 'extension-created', value: 'disposable-write-marker' })
    const before = await db.secret.findUniqueOrThrow({ where: { id: created.id } })
    expect(before).toMatchObject({ tenantId: f.a.id, scope: 'PERSONAL', ownerUserId: f.user.id })
    await write({ operation: 'update-secret', id: created.id, description: 'edited' })
    expect((await db.secret.findUniqueOrThrow({ where: { id: created.id } })).encryptedValue).toBe(before.encryptedValue)
    await write({ operation: 'rotate-secret', id: created.id, value: 'disposable-replacement' })
    const rotated = await db.secret.findUniqueOrThrow({ where: { id: created.id } })
    expect(rotated.encryptedValue).not.toBe(before.encryptedValue)
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    const imported = await write({ operation: 'import-pem', name: 'extension-key', key: pem })
    expect(await db.pemKey.findUniqueOrThrow({ where: { id: imported.id } })).toMatchObject({ createdById: f.user.id })
    for (const alias of ['peer-only', 'tenant-shared', 'ops-group', 'other-tenant']) {
      const target = await db.secret.findFirstOrThrow({ where: { alias, tenantId: { in: [f.a.id, f.b.id] } } })
      await expect(write({ operation: 'update-secret', id: target.id, alias: 'stolen' })).rejects.toThrow()
      await expect(write({ operation: 'rotate-secret', id: target.id, value: 'stolen' })).rejects.toThrow()
    }
    const events = await db.adminLog.findMany({ where: { adminId: f.user.id } })
    expect(events.map(e => e.action)).toEqual(expect.arrayContaining(['CREATE_SECRET', 'UPDATE_SECRET', 'ROTATE_SECRET', 'CREATE_PEM_KEY']))
    expect(JSON.stringify(events)).not.toMatch(/disposable-write-marker|disposable-replacement|PRIVATE KEY/)
    const store = new SqlVaultStore(db)
    await expect(store.transaction(c.session.identity, async tx => {
      await tx.writePersonal!({ operation: 'create-secret', alias: 'rolled-back', value: 'never-committed' })
      await tx.writePersonal!({ operation: 'rotate-secret', id: created.id, value: 'never-committed' })
      await tx.writePersonal!({ operation: 'import-pem', name: 'rolled-back-pem', key: pem })
      throw new Error('abort-transaction')
    })).rejects.toThrow('abort-transaction')
    expect(await db.secret.count({ where: { tenantId: f.a.id, alias: 'rolled-back' } })).toBe(0)
    expect(await db.pemKey.count({ where: { createdById: f.user.id, name: 'rolled-back-pem' } })).toBe(0)
    expect((await db.secret.findUniqueOrThrow({ where: { id: created.id } })).encryptedValue).toBe(rotated.encryptedValue)
    expect(await db.adminLog.count({ where: { adminId: f.user.id } })).toBe(events.length)
  }, 20_000)

  it('E4 grants shared-write via two managers, offers permitted groups/items and rolls back writes and audit', async () => {
    const f = await fixture(), admin = new VaultAdministrationService(f.vault, entropy)
    const p1 = await f.portal(f.m1), p2 = await f.portal(f.m2)
    const change = { kind: 'grant' as const, userId: f.user.id, action: 'shared-write' as const, enabled: true }
    const { proposalId } = await admin.propose(p1.identity, p1.clientId, origin, p1.sessionId, change)
    await expect(admin.approve(p1.identity, p1.clientId, origin, p1.sessionId, proposalId)).rejects.toThrow()
    await admin.approve(p2.identity, p2.clientId, origin, p2.sessionId, proposalId)
    const c = await connect(f, f.user), { accessToken } = await c.exchange()
    const store = new SqlVaultStore(db), identity = c.session.identity
    const group = await db.group.findFirstOrThrow({ where: { tenantId: f.a.id } })
    const access = await store.transaction(identity, tx => tx.writeAccess!())
    expect(access).toEqual({ groups: [{ id: group.id, name: group.name }], tenant: false })
    const write = (input: VaultExtensionWrite) => store.transaction(identity, tx => tx.writePersonal!(input))
    const created = await write({ operation: 'create-secret', scope: 'GROUP', groupId: group.id, alias: 'e4-group', value: 'e4-marker' })
    const metadata = (await items(f, c.key, accessToken)).items
    expect(metadata.find(i => i.sourceId === created.id && i.kind === 'secret')).toMatchObject({ writable: true, writeScope: 'GROUP', groupId: group.id })
    expect(metadata.find(i => i.label === 'ops-group')).toMatchObject({ writable: false })
    await write({ operation: 'update-secret', scope: 'GROUP', groupId: group.id, id: created.id, description: 'edited' })
    const before = await db.secret.findUniqueOrThrow({ where: { id: created.id } })
    const auditCount = await db.adminLog.count({ where: { adminId: f.user.id } })
    await expect(store.transaction(identity, async tx => {
      await tx.writePersonal!({ operation: 'rotate-secret', scope: 'GROUP', groupId: group.id, id: created.id, value: 'rollback-marker' })
      throw new Error('E4 rollback')
    })).rejects.toThrow('E4 rollback')
    expect((await db.secret.findUniqueOrThrow({ where: { id: created.id } })).encryptedValue).toBe(before.encryptedValue)
    expect(await db.adminLog.count({ where: { adminId: f.user.id } })).toBe(auditCount)
    const foreign = await db.group.create({ data: { tenantId: f.b.id, name: 'foreign' } })
    await expect(write({ operation: 'create-secret', scope: 'GROUP', groupId: foreign.id, alias: 'denied', value: 'new' })).rejects.toThrow()
    await expect(write({ operation: 'create-secret', scope: 'TENANT', alias: 'denied', value: 'new' })).rejects.toThrow()
    await write({ operation: 'update-secret', scope: 'PERSONAL', id: created.id, description: 'made personal' })
    expect(await db.secret.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ scope: 'PERSONAL', ownerUserId: f.user.id, groupId: null })
    let locked!: () => void, release!: () => void
    const lockAcquired = new Promise<void>(resolve => { locked = resolve })
    const releaseRevocation = new Promise<void>(resolve => { release = resolve })
    const revoking = db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE vault_entitlements SET enabled=FALSE WHERE tenant_id=${f.a.id} AND user_id=${f.user.id} AND action='shared-write'`
      locked(); await releaseRevocation
    })
    await lockAcquired
    const concurrentWrite = write({ operation: 'create-secret', scope: 'GROUP', groupId: group.id, alias: 'revoked', value: 'new' })
    const deniedWrite = expect(concurrentWrite).rejects.toThrow()
    release(); await revoking; await deniedWrite
    expect(await db.secret.count({ where: { tenantId: f.a.id, alias: 'revoked' } })).toBe(0)
    expect(await store.transaction(identity, tx => tx.writeAccess!())).toEqual({ groups: [], tenant: false })
    await write({ operation: 'create-secret', alias: 'personal-still-works', value: 'new' })
  }, 20_000)

  it('lists only ACL-visible metadata across users and tenants, never a value', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    const { accessToken } = await c.exchange()
    const page = await items(f, c.key, accessToken)
    expect(page.items.map(i => `${i.kind}:${i.label}:${i.scope}`).sort()).toEqual(['pem:my-key:personal', 'secret:mine:personal', 'secret:ops-group:shared', 'secret:tenant-shared:shared'])
    expect(JSON.stringify(page)).not.toMatch(/never-leaves|PRIVATE|encrypted|iv"/)
    const stored = await db.$queryRaw<Array<{ payload: string }>>`SELECT CAST(payload AS CHAR) AS payload FROM vault_extension_tokens WHERE tenant_id=${f.a.id}`
    expect(stored.map(s => s.payload).join()).not.toContain(accessToken)
    expect(await audits(f, 'EXTENSION_AUTHORIZED')).toBe(1); expect(await audits(f, 'EXTENSION_CLIENT_REGISTERED')).toBe(1)
  }, 20_000)
  it('denies consent to a user without the permission and to the other tenant', async () => {
    const f = await fixture()
    await expect(connect(f, f.peer)).rejects.toMatchObject({ code: 'EXTENSION_FORBIDDEN' })
    expect(await audits(f, 'EXTENSION_DENIED')).toBe(1)
    await expect(connect(f, f.outsider)).rejects.toMatchObject({ code: 'EXTENSION_FORBIDDEN' })
    expect(Number((await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM vault_extension_tokens WHERE tenant_id IN (${f.a.id},${f.b.id})`)[0]!.n)).toBe(0)
  }, 20_000)
  it('accepts each code and each DPoP proof once', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    const { accessToken } = await c.exchange()
    await expect(c.exchange()).rejects.toMatchObject({ code: 'EXTENSION_GRANT_INVALID' })
    const p = await proof(f, c.key, { htm: 'GET', htu: `${BASE}/items`, ath: sha256b64(accessToken) })
    await items(f, c.key, accessToken, p)
    await expect(items(f, c.key, accessToken, p)).rejects.toMatchObject({ code: 'EXTENSION_DPOP_INVALID' })
  }, 20_000)
  it('cuts access on central logout and on device revocation', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    const { accessToken } = await c.exchange()
    await f.redis.del(`refresh:${c.session.jti}`)
    await expect(items(f, c.key, accessToken)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    const d = await connect(f, f.user), second = await d.exchange()
    await f.service.revokeDevice(d.session.identity, origin, d.key.jkt)
    await expect(items(f, d.key, second.accessToken)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    expect(await audits(f, 'DEVICE_REVOKED')).toBe(1)
  }, 20_000)
  it('revoking the permission through two managers revokes devices and authorizations', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    const { accessToken } = await c.exchange()
    const admin = new VaultAdministrationService(f.vault, entropy), p1 = await f.portal(f.m1), p2 = await f.portal(f.m2)
    const { proposalId } = await admin.propose(p1.identity, p1.clientId, origin, p1.sessionId, { kind: 'grant', userId: f.user.id, action: 'extension', enabled: false })
    await admin.approve(p2.identity, p2.clientId, origin, p2.sessionId, proposalId)
    await expect(items(f, c.key, accessToken)).rejects.toMatchObject({ status: 401 })
    const rows = await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM vault_extension_devices WHERE tenant_id=${f.a.id} AND user_id=${f.user.id}`
    expect(rows.map(r => r.state)).toEqual(['REVOKED'])
    expect(Number((await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM vault_extension_tokens WHERE tenant_id=${f.a.id} AND user_id=${f.user.id}`)[0]!.n)).toBe(0)
  }, 30_000)
  it('keeps the grant CHECK and two-person separation for extension', async () => {
    const f = await fixture()
    await expect(db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${f.a.id},${f.peer.id},'autofill',${f.m1.id},${f.m2.id},TRUE)`).rejects.toThrow()
    await expect(db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${f.a.id},${f.peer.id},'extension',${f.m1.id},${f.m1.id},TRUE)`).rejects.toThrow()
    await expect(db.$executeRaw`INSERT INTO vault_extension_devices(tenant_id,user_id,jkt,extension_id,state) VALUES(${f.a.id},${f.peer.id},${'x'.repeat(43)},${EXT},'PENDING')`).rejects.toThrow()
  })
  // NA-0193: trusted device renewal against the real migration, SQL and Redis.
  async function renew(f: F, key: { privateKey: CryptoKey; jwk: JWK }, otp?: string) {
    return f.service.renew({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${BASE}/renew`, proof: await proof(f, key, { htm: 'POST', htu: `${BASE}/renew` }) },
      { extensionId: EXT, ...(otp ? { otp } : {}) })
  }
  const trustRows = async (f: F) => db.$queryRaw<Array<{ payload: unknown; expiresAt: Date }>>`SELECT payload,expires_at AS expiresAt FROM vault_extension_tokens WHERE tenant_id=${f.a.id} AND kind='trust'`
  it('NA-0193: renews automatically while the portal login lives, then only with the authenticator code', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    await c.exchange()
    const [row] = await trustRows(f)
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(7 * 24 * 3_600_000 - 60_000)
    const silent = await renew(f, c.key)
    expect(Array.isArray((await items(f, c.key, silent.accessToken)).items)).toBe(true)
    await f.redis.del(`refresh:${c.session.jti}`)
    await expect(items(f, c.key, silent.accessToken)).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await expect(renew(f, c.key)).rejects.toMatchObject({ code: 'EXTENSION_REAUTH_REQUIRED' })
    await expect(renew(f, c.key, f.code() === '000000' ? '111111' : '000000')).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
    const failures = (await trustRows(f)).map(r => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as { failures: number })
    expect(failures[0]!.failures).toBe(1)
    const byCode = await renew(f, c.key, f.code())
    expect(Array.isArray((await items(f, c.key, byCode.accessToken)).items)).toBe(true)
    expect(await audits(f, 'EXTENSION_RENEWED')).toBe(2); expect(await audits(f, 'EXTENSION_RENEW_DENIED')).toBe(1)
  }, 30_000)
  it('NA-0193: "disconnect all" (session version) and device revocation end the trust', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    await c.exchange()
    await db.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } })
    await expect(renew(f, c.key, f.code())).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await db.user.update({ where: { id: f.user.id }, data: { sessionVersion: 1 } })
    const d = await connect(f, f.user)
    await d.exchange()
    await f.service.revokeDevice(d.session.identity, origin, d.key.jkt)
    expect((await trustRows(f)).length).toBe(1)
    await expect(renew(f, d.key, f.code())).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
    await expect(db.$executeRaw`INSERT INTO vault_extension_tokens(token_hash,kind,tenant_id,user_id,jkt,payload,expires_at) VALUES(${'f'.repeat(64)},'other',${f.a.id},${f.user.id},${'x'.repeat(43)},'{}',NOW())`).rejects.toThrow()
  }, 30_000)
  it('NA-0193: one trust per device key across users, and "Disconnect" by the device key ends it', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    await c.exchange()
    await db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${f.a.id},${f.peer.id},'extension',${f.m1.id},${f.m2.id},TRUE)`
    const second = await connect(f, f.peer, c.key)
    await second.exchange()
    const owners = await db.$queryRaw<Array<{ userId: number }>>`SELECT user_id AS userId FROM vault_extension_tokens WHERE kind='trust' AND tenant_id=${f.a.id}`
    expect(owners.map(o => o.userId)).toEqual([f.peer.id])
    const forget = async () => f.service.forget({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${BASE}/forget`, proof: await proof(f, c.key, { htm: 'POST', htu: `${BASE}/forget` }) }, { extensionId: EXT })
    await f.redis.del(`refresh:${second.session.jti}`)
    await expect(forget()).resolves.toEqual({ state: 'FORGOTTEN' })
    expect((await trustRows(f)).length).toBe(0)
    expect(Number((await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM vault_extension_tokens WHERE tenant_id=${f.a.id} AND user_id=${f.peer.id} AND kind='access'`)[0]!.n)).toBe(0)
    await expect(renew(f, c.key, f.code())).rejects.toMatchObject({ code: 'EXTENSION_UNAUTHORIZED' })
  }, 30_000)
  // NA-0195 (E2): reveal/copy in the extension against the real grant, item eligibility, policy and JWE.
  it('NA-0195: releases the real value, sealed to the popup key, only after the authenticator code and with the grant', async () => {
    const f = await fixture(), c = await connect(f, f.user)
    const { accessToken } = await c.exchange()
    const post = async (path: string) => ({ requestOrigin: `chrome-extension://${EXT}`, version: '0.1.0', url: `${BASE}/${path}`, proof: await proof(f, c.key, { htm: 'POST', htu: `${BASE}/${path}`, ath: sha256b64(accessToken) }) })
    const ephemeral = await generateKeyPair('RSA-OAEP-256', { modulusLength: 2048 })
    const jwk = await exportJWK(ephemeral.publicKey)
    const recipient = { kty: 'RSA' as const, n: jwk.n!, e: 'AQAB' as const }
    const deliver = async (action: 'reveal' | 'copy' = 'reveal') => f.service.deliver(await post('deliver'), `DPoP ${accessToken}`, { secretId: f.mine.id, action, recipient })
    await expect(deliver()).rejects.toMatchObject({ code: 'VAULT_STEP_UP_REQUIRED' })
    await expect(f.service.unlock(await post('unlock'), `DPoP ${accessToken}`, { otp: f.code() === '000000' ? '111111' : '000000' })).rejects.toMatchObject({ code: 'VAULT_REAUTH_FAILED' })
    await f.service.unlock(await post('unlock'), `DPoP ${accessToken}`, { otp: f.code() })
    await expect(deliver()).rejects.toMatchObject({ code: 'EXTENSION_ITEM_DENIED' })
    await db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${f.a.id},${f.user.id},'reveal',${f.m1.id},${f.m2.id},TRUE)`
    await expect(deliver()).rejects.toMatchObject({ code: 'EXTENSION_ITEM_DENIED' })
    await db.$executeRaw`INSERT INTO vault_web_items(tenant_id,secret_id,enabled) VALUES(${f.a.id},${f.mine.id},TRUE)`
    const released = await deliver()
    const { plaintext, protectedHeader } = await compactDecrypt(released.envelope, ephemeral.privateKey)
    expect(new TextDecoder().decode(plaintext)).toBe(f.value)
    expect(protectedHeader.vault).toEqual(released.context)
    expect(released.context).toMatchObject({ action: 'reveal', itemRef: `secret:${f.mine.id}`, recipientThumbprint: await calculateJwkThumbprint(recipient, 'sha256') })
    await expect(deliver('copy')).rejects.toMatchObject({ code: 'EXTENSION_ITEM_DENIED' })
    expect(await audits(f, 'DELIVERY_RELEASE_COMMITTED')).toBe(1); expect(await audits(f, 'EXTENSION_UNLOCK_DENIED')).toBe(1)
    const stored = await db.$queryRaw<Array<{ payload: string }>>`SELECT CAST(metadata AS CHAR) AS payload FROM vault_audit WHERE tenant_id=${f.a.id}`
    expect(stored.map(r => r.payload).join()).not.toContain(f.value)
  }, 30_000)
})
