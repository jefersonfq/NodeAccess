import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { denied, unavailable, type VaultChange, type VaultIdentity } from './vault-domain.js'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
/** Two separately authenticated managers; no implicit admin-role extraction grant. */
export class SqlVaultAdministration {
  constructor(private readonly db: Prisma.TransactionClient, private readonly actor: VaultIdentity, private readonly now: () => number) {}
  private async manager(userId: number): Promise<void> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>`SELECT u.id FROM vault_managers m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
      WHERE m.tenant_id=${this.actor.tenantId} AND m.user_id=${userId} AND m.enabled=TRUE AND u.active=TRUE AND u.deleted_at IS NULL FOR SHARE`
    if (!rows.length) denied()
  }
  async propose(id: string, change: VaultChange): Promise<void> {
    await this.manager(this.actor.userId)
    if (change.kind === 'grant' && change.userId === this.actor.userId) denied()
    await this.db.$executeRaw`INSERT INTO vault_proposals(tenant_id,proposal_hash,proposed_by,payload,expires_at)
      VALUES(${this.actor.tenantId},${hash(id)},${this.actor.userId},${JSON.stringify(change)},${new Date(this.now()+120_000)})`
  }
  async approve(id: string): Promise<{ change: VaultChange; proposedBy: number }> {
    await this.manager(this.actor.userId)
    const rows = await this.db.$queryRaw<Array<{ proposedBy: number; payload: unknown; expiresAt: Date }>>`SELECT proposed_by AS proposedBy,payload,expires_at AS expiresAt
      FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposal_hash=${hash(id)} FOR UPDATE`
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
    await this.db.$executeRaw`DELETE FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposal_hash=${hash(id)}`
    return { change, proposedBy: p.proposedBy }
  }
}
