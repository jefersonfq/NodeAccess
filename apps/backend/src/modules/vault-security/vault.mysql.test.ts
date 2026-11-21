import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient, Prisma } from '@prisma/client'
import { Redis } from 'ioredis'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import * as speakeasy from 'speakeasy'
import { createHash, generateKeyPairSync, randomBytes, randomUUID, type KeyObject } from 'node:crypto'
import { compactDecrypt } from 'jose'
import { VaultService } from './vault.service.js'
import { VaultAdministrationService } from './vault-administration.service.js'
import { SqlVaultStore } from './vault.repository.js'
import { VaultDatabase } from './vault.database.js'
import { RedisVaultOrigin, MethodVaultReauthentication } from './vault-identity.js'
import { JweVaultEnvelope } from './vault-envelope.js'
import { TotpService } from '../auth/totp.service.js'
import { encrypt } from '../../shared/crypto.js'
import type { EnvelopeSealer, VaultStore, VaultTransaction } from './vault-ports.js'
import type { VaultIdentity, VaultOperation } from './vault-domain.js'

const enabled = process.env.RUN_VAULT_MYSQL === 'true'
const origin = 'https://vault.example.test'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const entropy = { token: () => randomBytes(32).toString('base64url'), digest }
const policy = { unlock: true, reveal: true, copy: true, localReauth: true, origin, tenantQuota: 300 }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

describe.skipIf(!enabled)('Vault SQL/Redis isolated integration', () => {
  let db: PrismaClient, writer: PrismaClient
  const connections: Redis[] = []
  let keys: { publicKey: KeyObject; privateKey: KeyObject }
  let recipient: VaultOperation['recipient']
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '')
    if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/na0178_') || !/^[a-f0-9]{24}$/.test(process.env.VAULT_DISPOSABLE_NONCE ?? '')) {
      throw new Error('Requires the disposable Vault harness; refusing an unverified database')
    }
    keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
    recipient = keys.publicKey.export({ format: 'jwk' }) as VaultOperation['recipient']
    db = new PrismaClient(); writer = new PrismaClient()
    await db.$connect(); await writer.$connect()
  })
  afterAll(async () => {
    for (const redis of connections) redis.disconnect()
    await Promise.all([db?.$disconnect(), writer?.$disconnect()])
  })
  async function fixture() {
    const suffix = randomUUID(); const password = `test-only-${suffix}`; const mfaSecret = speakeasy.generateSecret().base32
    const tenant = await db.tenant.create({ data: { name: 'Disposable Vault', slug: `na0178-${suffix}` } })
    const user = await db.user.create({ data: { name: 'Fixture', email: `fixture-${suffix}@example.test`, tenantId: tenant.id,
      passwordHash: await bcrypt.hash(password, 4), mfaSecret, mfaEnabled: true, forcePasswordChange: false, sessionVersion: 1 } })
    const manager1 = await db.user.create({ data: { name: 'Approval A', email: `a-${suffix}@example.test`, tenantId: tenant.id, role: 'ADMIN' } })
    const manager2 = await db.user.create({ data: { name: 'Approval B', email: `b-${suffix}@example.test`, tenantId: tenant.id, role: 'ADMIN' } })
    const group = await db.group.create({ data: { name: 'Fixture group', tenantId: tenant.id } })
    await db.userGroup.create({ data: { userId: user.id, groupId: group.id } })
    await db.license.create({ data: { tenantId: tenant.id, maxUsers: 10, featureEntitlementsJson: { secrets: true } } })
    await db.tenantAuthPolicy.create({ data: { tenantId: tenant.id } })
    const value = `disposable-value-${suffix}`, encrypted = encrypt(value)
    const secret = await db.secret.create({ data: { tenantId: tenant.id, alias: 'vault-fixture', scope: 'GROUP', groupId: group.id,
      encryptedValue: encrypted.encrypted, iv: encrypted.iv } })
    // Fixtures represent explicit two-person grants in an isolated database, never production bootstrap.
    await db.$executeRaw`INSERT INTO vault_policies(tenant_id,version,config) VALUES(${tenant.id},1,${JSON.stringify(policy)})`
    await db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled)
      VALUES(${tenant.id},${user.id},'reveal',${manager1.id},${manager2.id},TRUE)`
    await db.$executeRaw`INSERT INTO vault_web_items(tenant_id,secret_id,enabled) VALUES(${tenant.id},${secret.id},TRUE)`
    const identity: VaultIdentity = { userId: user.id, tenantId: tenant.id, sessionVersion: 1 }
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, enableOfflineQueue: false }); connections.push(redis)
    if (redis.status !== 'ready') await new Promise<void>((resolve, reject) => { redis.once('ready', resolve); redis.once('error', reject) })
    const jti = randomUUID(), signingKey = process.env.JWT_SECRET!
    await redis.set(`refresh:${jti}`, String(tenant.id), 'EX', 300)
    const refresh = jwt.sign({ sub: String(user.id), sessionVersion: 1, authMethod: 'local', stage: 'refresh', jti }, signingKey, { expiresIn: 300 })
    let clockOffset = 0
    const now = () => Date.now() + clockOffset
    const advance = (milliseconds: number) => { clockOffset += milliseconds }
    const store = new SqlVaultStore(db, now), verifier = new RedisVaultOrigin(redis, signingKey, now), sealer = new JweVaultEnvelope()
    const makeService = (overrides: { store?: VaultStore; sealer?: EnvelopeSealer } = {}) => new VaultService(overrides.store ?? store, verifier,
      new MethodVaultReauthentication(new TotpService()), overrides.sealer ?? sealer, entropy, now)
    const service = makeService()
    const { clientId } = await service.register(identity, refresh, origin)
    const { challengeId } = await service.challenge(identity, clientId, origin)
    const { sessionId } = await service.unlock(identity, clientId, origin, challengeId, password, speakeasy.totp({ secret: mfaSecret, encoding: 'base32' }))
    const request = () => service.request(identity, clientId, origin, sessionId, 'reveal', secret.id, recipient)
    const consume = (operationId: string, candidate = service) => candidate.consume(identity, clientId, origin, sessionId, operationId)
    const releaseCount = async () => Number((await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM vault_audit WHERE tenant_id=${tenant.id} AND event_type='DELIVERY_RELEASE_COMMITTED'`)[0]!.total)
    const state = async (operationId: string) => {
      const rows = await db.$queryRaw<Array<{ state: string }>>`SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.state')) AS state FROM vault_records
        WHERE tenant_id=${tenant.id} AND user_id=${user.id} AND kind='operation' AND token_hash=${digest(operationId)}`
      return rows[0]?.state
    }
    return { tenant, user, manager1, manager2, password, mfaSecret, group, secret, value, identity, redis, jti, refresh, store, sealer, makeService, service, clientId, sessionId, request, consume, releaseCount, state, advance }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  async function waitForDatabaseLock(): Promise<void> {
    const deadline = Date.now() + 1400
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM performance_schema.data_lock_waits`
      if (Number(rows[0]?.total ?? 0) > 0) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Competing transaction did not reach the expected database lock')
  }
  const mutations = {
    rotate: (tx: Prisma.TransactionClient, f: Fixture) => {
      const next = encrypt('rotated-test-value')
      return tx.secret.update({ where: { id: f.secret.id }, data: { encryptedValue: next.encrypted, iv: next.iv } })
    },
    revoke: (tx: Prisma.TransactionClient, f: Fixture) => tx.secret.update({ where: { id: f.secret.id }, data: { revokedAt: new Date() } }),
    group: (tx: Prisma.TransactionClient, f: Fixture) => tx.userGroup.delete({ where: { userId_groupId: { userId: f.user.id, groupId: f.group.id } } }),
    user: (tx: Prisma.TransactionClient, f: Fixture) => tx.user.update({ where: { id: f.user.id }, data: { active: false } }),
    tenant: (tx: Prisma.TransactionClient, f: Fixture) => tx.tenant.update({ where: { id: f.tenant.id }, data: { active: false } }),
    license: (tx: Prisma.TransactionClient, f: Fixture) => tx.license.update({ where: { tenantId: f.tenant.id }, data: { featureEntitlementsJson: { secrets: false } } }),
    'license-inactive': (tx: Prisma.TransactionClient, f: Fixture) => tx.license.update({ where: { tenantId: f.tenant.id }, data: { active: false } }),
    'license-expired': (tx: Prisma.TransactionClient, f: Fixture) => tx.license.update({ where: { tenantId: f.tenant.id }, data: { expiresAt: new Date(Date.now() - 1) } }),
    policy: (tx: Prisma.TransactionClient, f: Fixture) => tx.$executeRaw`UPDATE vault_policies SET version=version+1 WHERE tenant_id=${f.tenant.id}`,
  }
  it('rehearses additive migration without making an old item eligible or granting owner extraction', async () => {
    const f = await fixture()
    await db.$executeRaw`DELETE FROM vault_web_items WHERE tenant_id=${f.tenant.id}`
    await expect(f.request()).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    await db.$executeRaw`INSERT INTO vault_web_items(tenant_id,secret_id,enabled) VALUES(${f.tenant.id},${f.secret.id},TRUE)`
    await db.$executeRaw`DELETE FROM vault_entitlements WHERE tenant_id=${f.tenant.id}`
    await expect(f.request()).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect(await f.releaseCount()).toBe(0)
  })
  it('allows exactly one of twenty concurrent consumers and persists exactly one release audit', async () => {
    const f = await fixture(), op = await f.request()
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.consume(op.operationId)))
    const successes = results.filter((result): result is PromiseFulfilledResult<{ envelope: string }> => result.status === 'fulfilled')
    expect(successes).toHaveLength(1)
    expect(new TextDecoder().decode((await compactDecrypt(successes[0]!.value.envelope, keys.privateKey)).plaintext)).toBe(f.value)
    expect(await f.releaseCount()).toBe(1)
    expect(await f.state(op.operationId)).toBe('CONSUMED')
    const stored = await db.$queryRaw<Array<{ payload: unknown }>>`SELECT payload FROM vault_records WHERE tenant_id=${f.tenant.id}`
    const audits = await db.$queryRaw<Array<{ metadata: unknown }>>`SELECT metadata FROM vault_audit WHERE tenant_id=${f.tenant.id}`
    const serialized = JSON.stringify([stored, audits])
    for (const sensitive of [f.value, f.refresh, f.sessionId, f.clientId, successes[0]!.value.envelope]) expect(serialized).not.toContain(sensitive)
  }, 15_000)
  it('denies central logout before consumption and cannot replay a lost delivery response', async () => {
    const f = await fixture(), op = await f.request()
    await f.redis.del(`refresh:${f.jti}`)
    await expect(f.consume(op.operationId)).rejects.toMatchObject({ code: 'VAULT_ORIGIN_REVOKED' })
    expect(await f.releaseCount()).toBe(0)
    const next = await fixture(), nextOp = await next.request()
    await next.consume(nextOp.operationId) // Caller loses this response; grant must stay consumed.
    await expect(next.consume(nextOp.operationId)).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
    expect(await next.releaseCount()).toBe(1)
  })
  it.each(['logout', 'redis-disconnect'] as const)('denies the envelope after SQL commit on %s without reopening the grant', async mode => {
    const f = await fixture(), op = await f.request()
    const store: VaultStore = { transaction: async <T>(identity: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>) => {
      const result = await f.store.transaction(identity, run)
      if (result && typeof result === 'object' && 'envelope' in result) {
        if (mode === 'logout') await f.redis.del(`refresh:${f.jti}`)
        else f.redis.disconnect()
      }
      return result
    } }
    await expect(f.consume(op.operationId, f.makeService({ store }))).rejects.toMatchObject({ code: mode === 'logout' ? 'VAULT_ORIGIN_REVOKED' : 'VAULT_DEPENDENCY_UNAVAILABLE' })
    expect(await f.state(op.operationId)).toBe('CONSUMED')
    expect(await f.releaseCount()).toBe(1)
  })
  it('denies natural license expiry during sealing without committing release', async () => {
    const f = await fixture(), expiresAt = new Date(Date.now() + 10_000)
    await db.license.update({ where: { tenantId: f.tenant.id }, data: { expiresAt } })
    const op = await f.request()
    expect(op.expiresAt).toBeLessThanOrEqual(expiresAt.getTime())
    let sealCalls = 0
    const sealer: EnvelopeSealer = { validate: key => f.sealer.validate(key), seal: async (key, context, secret) => {
      sealCalls++
      const envelope = await f.sealer.seal(key, context, secret)
      f.advance(20_000) // Time advances while the license row remains locked; no writer can represent this expiry.
      return envelope
    } }
    await expect(f.consume(op.operationId, f.makeService({ sealer }))).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
    expect(sealCalls).toBe(1)
    expect(await f.state(op.operationId)).toBe('AUTHORIZED')
    expect(await f.releaseCount()).toBe(0)
  })
  it('rejects a shortened license deadline before sealing instead of mutating authorized context', async () => {
    const f = await fixture(), op = await f.request(), expiresAt = new Date(Date.now() + 10_000)
    expect(op.expiresAt).toBeGreaterThan(expiresAt.getTime())
    await db.license.update({ where: { tenantId: f.tenant.id }, data: { expiresAt } })
    let sealCalls = 0
    const sealer: EnvelopeSealer = { validate: key => f.sealer.validate(key), seal: async (key, context, secret) => {
      sealCalls++
      return f.sealer.seal(key, context, secret)
    } }
    await expect(f.consume(op.operationId, f.makeService({ sealer }))).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
    expect(sealCalls).toBe(0)
    expect(await f.state(op.operationId)).toBe('AUTHORIZED')
    expect(await f.releaseCount()).toBe(0)
  })
  it('uses the lazy dedicated database provider and closes only its own real pool', async () => {
    const f = await fixture(), op = await f.request(), database = new VaultDatabase(process.env.DATABASE_URL!)
    let providerCalls = 0
    const store = new SqlVaultStore(() => { providerCalls++; return database.client() })
    expect(providerCalls).toBe(0)
    const central = (await db.$queryRaw<Array<{ id: bigint }>>`SELECT CONNECTION_ID() AS id`)[0]!.id
    try {
      const result = await f.consume(op.operationId, f.makeService({ store }))
      expect(new TextDecoder().decode((await compactDecrypt(result.envelope, keys.privateKey)).plaintext)).toBe(f.value)
      expect(providerCalls).toBe(1)
      expect(database.client()).not.toBe(db)
      const owned = (await database.client().$queryRaw<Array<{ id: bigint }>>`SELECT CONNECTION_ID() AS id`)[0]!.id
      await database.close()
      expect(() => database.client()).toThrow('Vault database closed')
      expect(await db.$queryRaw`SELECT PROCESSLIST_ID FROM performance_schema.threads WHERE PROCESSLIST_ID=${owned}`).toEqual([])
      expect((await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM performance_schema.threads WHERE PROCESSLIST_ID=${central}`)[0]!.count).toBe(1n)
      expect(await db.user.findUnique({ where: { id: f.user.id }, select: { id: true } })).toEqual({ id: f.user.id })
      expect(await f.releaseCount()).toBe(1)
    } finally { await database.close() }
  })
  it('rolls operation consumption back when durable audit insertion fails', async () => {
    const f = await fixture(), op = await f.request()
    await db.$executeRawUnsafe(`ALTER TABLE vault_audit ADD CONSTRAINT vault_test_audit_failure CHECK (tenant_id <> ${f.tenant.id} OR event_type <> 'DELIVERY_RELEASE_COMMITTED')`)
    try {
      await expect(f.consume(op.operationId)).rejects.toThrow()
      expect(await f.state(op.operationId)).toBe('AUTHORIZED')
      expect(await f.releaseCount()).toBe(0)
    } finally { await db.$executeRawUnsafe('ALTER TABLE vault_audit DROP CHECK vault_test_audit_failure') }
    expect((await f.consume(op.operationId)).envelope).toBeTruthy()
    expect(await f.releaseCount()).toBe(1)
  })
  it.each(Object.keys(mutations) as Array<keyof typeof mutations>)('serializes %s winning before consumption', async kind => {
    const f = await fixture(), op = await f.request(), changed = deferred(), commit = deferred()
    const mutation = writer.$transaction(async tx => { await mutations[kind](tx, f); changed.resolve(); await commit.promise }, { timeout: 5000 })
    await changed.promise
    const delivery = f.consume(op.operationId).then(value => ({ value }), error => ({ error: error as Error }))
    try { await waitForDatabaseLock() } finally { commit.resolve() }
    await mutation
    expect(await delivery).toHaveProperty('error')
    expect(await f.releaseCount()).toBe(0)
    expect(await f.state(op.operationId)).toBe('AUTHORIZED')
  }, 10_000)
  it.each(Object.keys(mutations) as Array<keyof typeof mutations>)('serializes consumption winning before %s', async kind => {
    const f = await fixture(), op = await f.request(), sealed = deferred(), release = deferred()
    const sealer: EnvelopeSealer = { validate: key => f.sealer.validate(key), seal: async (key, context, secret) => {
      const value = await f.sealer.seal(key, context, secret); sealed.resolve(); await release.promise; return value
    } }
    const delivery = f.consume(op.operationId, f.makeService({ sealer })).then(value => ({ value }), error => ({ error: error as Error }))
    await sealed.promise
    const mutation = Promise.resolve(mutations[kind](writer, f))
    try { await waitForDatabaseLock() } finally { release.resolve() }
    const result = await delivery
    await mutation
    expect(result).toHaveProperty('value')
    expect(await f.releaseCount()).toBe(1)
    expect(await f.state(op.operationId)).toBe('CONSUMED')
  }, 10_000)
  async function managerSession(f: Fixture, userId: number) {
    await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(f.password, 4), mfaSecret: f.mfaSecret, mfaEnabled: true, forcePasswordChange: false, sessionVersion: 1 } })
    await db.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${f.tenant.id},${userId},TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE`
    const identity = { userId, tenantId: f.tenant.id, sessionVersion: 1 }, jti = randomUUID()
    await f.redis.set(`refresh:${jti}`, String(f.tenant.id), 'EX', 300)
    const refresh = jwt.sign({ sub: String(userId), sessionVersion: 1, authMethod: 'local', stage: 'refresh', jti }, process.env.JWT_SECRET!, { expiresIn: 300 })
    const { clientId } = await f.service.register(identity, refresh, origin)
    const { challengeId } = await f.service.challenge(identity, clientId, origin)
    const { sessionId } = await f.service.unlock(identity, clientId, origin, challengeId, f.password, speakeasy.totp({ secret: f.mfaSecret, encoding: 'base32' }))
    return { identity, clientId, sessionId }
  }
  it('requires two distinct managers, rejects self-grants and invalidates older capabilities after approval', async () => {
    const f = await fixture(), op = await f.request(), a = await managerSession(f, f.manager1.id), b = await managerSession(f, f.manager2.id)
    const admin = new VaultAdministrationService(f.service, entropy)
    await expect(admin.propose(f.identity, f.clientId, origin, f.sessionId, { kind: 'grant', userId: f.user.id, action: 'copy', enabled: true })).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    await expect(admin.propose(a.identity, a.clientId, origin, a.sessionId, { kind: 'grant', userId: a.identity.userId, action: 'copy', enabled: true })).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    const forbidden = await admin.propose(a.identity, a.clientId, origin, a.sessionId, { kind: 'grant', userId: b.identity.userId, action: 'copy', enabled: true })
    await expect(admin.approve(b.identity, b.clientId, origin, b.sessionId, forbidden.proposalId)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    const proposal = await admin.propose(a.identity, a.clientId, origin, a.sessionId, { kind: 'grant', userId: f.user.id, action: 'copy', enabled: true })
    await expect(admin.approve(a.identity, a.clientId, origin, a.sessionId, proposal.proposalId)).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
    expect(await admin.approve(b.identity, b.clientId, origin, b.sessionId, proposal.proposalId)).toEqual({ state: 'APPLIED' })
    const grants = await db.$queryRaw<Array<{ grantedBy: number; approvedBy: number; enabled: number }>>`SELECT granted_by AS grantedBy,approved_by AS approvedBy,enabled FROM vault_entitlements WHERE tenant_id=${f.tenant.id} AND user_id=${f.user.id} AND action='copy'`
    expect(Number(grants[0]!.enabled)).toBe(1)
    expect(grants[0]).toMatchObject({ grantedBy: a.identity.userId, approvedBy: b.identity.userId })
    await expect(f.consume(op.operationId)).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(await f.releaseCount()).toBe(0)
    const renewed = await managerSession(f, f.manager2.id)
    await expect(admin.approve(renewed.identity, renewed.clientId, origin, renewed.sessionId, proposal.proposalId)).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
    await expect(db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled) VALUES(${f.tenant.id},${f.manager1.id},'copy',${f.manager1.id},${f.manager2.id},TRUE)`).rejects.toThrow()
  }, 10_000)
  it('NA-0183: the portal screen lists users, grants and live proposals and approves by reference with correlated audit', async () => {
    const f = await fixture(), a = await managerSession(f, f.manager1.id), b = await managerSession(f, f.manager2.id)
    const admin = new VaultAdministrationService(f.service, entropy)
    expect(await admin.status(a.identity, origin)).toEqual({ manager: true })
    expect(await admin.status(f.identity, origin)).toEqual({ manager: false })
    await expect(admin.overview(f.identity, f.clientId, origin, f.sessionId)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    const { proposalId } = await admin.propose(a.identity, a.clientId, origin, a.sessionId, { kind: 'grant', userId: f.user.id, action: 'extension', enabled: true })
    const listed = await admin.overview(b.identity, b.clientId, origin, b.sessionId)
    expect(listed.users.map(u => u.id)).toEqual(expect.arrayContaining([f.user.id, f.manager1.id, f.manager2.id]))
    expect(listed.users.find(u => u.id === f.user.id)?.grants).toMatchObject({ extension: false })
    expect(listed.proposals).toHaveLength(1)
    const [pending] = listed.proposals
    expect(pending).toMatchObject({ proposedBy: { id: f.manager1.id }, mine: false, change: { kind: 'grant', userId: f.user.id, action: 'extension', enabled: true }, beneficiary: { id: f.user.id } })
    expect(JSON.stringify(listed)).not.toContain(proposalId)
    expect((await admin.overview(a.identity, a.clientId, origin, a.sessionId)).proposals[0]?.mine).toBe(true)
    await expect(admin.approveReference(a.identity, a.clientId, origin, a.sessionId, pending!.reference)).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
    expect(await admin.approveReference(b.identity, b.clientId, origin, b.sessionId, pending!.reference)).toEqual({ state: 'APPLIED' })
    const audit = await db.$queryRaw<Array<{ type: string; ref: string | null }>>`SELECT event_type AS type,JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.operationId')) AS ref
      FROM vault_audit WHERE tenant_id=${f.tenant.id} AND event_type IN ('POLICY_CHANGE_PROPOSED','POLICY_CHANGED') ORDER BY created_at,event_type DESC`
    expect(audit.map(r => r.ref)).toEqual([pending!.reference, pending!.reference])
    const b2 = await managerSession(f, f.manager2.id)
    const after = await admin.overview(b2.identity, b2.clientId, origin, b2.sessionId)
    expect(after.proposals).toEqual([])
    expect(after.users.find(u => u.id === f.user.id)?.grants).toMatchObject({ extension: true })
    await expect(admin.approveReference(b2.identity, b2.clientId, origin, b2.sessionId, pending!.reference)).rejects.toMatchObject({ code: 'OPERATION_UNAVAILABLE' })
  }, 10_000)
  it('revalidates the proposing manager at approval, even if the proposal was originally authorized', async () => {
    const f = await fixture(), a = await managerSession(f, f.manager1.id), b = await managerSession(f, f.manager2.id)
    const admin = new VaultAdministrationService(f.service, entropy)
    const proposal = await admin.propose(a.identity, a.clientId, origin, a.sessionId, { kind: 'item', secretId: f.secret.id, enabled: false })
    await db.$executeRaw`UPDATE vault_managers SET enabled=FALSE WHERE tenant_id=${f.tenant.id} AND user_id=${a.identity.userId}`
    await expect(admin.approve(b.identity, b.clientId, origin, b.sessionId, proposal.proposalId)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect((await f.request()).state).toBe('AUTHORIZED')
  })
  it('applies item and policy proposals with typed JSON booleans, version increments and capability invalidation', async () => {
    const f = await fixture(), a = await managerSession(f, f.manager1.id), b = await managerSession(f, f.manager2.id)
    const admin = new VaultAdministrationService(f.service, entropy)
    const item = await admin.propose(a.identity, a.clientId, origin, a.sessionId, { kind: 'item', secretId: f.secret.id, enabled: false })
    await admin.approve(b.identity, b.clientId, origin, b.sessionId, item.proposalId)
    const eligible = await db.$queryRaw<Array<{ enabled: number }>>`SELECT enabled FROM vault_web_items WHERE tenant_id=${f.tenant.id} AND secret_id=${f.secret.id}`
    expect(Number(eligible[0]!.enabled)).toBe(0)
    const a2 = await managerSession(f, f.manager1.id), b2 = await managerSession(f, f.manager2.id)
    const proposal = await admin.propose(a2.identity, a2.clientId, origin, a2.sessionId, { kind: 'policy', reveal: false, copy: true, tenantQuota: 17 })
    await admin.approve(b2.identity, b2.clientId, origin, b2.sessionId, proposal.proposalId)
    const rows = await db.$queryRaw<Array<{ version: number; config: { reveal: boolean; copy: boolean; tenantQuota: number }; revealType: string; copyType: string }>>`SELECT version,config,JSON_TYPE(JSON_EXTRACT(config,'$.reveal')) AS revealType,JSON_TYPE(JSON_EXTRACT(config,'$.copy')) AS copyType FROM vault_policies WHERE tenant_id=${f.tenant.id}`
    expect(rows[0]).toMatchObject({ version: 3, revealType: 'BOOLEAN', copyType: 'BOOLEAN', config: { reveal: false, copy: true, tenantQuota: 17 } })
    await expect(f.service.current(f.identity, f.clientId, origin)).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
  }, 10_000)
  it('executes deployment bootstrap, bounded cleanup and disable CLI against the disposable database', async () => {
    const cli = promisify(execFile)
    const suffix = randomUUID(), tenant = await db.tenant.create({ data: { name: 'CLI fixture', slug: `cli-${suffix}` } })
    const managers = []
    for (const label of ['a', 'b']) managers.push(await db.user.create({ data: { tenantId: tenant.id, name: label, email: `${label}-${suffix}@example.test`, passwordHash: await bcrypt.hash(randomUUID(), 4), mfaEnabled: true, mfaSecret: speakeasy.generateSecret().base32, forcePasswordChange: false } }))
    const input = JSON.stringify({ tenantId: tenant.id, origin, managerIds: managers.map(u => u.id), allowLocalReauthentication: true })
    const dry = await cli(process.execPath, ['tools/vault-security/manage.mjs', 'bootstrap', input], { env: process.env })
    expect(JSON.parse(dry.stdout)).toEqual({ applied: false, managers: 2, extractionEnabled: false })
    expect(await db.$queryRaw`SELECT tenant_id FROM vault_policies WHERE tenant_id=${tenant.id}`).toEqual([])
    const applied = await cli(process.execPath, ['tools/vault-security/manage.mjs', 'bootstrap', input, '--apply'], { env: process.env })
    expect(JSON.parse(applied.stdout)).toEqual({ applied: true, managers: 2, extractionEnabled: false })
    const config = await db.$queryRaw<Array<{ config: { reveal: boolean; copy: boolean } }>>`SELECT config FROM vault_policies WHERE tenant_id=${tenant.id}`
    expect(config[0]!.config).toMatchObject({ reveal: false, copy: false })
    expect(await db.$queryRaw`SELECT user_id FROM vault_entitlements WHERE tenant_id=${tenant.id}`).toEqual([])
    expect(await db.$queryRaw`SELECT secret_id FROM vault_web_items WHERE tenant_id=${tenant.id}`).toEqual([])
    await expect(cli(process.execPath, ['tools/vault-security/manage.mjs', 'bootstrap', input, '--apply'], { env: process.env })).rejects.toMatchObject({ code: 1 })
    const old = new Date(Date.now() - 60_000), future = new Date(Date.now() + 60_000), manager = managers[0]!.id
    const records = Array.from({ length: 1002 }, () => Prisma.sql`(${tenant.id},${manager},'operation',${digest(randomUUID())},'{}',${old})`)
    await db.$executeRaw(Prisma.sql`INSERT INTO vault_records(tenant_id,user_id,kind,token_hash,payload,expires_at) VALUES ${Prisma.join(records)}`)
    await db.$executeRaw`INSERT INTO vault_records(tenant_id,user_id,kind,token_hash,payload,expires_at) VALUES(${tenant.id},${manager},'operation',${digest(randomUUID())},'{}',${future})`
    await db.$executeRaw`INSERT INTO vault_proposals(tenant_id,proposal_hash,proposed_by,payload,expires_at) VALUES(${tenant.id},${digest(randomUUID())},${manager},'{}',${old})`
    const auditBefore = await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM vault_audit`
    const recordsBefore = (await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM vault_records`)[0]!.total
    expect(JSON.parse((await cli(process.execPath, ['tools/vault-security/manage.mjs', 'maintenance'], { env: process.env })).stdout)).toEqual({ applied: false, records: 0, proposals: 0 })
    const cleanup = JSON.parse((await cli(process.execPath, ['tools/vault-security/manage.mjs', 'maintenance', '--apply'], { env: process.env })).stdout) as { records: number; proposals: number }
    expect(cleanup.records).toBe(1000)
    expect(cleanup.proposals).toBeGreaterThanOrEqual(1)
    expect((await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM vault_records`)[0]!.total).toBe(recordsBefore - 1000n)
    expect((await db.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) AS total FROM vault_records WHERE tenant_id=${tenant.id} AND expires_at=${future}`)[0]!.total).toBe(1n)
    expect(await db.$queryRaw`SELECT COUNT(*) AS total FROM vault_audit`).toEqual(auditBefore)
    expect(JSON.parse((await cli(process.execPath, ['tools/vault-security/manage.mjs', 'disable', String(tenant.id), '--apply'], { env: process.env })).stdout)).toEqual({ applied: true })
    expect((await db.$queryRaw<Array<{ unlockType: string; config: { unlock: boolean }; version: number }>>`SELECT version,config,JSON_TYPE(JSON_EXTRACT(config,'$.unlock')) AS unlockType FROM vault_policies WHERE tenant_id=${tenant.id}`)[0]).toMatchObject({ version: 2, unlockType: 'BOOLEAN', config: { unlock: false } })
  }, 20_000)
  it('locks only the Vault client and preserves unrelated operational secret rows', async () => {
    const f = await fixture(), op = await f.request()
    const before = await db.secret.findUniqueOrThrow({ where: { id: f.secret.id } })
    await f.service.lock(f.identity, f.clientId, origin)
    await expect(f.consume(op.operationId)).rejects.toMatchObject({ code: 'VAULT_LOCKED' })
    expect(await f.redis.get(`refresh:${f.jti}`)).toBe(String(f.tenant.id))
    const after = await db.secret.findUniqueOrThrow({ where: { id: f.secret.id } })
    expect(after).toEqual(before)
    expect(await f.releaseCount()).toBe(0)
  })
})
