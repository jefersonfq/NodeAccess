import type { Prisma, PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import type { VaultIdentity } from './vault-domain.js'
import type { ExtensionAccess, ExtensionCode, ExtensionDeviceRow, ExtensionLocator, ExtensionRecords, ExtensionTokenKind } from './vault-extension-domain.js'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const truth = (x: unknown): boolean => x === true || x === 1 || x === 1n
function json<T>(x: unknown): T { return (typeof x === 'string' ? JSON.parse(x) : x) as T }
interface DeviceSql { jkt: string; extensionId: string; state: string; createdAt: Date; lastUsedAt: Date | null }
const toDevice = (d: DeviceSql): ExtensionDeviceRow => ({ jkt: d.jkt, extensionId: d.extensionId, state: d.state === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
  createdAt: d.createdAt.getTime(), lastUsedAt: d.lastUsedAt?.getTime() ?? null })

/** Extension rows inside the vault transaction; every statement is scoped to the transaction identity. */
export class SqlVaultExtension implements ExtensionRecords {
  constructor(private readonly db: Prisma.TransactionClient, private readonly identity: VaultIdentity, private readonly now: () => number) {}
  async entitled(): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ enabled: boolean; grantedBy: number; approvedBy: number }>>`SELECT enabled,granted_by AS grantedBy,approved_by AS approvedBy
      FROM vault_entitlements WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND action='extension' FOR SHARE`
    const g = rows[0]
    return !!g && truth(g.enabled) && g.grantedBy !== g.approvedBy && g.grantedBy !== this.identity.userId && g.approvedBy !== this.identity.userId
  }
  async device(jkt: string): Promise<ExtensionDeviceRow | null> {
    const rows = await this.db.$queryRaw<DeviceSql[]>`SELECT jkt,extension_id AS extensionId,state,created_at AS createdAt,last_used_at AS lastUsedAt
      FROM vault_extension_devices WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND jkt=${jkt} FOR UPDATE`
    return rows[0] ? toDevice(rows[0]) : null
  }
  async activateDevice(jkt: string, extensionId: string): Promise<void> {
    await this.db.$executeRaw`INSERT INTO vault_extension_devices(tenant_id,user_id,jkt,extension_id,state,created_at)
      VALUES(${this.identity.tenantId},${this.identity.userId},${jkt},${extensionId},'ACTIVE',${new Date(this.now())})
      ON DUPLICATE KEY UPDATE extension_id=VALUES(extension_id),state='ACTIVE',revoked_at=NULL`
  }
  async touchDevice(jkt: string): Promise<void> {
    await this.db.$executeRaw`UPDATE vault_extension_devices SET last_used_at=${new Date(this.now())}
      WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND jkt=${jkt}`
  }
  async revokeDevice(jkt: string): Promise<boolean> {
    const changed = await this.db.$executeRaw`UPDATE vault_extension_devices SET state='REVOKED',revoked_at=${new Date(this.now())}
      WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND jkt=${jkt} AND state='ACTIVE'`
    await this.db.$executeRaw`DELETE FROM vault_extension_tokens WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND jkt=${jkt}`
    return changed > 0
  }
  async devices(): Promise<ExtensionDeviceRow[]> {
    const rows = await this.db.$queryRaw<DeviceSql[]>`SELECT jkt,extension_id AS extensionId,state,created_at AS createdAt,last_used_at AS lastUsedAt
      FROM vault_extension_devices WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} ORDER BY created_at DESC LIMIT 50`
    return rows.map(toDevice)
  }
  async put(kind: ExtensionTokenKind, token: string, jkt: string, value: ExtensionCode | ExtensionAccess, expiresAt: number): Promise<void> {
    // Opportunistic cleanup, bounded to this user: expired codes and authorizations never accumulate.
    await this.db.$executeRaw`DELETE FROM vault_extension_tokens WHERE tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} AND expires_at <= ${new Date(this.now())}`
    await this.db.$executeRaw`INSERT INTO vault_extension_tokens(token_hash,kind,tenant_id,user_id,jkt,payload,expires_at)
      VALUES(${hash(token)},${kind},${this.identity.tenantId},${this.identity.userId},${jkt},${JSON.stringify(value)},${new Date(expiresAt)})`
  }
  async get<T extends ExtensionCode | ExtensionAccess>(kind: ExtensionTokenKind, token: string): Promise<{ jkt: string; value: T } | null> {
    const rows = await this.db.$queryRaw<Array<{ jkt: string; payload: unknown }>>`SELECT jkt,payload FROM vault_extension_tokens
      WHERE token_hash=${hash(token)} AND kind=${kind} AND tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} FOR SHARE`
    return rows[0] ? { jkt: rows[0].jkt, value: json<T>(rows[0].payload) } : null
  }
  async take<T extends ExtensionCode | ExtensionAccess>(kind: ExtensionTokenKind, token: string): Promise<{ jkt: string; value: T } | null> {
    const rows = await this.db.$queryRaw<Array<{ jkt: string; payload: unknown }>>`SELECT jkt,payload FROM vault_extension_tokens
      WHERE token_hash=${hash(token)} AND kind=${kind} AND tenant_id=${this.identity.tenantId} AND user_id=${this.identity.userId} FOR UPDATE`
    if (!rows[0]) return null
    await this.db.$executeRaw`DELETE FROM vault_extension_tokens WHERE token_hash=${hash(token)}`
    return { jkt: rows[0].jkt, value: json<T>(rows[0].payload) }
  }
}
/** Owner claimed by a public token; expired rows are ignored. Authorization happens later, under lock. */
export class SqlExtensionLocator implements ExtensionLocator {
  constructor(private readonly db: PrismaClient | (() => PrismaClient), private readonly now = Date.now) {}
  async locate(kind: ExtensionTokenKind, token: string): Promise<VaultIdentity | null> {
    const database = typeof this.db === 'function' ? this.db() : this.db
    const rows = await database.$queryRaw<Array<{ tenantId: number; userId: number; payload: unknown }>>`SELECT tenant_id AS tenantId,user_id AS userId,payload
      FROM vault_extension_tokens WHERE token_hash=${hash(token)} AND kind=${kind} AND expires_at > ${new Date(this.now())}`
    const row = rows[0]
    if (!row) return null
    const sessionVersion = json<{ sessionVersion?: unknown }>(row.payload).sessionVersion
    return typeof sessionVersion === 'number' && Number.isSafeInteger(sessionVersion) ? { tenantId: row.tenantId, userId: row.userId, sessionVersion } : null
  }
}
