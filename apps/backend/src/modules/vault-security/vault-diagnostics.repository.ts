import type { Prisma } from '@prisma/client'
import { SqlVaultAdministration } from './vault-administration.repository.js'
import { denied, type VaultAuthority, type VaultIdentity } from './vault-domain.js'
const truth = (v: unknown): boolean => v === true || v === 1 || v === 1n
interface Item { scope: string; owner: number | null; groupId: number | null; revokedAt: Date | null }
interface User { role: string; active: unknown; deletedAt: Date | null }
interface Grant { action: string; enabled: unknown; grantedBy: number; approvedBy: number }
export interface VaultDiagnosticsResult {
  kind: 'configuration'; userId: number; secretId: number
  user: { exists: true; active: boolean; deleted: boolean }
  policy: { reveal: boolean; copy: boolean }; grants: { reveal: boolean; copy: boolean }
  item: { released: boolean; revoked: boolean }; acl: boolean; runtime: 'not-evaluated'
}
/** Bound to the SAME connection/identity/authority as SqlVaultTransaction. Never opens a transaction.
 * Call only inside VaultService.confirmed/administer; this read does not authenticate a session.
 * ACL matches SqlVaultTransaction.secret, including owner/group fallback.
 */
export class SqlVaultDiagnostics {
  constructor(private readonly db: Prisma.TransactionClient, private readonly actor: VaultIdentity,
    private readonly authority: VaultAuthority, private readonly now: () => number) {}
  private async visible(item: Item, userId: number, role: string): Promise<boolean> {
    if (role === 'ADMIN' || item.owner === userId || item.scope === 'TENANT') return true
    if (item.groupId === null) return false
    const members = await this.db.$queryRaw<Array<{ userId: number }>>`SELECT user_id AS userId FROM user_groups
      WHERE user_id=${userId} AND group_id=${item.groupId} FOR SHARE`
    return members.length > 0
  }
  async diagnose(userId: number, secretId: number): Promise<VaultDiagnosticsResult> {
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(secretId) || secretId <= 0) denied()
    if (!await new SqlVaultAdministration(this.db, this.actor, this.now).isManager()) denied()
    const items = await this.db.$queryRaw<Item[]>`SELECT scope,owner_user_id AS owner,group_id AS groupId,revoked_at AS revokedAt
      FROM secrets WHERE id=${secretId} AND tenant_id=${this.actor.tenantId} FOR SHARE`
    const item = items[0]
    if (!item || !await this.visible(item, this.actor.userId, this.authority.role)) denied()
    const users = await this.db.$queryRaw<User[]>`SELECT role,active,deleted_at AS deletedAt FROM users
      WHERE id=${userId} AND tenant_id=${this.actor.tenantId} FOR SHARE`
    const user = users[0]
    // Missing/foreign targets and invisible items intentionally share the same denial.
    if (!user) denied()
    const grants = await this.db.$queryRaw<Grant[]>`SELECT action,enabled,granted_by AS grantedBy,approved_by AS approvedBy
      FROM vault_entitlements WHERE tenant_id=${this.actor.tenantId} AND user_id=${userId} AND action IN ('reveal','copy') FOR SHARE`
    const released = await this.db.$queryRaw<Array<{ enabled: unknown }>>`SELECT enabled FROM vault_web_items
      WHERE tenant_id=${this.actor.tenantId} AND secret_id=${secretId} FOR SHARE`
    const valid = (action: string): boolean => grants.some(g => g.action === action && truth(g.enabled)
      && g.grantedBy !== g.approvedBy && g.grantedBy !== userId && g.approvedBy !== userId)
    return { kind: 'configuration', userId, secretId,
      user: { exists: true, active: truth(user.active), deleted: user.deletedAt !== null },
      policy: { reveal: this.authority.policy.reveal === true, copy: this.authority.policy.copy === true },
      grants: { reveal: valid('reveal'), copy: valid('copy') },
      item: { released: truth(released[0]?.enabled), revoked: item.revokedAt !== null },
      acl: await this.visible(item, userId, user.role), runtime: 'not-evaluated' }
  }
}
