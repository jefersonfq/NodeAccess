import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { denied, unavailable, type VaultChange, type VaultIdentity } from './vault-domain.js'
import type { AdministrationReads, VaultAdministrationOverview, VaultAdministrationUser } from './vault-ports.js'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
/** Two separately authenticated managers; no implicit admin-role extraction grant. */
export class SqlVaultAdministration implements AdministrationReads {
  constructor(private readonly db: Prisma.TransactionClient, private readonly actor: VaultIdentity, private readonly now: () => number) {}
  private async managing(userId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>`SELECT u.id FROM vault_managers m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
      WHERE m.tenant_id=${this.actor.tenantId} AND m.user_id=${userId} AND m.enabled=TRUE AND u.active=TRUE AND u.deleted_at IS NULL FOR SHARE`
    return rows.length > 0
  }
  private async manager(userId: number): Promise<void> {
    if (!await this.managing(userId)) denied()
  }
  isManager(): Promise<boolean> { return this.managing(this.actor.userId) }
  /** Managers only: tenant users with their grants and the live proposals (by stored hash; the original id is never kept). */
  async overview(): Promise<VaultAdministrationOverview> {
    await this.manager(this.actor.userId)
    const now = this.now()
    const users = await this.db.$queryRaw<Array<{ id: number; name: string; email: string }>>`SELECT id,name,email FROM users
      WHERE tenant_id=${this.actor.tenantId} AND active=TRUE AND deleted_at IS NULL ORDER BY name,id LIMIT 500`
    const grants = await this.db.$queryRaw<Array<{ userId: number; action: string; enabled: unknown }>>`SELECT user_id AS userId,action,enabled
      FROM vault_entitlements WHERE tenant_id=${this.actor.tenantId}`
    const proposals = await this.db.$queryRaw<Array<{ reference: string; proposedBy: number; name: string | null; payload: unknown; expiresAt: Date
      beneficiaryId: number | null; beneficiaryName: string | null; beneficiaryEmail: string | null }>>`SELECT p.proposal_hash AS reference,
      p.proposed_by AS proposedBy,u.name,p.payload,p.expires_at AS expiresAt,b.id AS beneficiaryId,b.name AS beneficiaryName,b.email AS beneficiaryEmail
      FROM vault_proposals p LEFT JOIN users u ON u.id=p.proposed_by AND u.tenant_id=p.tenant_id
      LEFT JOIN users b ON b.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.userId')) AS UNSIGNED) AND b.tenant_id=p.tenant_id
      WHERE p.tenant_id=${this.actor.tenantId} AND p.expires_at > ${new Date(now)} ORDER BY p.expires_at LIMIT 50`
    const byUser = new Map<number, VaultAdministrationUser>(users.map(u => [u.id, { id: u.id, name: u.name, email: u.email, grants: { reveal: false, copy: false, extension: false } }]))
    for (const g of grants) {
      const user = byUser.get(g.userId)
      if (user && (g.action === 'reveal' || g.action === 'copy' || g.action === 'extension')) user.grants[g.action] = g.enabled === true || g.enabled === 1 || g.enabled === 1n
    }
    return { users: [...byUser.values()], serverNow: now, proposals: proposals.map(p => ({ reference: p.reference, proposedBy: { id: p.proposedBy, name: p.name ?? '' },
      mine: p.proposedBy === this.actor.userId, expiresAt: p.expiresAt.getTime(),
      beneficiary: p.beneficiaryId === null ? null : { id: p.beneficiaryId, name: p.beneficiaryName ?? '', email: p.beneficiaryEmail ?? '' },
      change: (typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload) as VaultChange })) }
  }
  async propose(id: string, change: VaultChange): Promise<void> {
    await this.manager(this.actor.userId)
    if (change.kind === 'grant' && change.userId === this.actor.userId) denied()
    await this.db.$executeRaw`INSERT INTO vault_proposals(tenant_id,proposal_hash,proposed_by,payload,expires_at)
      VALUES(${this.actor.tenantId},${hash(id)},${this.actor.userId},${JSON.stringify(change)},${new Date(this.now()+120_000)})`
  }
  async approve(id: string, byReference = false): Promise<{ change: VaultChange; proposedBy: number }> {
    await this.manager(this.actor.userId)
    const key = byReference ? id : hash(id)
    const rows = await this.db.$queryRaw<Array<{ proposedBy: number; payload: unknown; expiresAt: Date }>>`SELECT proposed_by AS proposedBy,payload,expires_at AS expiresAt
      FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposal_hash=${key} FOR UPDATE`
    const p = rows[0]
    if (!p || p.expiresAt.getTime() <= this.now() || p.proposedBy === this.actor.userId) unavailable()
    await this.manager(p.proposedBy)
    const change = (typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload) as VaultChange
    if (change.kind === 'grant') {
      if (change.userId === p.proposedBy || change.userId === this.actor.userId) denied()
      const users = await this.db.$queryRaw<Array<{ id: number }>>`SELECT id FROM users WHERE id=${change.userId} AND tenant_id=${this.actor.tenantId} AND active=TRUE AND deleted_at IS NULL FOR SHARE`
      if (!users.length) denied()
      await this.db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled)
        VALUES(${this.actor.tenantId},${change.userId},${change.action},${p.proposedBy},${this.actor.userId},${change.enabled})
        ON DUPLICATE KEY UPDATE granted_by=VALUES(granted_by),approved_by=VALUES(approved_by),enabled=VALUES(enabled)`
      if (change.action === 'extension' && !change.enabled) {
        // NA-0183: removing the permission revokes every device and authorization of that user at once.
        await this.db.$executeRaw`UPDATE vault_extension_devices SET state='REVOKED',revoked_at=${new Date(this.now())}
          WHERE tenant_id=${this.actor.tenantId} AND user_id=${change.userId} AND state='ACTIVE'`
        await this.db.$executeRaw`DELETE FROM vault_extension_tokens WHERE tenant_id=${this.actor.tenantId} AND user_id=${change.userId}`
      }
    } else if (change.kind === 'item') {
      const items = await this.db.$queryRaw<Array<{ id: number }>>`SELECT id FROM secrets WHERE id=${change.secretId} AND tenant_id=${this.actor.tenantId} AND revoked_at IS NULL FOR SHARE`
      if (!items.length) denied()
      await this.db.$executeRaw`INSERT INTO vault_web_items(tenant_id,secret_id,enabled) VALUES(${this.actor.tenantId},${change.secretId},${change.enabled}) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`
    } else if (change.kind === 'policy') {
      await this.db.$executeRaw`UPDATE vault_policies SET config=JSON_SET(config,'$.reveal',CAST(${JSON.stringify(change.reveal)} AS JSON),'$.copy',CAST(${JSON.stringify(change.copy)} AS JSON),'$.tenantQuota',${change.tenantQuota}) WHERE tenant_id=${this.actor.tenantId}`
    } else denied()
    // Every administrative change invalidates ALL older sessions/grants, including disable/re-enable.
    await this.db.$executeRaw`UPDATE vault_policies SET version=version+1 WHERE tenant_id=${this.actor.tenantId}`
    await this.db.$executeRaw`DELETE FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposal_hash=${key}`
    return { change, proposedBy: p.proposedBy }
  }
}
