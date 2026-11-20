/** Synthetic authorities. Real HTTP guards, local reauthentication, service and JWE. */
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import speakeasy from 'speakeasy'
import { VaultService } from '../../apps/backend/src/modules/vault-security/vault.service.js'
import { vaultRoutes } from '../../apps/backend/src/modules/vault-security/vault.routes.js'
import { JweVaultEnvelope } from '../../apps/backend/src/modules/vault-security/vault-envelope.js'
import { RedisVaultOrigin, MethodVaultReauthentication } from '../../apps/backend/src/modules/vault-security/vault-identity.js'
import { VaultError, type VaultAuthority, type VaultEvent } from '../../apps/backend/src/modules/vault-security/vault-domain.js'
import type { VaultStore } from '../../apps/backend/src/modules/vault-security/vault-ports.js'
import { configureCurrentSessionReader } from '../../apps/backend/src/modules/auth/current-session.js'
import { TotpService } from '../../apps/backend/src/modules/auth/totp.service.js'
import { encrypt } from '../../apps/backend/src/shared/crypto.js'
export async function createFrontendFixture() {
  const password = `Synthetic-password-${randomUUID()}`, value = `Synthetic-vault-${randomUUID()}`
  const mfaSecret = speakeasy.generateSecret().base32, key = randomBytes(32).toString('hex'), jti = randomUUID()
  let records = new Map<string, object>(), counts = new Map<string, number>()
  let responses: { status: number; noStore: boolean; plaintext: boolean; capabilities: string[] }[] = []
  let events: VaultEvent[] = [], timeOffset = 0, originActive = true, tail = Promise.resolve()
  const authority: VaultAuthority = {
    policy: { version: 1, unlock: true, reveal: true, copy: true, localReauth: true, origin: '', tenantQuota: 300 },
    validUntil: Number.MAX_SAFE_INTEGER, role: 'ADMIN', passwordHash: await bcrypt.hash(password, 4), mfaSecret, credentialVersion: 'synthetic-v1',
    email: 'vault-fixture@example.test', methods: { local: true, ldap: false, oidc: false, google: false },
  }
  const now = () => Date.now() + timeOffset, encrypted = encrypt(value)
  const store: VaultStore = { async transaction(identity, run) {
    if (identity.userId !== 41 || identity.tenantId !== 7) throw new VaultError('VAULT_FORBIDDEN', 403)
    let release!: () => void
    const previous = tail; tail = new Promise<void>(resolve => { release = resolve }); await previous
    const before = structuredClone(records), beforeCounts = new Map(counts), beforeEvents = [...events]
    try { return await run({
      authority: structuredClone(authority), now,
      get: async <T>(kind: string, id: string) => structuredClone(records.get(`${kind}:${id}`) ?? null) as T | null,
      put: async (kind, id, record) => { records.set(`${kind}:${id}`, structuredClone(record)) },
      remove: async (kind, id) => { records.delete(`${kind}:${id}`) },
      limit: async (name, windowMs, maximum) => {
        const bucket = `${name}:${Math.floor(now() / windowMs)}`, count = (counts.get(bucket) ?? 0) + 1
        counts.set(bucket, count); if (count > maximum) throw new VaultError('VAULT_RATE_LIMIT', 429)
      },
      secret: async id => { if (id !== 1) throw new VaultError('VAULT_FORBIDDEN', 403); return { ...encrypted, version: createHash('sha256').update('synthetic-secret-v1').digest('hex') } },
      audit: async event => { events.push(structuredClone(event)) },
      propose: async () => { throw new Error('Administration outside fixture') },
      approve: async () => { throw new Error('Administration outside fixture') },
    }) } catch (error) { records = before; counts = beforeCounts; events = beforeEvents; throw error }
    finally { release() }
  } }
  const service = new VaultService(store,
    new RedisVaultOrigin({ get: async id => originActive && id === `refresh:${jti}` ? '7' : null }, key, now),
    new MethodVaultReauthentication(new TotpService()), new JweVaultEnvelope(),
    { token: () => randomBytes(32).toString('base64url'), digest: text => createHash('sha256').update(text).digest('hex') }, now)
  configureCurrentSessionReader(async () => ({ tenantId: 7, active: true, deletedAt: null, tenantActive: true,
    targetTenantActive: true, sessionVersion: 3, role: 'ADMIN', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false }))
  const app = Fastify({ trustProxy: '127.0.0.1', logger: false })
  app.addHook('onSend', async (_request, reply, payload) => {
    const text = typeof payload === 'string' ? payload : ''
    let data: Record<string, unknown> = {}; try { data = JSON.parse(text) } catch { /* Non-JSON responses have no capabilities. */ }
    responses.push({ status: reply.statusCode, noStore: reply.getHeader('cache-control') === 'no-store', plaintext: text.includes(value),
      capabilities: ['clientId', 'sessionId', 'operationId'].flatMap(name => typeof data[name] === 'string' ? [data[name] as string] : []) })
    return payload
  })
  await app.register(fastifyJwt, { secret: key })
  await app.register(async instance => vaultRoutes(instance, service), { prefix: '/api/v1/vault-security' })
  const claims = { sub: '41', tenantId: 7, sessionVersion: 3, stage: 'authenticated', name: 'Operator', email: 'fixture@example.test',
    role: 'admin', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, forcePasswordChange: false }
  const accessToken = app.jwt.sign(claims, { expiresIn: '1h' })
  const refreshToken = jwt.sign({ sub: '41', stage: 'refresh', sessionVersion: 3, authMethod: 'local', jti }, key, { expiresIn: '1h' })
  return { app, password, value, accessToken, refreshToken, authority,
    token: () => speakeasy.totp({ secret: mfaSecret, encoding: 'base32' }),
    alternateAccessToken: () => app.jwt.sign({ ...claims, tenantId: 8 }, { expiresIn: '1h' }),
    events: () => [...events], responses: () => [...responses], advance: (ms: number) => { timeOffset += ms }, revoke: () => { originActive = false },
    reset: () => { records.clear(); counts.clear(); events = []; responses = []; timeOffset = 0; originActive = true },
    close: async () => { await app.close(); configureCurrentSessionReader(undefined) },
  }
}
