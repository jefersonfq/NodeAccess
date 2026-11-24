/**
 * NA-0188 — synthetic tenant for the vault-administration browser flow: real Fastify vault routes, VaultService,
 * VaultAdministrationService, bcrypt, TOTP and JWT; the administration rules run in memory with the same contract
 * as SqlVaultAdministration (the SQL itself is covered by vault.mysql.test.ts). No database or external endpoint.
 * NA-0196: tenant Secrets (metadata only), released items, delivery policy proposals and the user availability read.
 * NA-0198: Windows Hello / passkey credentials in memory with the real verifier (@simplewebauthn/server) and routes.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import speakeasy from 'speakeasy'
import { VaultService } from '../../apps/backend/src/modules/vault-security/vault.service.js'
import { VaultAdministrationService } from '../../apps/backend/src/modules/vault-security/vault-administration.service.js'
import { vaultRoutes } from '../../apps/backend/src/modules/vault-security/vault.routes.js'
import { JweVaultEnvelope } from '../../apps/backend/src/modules/vault-security/vault-envelope.js'
import { SimpleWebauthnVerifier } from '../../apps/backend/src/modules/vault-security/vault-webauthn.js'
import { VaultWebauthnService } from '../../apps/backend/src/modules/vault-security/vault-webauthn.service.js'
import { RedisVaultOrigin, MethodVaultReauthentication } from '../../apps/backend/src/modules/vault-security/vault-identity.js'
import { denied, noApprover, unavailable, validProposalSeconds, VaultError, PROPOSAL_DEFAULT_SECONDS,
  type VaultAuthority, type VaultChange, type VaultEvent, type VaultPolicy } from '../../apps/backend/src/modules/vault-security/vault-domain.js'
import type { AdministrationReads, VaultAdministrationOverview, VaultStore, WebauthnCredential } from '../../apps/backend/src/modules/vault-security/vault-ports.js'
import { configureCurrentSessionReader } from '../../apps/backend/src/modules/auth/current-session.js'
import { TotpService } from '../../apps/backend/src/modules/auth/totp.service.js'

const TENANT = 7
export interface FixtureUser { id: number; name: string; email: string; role: 'admin' | 'user'; password: string; mfaSecret: string; jti: string; passwordHash: string }
interface Proposal { proposedBy: number; change: VaultChange; expiresAt: number }
const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

export async function createAdministrationFixture() {
  const key = randomBytes(32).toString('hex')
  const people: Array<[number, string, 'admin' | 'user']> = [[41, 'Ana Gestora', 'admin'], [42, 'Bruno Gestor', 'admin'], [43, 'Carla Admin', 'admin'], [44, 'Davi Operador', 'user']]
  const users = new Map<number, FixtureUser>()
  for (const [id, name, role] of people) {
    const password = `Synthetic-${randomUUID()}`
    users.set(id, { id, name, email: `${name.split(' ')[0]!.toLowerCase()}@example.test`, role, password, mfaSecret: speakeasy.generateSecret().base32,
      jti: randomUUID(), passwordHash: await bcrypt.hash(password, 4) })
  }
  const state = {
    managers: new Set<number>([41, 42]),
    grants: new Map<string, { enabled: boolean; grantedBy: number; approvedBy: number }>(),
    proposals: new Map<string, Proposal>(),
    // As delivered: reveal and copy off until two managers turn them on (NA-0196 flow).
    policy: { version: 1, unlock: true, reveal: false, copy: false, localReauth: true, origin: '', tenantQuota: 300 } as VaultPolicy,
    secrets: new Map<number, string>([[5, 'secret-ssh-teste2'], [6, 'db-backup']]),
    released: new Set<number>(),
    webauthn: new Map<string, WebauthnCredential & { userId: number }>(),
    events: [] as VaultEvent[],
  }
  let records = new Map<string, object>(), counts = new Map<string, number>(), tail = Promise.resolve()
  const now = (): number => Date.now()
  const managerIds = (): number[] => [...state.managers].filter(id => users.has(id))

  /** Same contract as SqlVaultAdministration (NA-0183/0186/0188). */
  function administration(actor: number): AdministrationReads & { propose(id: string, change: VaultChange, window?: number): void; approve(id: string, byReference: boolean): { change: VaultChange; proposedBy: number } } {
    const manager = (id: number): void => { if (!managerIds().includes(id)) denied() }
    const approvable = (change: VaultChange, proposer: number): void => {
      const target = change.kind === 'grant' || change.kind === 'manager' ? change.userId : undefined
      if (!managerIds().some(id => id !== proposer && id !== target)) noApprover()
    }
    return {
      isManager: async () => managerIds().includes(actor),
      summary: async () => {
        const ids = managerIds()
        if (!ids.includes(actor)) return { manager: false, pending: 0, managers: [] }
        const pending = [...state.proposals.values()].filter(p => p.expiresAt > now() && p.proposedBy !== actor && ids.includes(p.proposedBy)
          && !('userId' in p.change && p.change.userId === actor)).length
        return { manager: true, pending, managers: ids }
      },
      overview: async (): Promise<VaultAdministrationOverview> => {
        manager(actor)
        const ids = managerIds()
        return {
          serverNow: now(),
          users: [...users.values()].map(u => ({ id: u.id, name: u.name, email: u.email, manager: ids.includes(u.id),
            grants: { reveal: !!state.grants.get(`${u.id}:reveal`)?.enabled, copy: !!state.grants.get(`${u.id}:copy`)?.enabled, extension: !!state.grants.get(`${u.id}:extension`)?.enabled } })),
          proposals: [...state.proposals.entries()].filter(([, p]) => p.expiresAt > now() && ids.includes(p.proposedBy)).sort((a, b) => a[1].expiresAt - b[1].expiresAt).map(([reference, p]) => {
            const b = 'userId' in p.change ? users.get(p.change.userId) : undefined
            const alias = p.change.kind === 'item' ? state.secrets.get(p.change.secretId) : undefined
            return { reference, change: p.change, proposedBy: { id: p.proposedBy, name: users.get(p.proposedBy)?.name ?? '' }, mine: p.proposedBy === actor,
              expiresAt: p.expiresAt, beneficiary: b ? { id: b.id, name: b.name, email: b.email } : null,
              item: alias && p.change.kind === 'item' ? { id: p.change.secretId, alias } : null }
          }),
          items: [...state.released].map(id => ({ id, alias: state.secrets.get(id) ?? '' })).sort((a, b) => a.alias.localeCompare(b.alias)),
        }
      },
      propose: (id, change, window = PROPOSAL_DEFAULT_SECONDS) => {
        manager(actor)
        if ((change.kind === 'grant' || change.kind === 'manager') && change.userId === actor) denied()
        if (change.kind === 'proposalWindow' && !validProposalSeconds(change.seconds)) denied()
        approvable(change, actor)
        state.proposals.set(sha(id), { proposedBy: actor, change, expiresAt: now() + window * 1000 })
      },
      approve: (id, byReference) => {
        manager(actor)
        const reference = byReference ? id : sha(id), p = state.proposals.get(reference)
        if (!p || p.expiresAt <= now() || p.proposedBy === actor) unavailable()
        manager(p.proposedBy)
        const change = p.change
        if ((change.kind === 'grant' || change.kind === 'manager') && (change.userId === p.proposedBy || change.userId === actor)) denied()
        approvable(change, p.proposedBy)
        if (change.kind === 'grant') state.grants.set(`${change.userId}:${change.action}`, { enabled: change.enabled, grantedBy: p.proposedBy, approvedBy: actor })
        else if (change.kind === 'manager') {
          if (!users.has(change.userId)) denied()
          if (change.enabled) state.managers.add(change.userId)
          else { state.managers.delete(change.userId); for (const [key, open] of state.proposals) if (open.proposedBy === change.userId) state.proposals.delete(key) }
        } else if (change.kind === 'proposalWindow') {
          state.policy.proposalSeconds = change.seconds
          for (const open of state.proposals.values()) open.expiresAt = Math.min(open.expiresAt, now() + change.seconds * 1000)
        }
        else if (change.kind === 'confirmation') state.policy.confirmationSeconds = change.seconds
        else if (change.kind === 'item') {
          if (!state.secrets.has(change.secretId)) denied()
          if (change.enabled) state.released.add(change.secretId); else state.released.delete(change.secretId)
        } else if (change.kind === 'policy') Object.assign(state.policy, { reveal: change.reveal, copy: change.copy, tenantQuota: change.tenantQuota })
        else denied()
        state.policy.version += 1
        state.proposals.delete(reference)
        return { change, proposedBy: p.proposedBy }
      },
    }
  }

  const store: VaultStore = { async transaction(identity, run) {
    const user = users.get(identity.userId)
    if (!user || identity.tenantId !== TENANT) throw new VaultError('VAULT_FORBIDDEN', 403)
    let release!: () => void
    const previous = tail; tail = new Promise<void>(resolve => { release = resolve }); await previous
    const before = structuredClone(records), beforeCounts = new Map(counts)
    const authority: VaultAuthority = { policy: structuredClone(state.policy), validUntil: Number.MAX_SAFE_INTEGER, role: 'ADMIN', passwordHash: user.passwordHash,
      mfaSecret: user.mfaSecret, credentialVersion: `synthetic-${user.id}`, email: user.email, methods: { local: true, ldap: false, oidc: false, google: false } }
    const admin = administration(user.id)
    try { return await run({
      authority, now,
      get: async <T>(kind: string, id: string) => structuredClone(records.get(`${kind}:${id}`) ?? null) as T | null,
      put: async (kind, id, record) => { records.set(`${kind}:${id}`, structuredClone(record)) },
      remove: async (kind, id) => { records.delete(`${kind}:${id}`) },
      limit: async (name, windowMs, maximum) => {
        const bucket = `${user.id}:${name}:${Math.floor(now() / windowMs)}`, count = (counts.get(bucket) ?? 0) + 1
        counts.set(bucket, count); if (count > maximum) throw new VaultError('VAULT_RATE_LIMIT', 429)
      },
      secret: async () => denied(),
      audit: async event => { state.events.push(structuredClone(event)) },
      propose: async (id, change, window) => admin.propose(id, change, window),
      approve: async (id, byReference = false) => admin.approve(id, byReference),
      administration: admin,
      webauthn: {
        list: async () => [...state.webauthn.values()].filter(c => c.userId === user.id).map(({ userId: _u, ...c }) => structuredClone(c)),
        find: async id => { const c = state.webauthn.get(id); return c && c.userId === user.id ? (({ userId: _u, ...rest }) => structuredClone(rest))(c) : null },
        add: async c => { if (state.webauthn.has(c.id)) return false; state.webauthn.set(c.id, { ...c, userId: user.id, createdAt: now(), lastUsedAt: null }); return true },
        used: async (id, counter) => { const c = state.webauthn.get(id); if (c && c.userId === user.id) { c.counter = counter; c.lastUsedAt = now() } },
        remove: async id => { const c = state.webauthn.get(id); if (!c || c.userId !== user.id) return false; state.webauthn.delete(id); return true },
      },
      // Same grant rule as delivery; every synthetic Secret has tenant scope, so released items are visible to all.
      availability: async () => {
        const valid = (action: 'reveal' | 'copy'): boolean => {
          const g = state.grants.get(`${user.id}:${action}`)
          return !!g && g.enabled && g.grantedBy !== g.approvedBy && g.grantedBy !== user.id && g.approvedBy !== user.id
        }
        return { grants: { reveal: valid('reveal'), copy: valid('copy') }, items: [...state.released].sort((a, b) => a - b) }
      },
    }) } catch (error) { records = before; counts = beforeCounts; throw error }
    finally { release() }
  } }
  const entropy = { token: () => randomBytes(32).toString('base64url'), digest: (text: string) => sha(text) }
  const service = new VaultService(store,
    new RedisVaultOrigin({ get: async (id: string) => [...users.values()].some(u => id === `refresh:${u.jti}`) ? String(TENANT) : null }, key, now),
    new MethodVaultReauthentication(new TotpService()), new JweVaultEnvelope(), entropy, now, undefined, new SimpleWebauthnVerifier())
  const administrationService = new VaultAdministrationService(service, entropy)
  // Persisted identity matching each synthetic token (the guard compares role and capabilities).
  configureCurrentSessionReader(async (userId: number) => (users.has(userId) ? { tenantId: TENANT, active: true, deletedAt: null, tenantActive: true,
    targetTenantActive: true, sessionVersion: 3, role: users.get(userId)!.role === 'admin' ? 'ADMIN' : 'USER', isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: false } : null))
  const app = Fastify({ trustProxy: '127.0.0.1', logger: false })
  // Diagnostics for failed runs: route and error code of every refused vault call (no bodies, tokens or values).
  const failures: Array<{ at: number; route: string; status: number; code: string }> = []
  app.addHook('onSend', async (req, reply, payload) => {
    if (reply.statusCode >= 400 && failures.length < 200) {
      let code = ''
      try { code = String((JSON.parse(String(payload)) as { code?: unknown }).code ?? '').slice(0, 64) } catch { code = '' }
      failures.push({ at: now(), route: (req.routeOptions.url ?? '').slice(0, 120), status: reply.statusCode, code })
    }
    return payload
  })
  await app.register(fastifyJwt, { secret: key })
  const webauthnService = new VaultWebauthnService(service, entropy, new SimpleWebauthnVerifier())
  await app.register(async instance => vaultRoutes(instance, service, administrationService, webauthnService), { prefix: '/api/v1/vault-security' })
  const tokens = (id: number): { access: string; refresh: string } => {
    const u = users.get(id)!
    const access = app.jwt.sign({ sub: String(id), tenantId: TENANT, sessionVersion: 3, stage: 'authenticated', name: u.name, email: u.email, role: u.role,
      isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: false, forcePasswordChange: false }, { expiresIn: '1h' })
    const refresh = jwt.sign({ sub: String(id), stage: 'refresh', sessionVersion: 3, authMethod: 'local', jti: u.jti }, key, { expiresIn: '1h' })
    return { access, refresh }
  }
  return {
    app, users, state, tokens, failures,
    /** Secret metadata the portal list shows (never a value). */
    secrets: () => [...state.secrets].map(([id, alias]) => ({ id, tenantId: TENANT, alias, description: null, scope: 'TENANT', ownerUserId: 41, groupId: null,
      createdByUserId: 41, createdByUsername: 'Ana Gestora', source: 'MANUAL', createdAt: '2026-11-20T12:00:00Z', updatedAt: '2026-11-20T12:00:00Z', rotatedAt: null, revokedAt: null })),
    totp: (id: number) => speakeasy.totp({ secret: users.get(id)!.mfaSecret, encoding: 'base32' }),
    /** Between scenarios only: the per-user rate limits are covered by the unit tests, not by this flow. */
    resetLimits: () => { counts.clear() },
    close: async () => { await app.close(); configureCurrentSessionReader(undefined) },
  }
}
