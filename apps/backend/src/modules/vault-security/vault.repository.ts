import { SqlVaultAdministration } from './vault-administration.repository.js'
import { SqlVaultExtension } from './vault-extension.repository.js'
import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { assertPolicy, denied, VaultError } from './vault-domain.js'
import type { VaultAction, VaultAuthority, VaultEvent, VaultIdentity, VaultPolicy, VaultSecret, VaultChange } from './vault-domain.js'
import type { RecordKind, VaultStore, VaultTransaction } from './vault-ports.js'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const truth = (x: unknown): boolean => x === true || x === 1 || x === 1n
function json<T>(x: unknown): T { return (typeof x === 'string' ? JSON.parse(x) : x) as T }
type Tx = Prisma.TransactionClient
interface UserState { active: boolean; deletedAt: Date | null; version: number; role: 'ADMIN' | 'USER'; email: string; passwordHash: string | null; mfaSecret: string | null; mfaEnabled: boolean; forcePasswordChange: boolean; lockedUntil: Date | null }

/** Locking reads share the same rows mutated by existing writers; no event-cache authorization. */
export class SqlVaultStore implements VaultStore {
  constructor(private readonly db: PrismaClient | (() => PrismaClient), private readonly now = Date.now) {}
  async transaction<T>(identity: VaultIdentity, run: (tx: VaultTransaction) => Promise<T>): Promise<T> {
    const database = typeof this.db === 'function' ? this.db() : this.db
    return database.$transaction(async db => {
      const authority = await readAuthority(db, identity, this.now())
      return run(new SqlVaultTransaction(db, identity, authority, this.now))
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 500, timeout: 2500 })
  }
}
async function readAuthority(db: Tx, identity: VaultIdentity, now: number): Promise<VaultAuthority> {
  const { userId, tenantId } = identity
  const tenants = await db.$queryRaw<Array<{ active: boolean }>>`SELECT active FROM tenants WHERE id=${tenantId} FOR SHARE`
  const users = await db.$queryRaw<UserState[]>`SELECT active, deleted_at AS deletedAt, session_version AS version, role, email,
    password_hash AS passwordHash, mfa_secret AS mfaSecret, mfa_enabled AS mfaEnabled,
    force_password_change AS forcePasswordChange, locked_until AS lockedUntil FROM users WHERE id=${userId} AND tenant_id=${tenantId} FOR UPDATE`
  const u = users[0]
  if (!truth(tenants[0]?.active) || !u || !truth(u.active) || u.deletedAt || u.version !== identity.sessionVersion) denied()
  // Every method needs NodeAccess TOTP; a local password is required only by the local step-up adapter.
  if (!u.mfaSecret || !truth(u.mfaEnabled) || truth(u.forcePasswordChange) || (u.lockedUntil && u.lockedUntil.getTime() > now)) denied()
  const auth = await db.$queryRaw<Array<{ local: boolean; sso: boolean }>>`SELECT local_login_enabled AS local, sso_required AS sso FROM tenant_auth_policies WHERE tenant_id=${tenantId} FOR SHARE`
  // Mirrors TenantAuthPolicyService.canRefreshSession without break-glass: SSO-required tenants keep only provider methods.
  const row = auth[0], sso = row ? truth(row.sso) : false, local = row ? truth(row.local) && !sso : true
  const methods = { local, ldap: !sso, oidc: true, google: true }
  const trials = await db.$queryRaw<Array<{ id: number }>>`SELECT id FROM trial_registrations WHERE tenant_id=${tenantId} FOR SHARE`
  if (trials.length) denied() // Trial rollout is a separate capability gate.
  const licenses = await db.$queryRaw<Array<{ features: unknown; active: boolean; expiresAt: Date | null }>>`SELECT feature_entitlements_json AS features,active,expires_at AS expiresAt FROM licenses WHERE tenant_id=${tenantId} FOR SHARE`
  const license = licenses[0]
  if (!license || !truth(license.active) || (license.expiresAt && license.expiresAt.getTime() <= now)
    || json<Record<string, unknown>>(license.features ?? {}).secrets !== true) denied()
  const policies = await db.$queryRaw<Array<{ version: number; config: unknown }>>`SELECT version, config FROM vault_policies WHERE tenant_id=${tenantId} FOR SHARE`
  const policy = { ...json<Omit<VaultPolicy, 'version'>>(policies[0]?.config ?? {}), version: policies[0]?.version ?? 0 }
  assertPolicy(policy)
  return { policy, validUntil: license.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER, role: u.role, email: u.email, methods, passwordHash: u.passwordHash, mfaSecret: u.mfaSecret,
    credentialVersion: hash(JSON.stringify([u.passwordHash, u.mfaSecret, u.version])) }
}
class SqlVaultTransaction implements VaultTransaction {
  readonly extension: SqlVaultExtension
  readonly administration: SqlVaultAdministration
  constructor(private readonly db: Tx, private readonly identity: VaultIdentity, readonly authority: VaultAuthority, readonly now: () => number) {
    this.extension = new SqlVaultExtension(db, identity, now)
    this.administration = new SqlVaultAdministration(db, identity, now)
  }
  async get<T>(kind: RecordKind, token: string): Promise<T | null> {
    const rows = await this.db.$queryRaw<Array<{ payload: unknown }>>`SELECT payload FROM vault_records WHERE tenant_id=${this.identity.tenantId}
      AND user_id=${this.identity.userId} AND kind=${kind} AND token_hash=${hash(token)} FOR UPDATE`
    return rows[0] ? json<T>(rows[0].payload) : null
  }
  async put(kind: RecordKind, token: string, value: object, expiresAt: number): Promise<void> {
    if (kind === 'operation' && (value as { state?: string }).state === 'AUTHORIZED') {
      const pending = await this.db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM vault_records WHERE tenant_id=${this.identity.tenantId}
        AND user_id=${this.identity.userId} AND kind='operation' AND expires_at > ${new Date(this.now())}
        AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.state'))='AUTHORIZED'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.clientId'))=${(value as { clientId: string }).clientId}`
      if (Number(pending[0]?.count ?? 0) >= 5) throw new VaultError('VAULT_RATE_LIMIT', 429)
    }
    await this.db.$executeRaw`INSERT INTO vault_records(tenant_id,user_id,kind,token_hash,payload,expires_at)
      VALUES(${this.identity.tenantId},${this.identity.userId},${kind},${hash(token)},${JSON.stringify(value)},${new Date(expiresAt)})
      ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`
  }
  async remove(kind: RecordKind, token: string): Promise<void> {
    await this.db.$executeRaw`DELETE FROM vault_records WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND kind=${kind} AND token_hash=${hash(token)}`
  }
  async limit(key: string, windowMs: number, max: number): Promise<void> {
    const bucket = hash(key.startsWith('tenant:') ? key : `${this.identity.userId}:${key}`)
    const start = Math.floor(this.now() / windowMs) * windowMs
    await this.db.$executeRaw`INSERT INTO vault_limits(tenant_id,bucket_hash,window_start,count) VALUES(${this.identity.tenantId},${bucket},${start},1)
      ON DUPLICATE KEY UPDATE count=IF(window_start=${start},count+1,1),window_start=${start}`
    const rows = await this.db.$queryRaw<Array<{ count: number }>>`SELECT count FROM vault_limits WHERE tenant_id=${this.identity.tenantId} AND bucket_hash=${bucket} FOR UPDATE`
    if ((rows[0]?.count ?? max + 1) > max) throw new VaultError('VAULT_RATE_LIMIT', 429)
  }
  async secret(id: number, action: VaultAction): Promise<VaultSecret> {
    if (this.authority.policy[action] !== true) denied()
    const grants = await this.db.$queryRaw<Array<{ enabled: boolean; grantedBy: number; approvedBy: number }>>`SELECT enabled,granted_by AS grantedBy,approved_by AS approvedBy
      FROM vault_entitlements WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND action=${action} FOR SHARE`
    const g = grants[0]
    if (!g || !truth(g.enabled) || g.grantedBy === g.approvedBy || g.grantedBy === this.identity.userId || g.approvedBy === this.identity.userId) denied()
    const rows = await this.db.$queryRaw<Array<{ encrypted: string; iv: string; scope: string; owner: number | null; groupId: number | null; revokedAt: Date | null }>>`SELECT encrypted_value AS encrypted,iv,scope,owner_user_id AS owner,group_id AS groupId,revoked_at AS revokedAt
      FROM secrets WHERE id=${id} AND tenant_id=${this.identity.tenantId} FOR SHARE`
    const s = rows[0]
    if (!s || s.revokedAt) denied()
    const eligible = await this.db.$queryRaw<Array<{ enabled: boolean }>>`SELECT enabled FROM vault_web_items WHERE tenant_id=${this.identity.tenantId} AND secret_id=${id} FOR SHARE`
    if (!truth(eligible[0]?.enabled)) denied()
    if (this.authority.role !== 'ADMIN' && s.owner !== this.identity.userId && s.scope !== 'TENANT') {
      if (s.groupId === null) denied()
      const membership = await this.db.$queryRaw<Array<{ userId: number }>>`SELECT user_id AS userId FROM user_groups WHERE user_id=${this.identity.userId} AND group_id=${s.groupId} FOR SHARE`
      if (!membership.length) denied()
    }
    return { encrypted: s.encrypted, iv: s.iv, version: hash(JSON.stringify([s.encrypted, s.iv, s.scope, s.owner, s.groupId, g.grantedBy, g.approvedBy])) }
  }
  async propose(id: string, change: VaultChange): Promise<void> {
    await new SqlVaultAdministration(this.db, this.identity, this.now).propose(id, change)
  }
  async approve(id: string, byReference = false): Promise<{ change: VaultChange; proposedBy: number }> {
    return new SqlVaultAdministration(this.db, this.identity, this.now).approve(id, byReference)
  }
  async audit(event: VaultEvent): Promise<void> {
    // Identifiers are hashes: no client/session capability, envelope or credential in the durable ledger.
    const { operationRef, ...rest } = event
    const metadata = { ...rest, clientId: event.clientId ? hash(event.clientId) : undefined,
      operationId: operationRef ?? (event.operationId ? hash(event.operationId) : undefined) }
    await this.db.$executeRaw`INSERT INTO vault_audit(event_id,tenant_id,user_id,event_type,metadata)
      VALUES(${randomUUID()},${this.identity.tenantId},${this.identity.userId},${event.type},${JSON.stringify(metadata)})`
  }
}
