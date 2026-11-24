import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { denied, noApprover, PROPOSAL_DEFAULT_SECONDS, unavailable, validConfirmationSeconds, validProposalSeconds,
  type VaultChange, type VaultIdentity } from './vault-domain.js'
import type { AdministrationReads, VaultAdministrationOverview, VaultAdministrationUser } from './vault-ports.js'

const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
const parse = (payload: unknown): VaultChange => (typeof payload === 'string' ? JSON.parse(payload) : payload) as VaultChange
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
  /** NA-0188: enabled managers who are active tenant users (`lock` = FOR UPDATE on the manager rows only, for changes to the
   * manager set; the users rows keep the shared lock the authority read already took). */
  private async managerIds(lock = false): Promise<number[]> {
    const rows = lock
      ? await this.db.$queryRaw<Array<{ id: number }>>`SELECT u.id FROM vault_managers m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
        WHERE m.tenant_id=${this.actor.tenantId} AND m.enabled=TRUE AND u.active=TRUE AND u.deleted_at IS NULL FOR UPDATE OF m`
      : await this.db.$queryRaw<Array<{ id: number }>>`SELECT u.id FROM vault_managers m JOIN users u ON u.id=m.user_id AND u.tenant_id=m.tenant_id
        WHERE m.tenant_id=${this.actor.tenantId} AND m.enabled=TRUE AND u.active=TRUE AND u.deleted_at IS NULL FOR SHARE`
    return rows.map(r => Number(r.id))
  }
  /** NA-0188 status for managers: ids of the managers and how many live proposals this manager can approve (no vault session). */
  async summary(): Promise<{ manager: boolean; pending: number; managers: number[] }> {
    const managers = await this.managerIds()
    if (!managers.includes(this.actor.userId)) return { manager: false, pending: 0, managers: [] }
    const rows = await this.db.$queryRaw<Array<{ proposedBy: number; payload: unknown; itemId: number | null }>>`SELECT p.proposed_by AS proposedBy,p.payload,
      s.id AS itemId FROM vault_proposals p
      LEFT JOIN secrets s ON s.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.secretId')) AS UNSIGNED) AND s.tenant_id=p.tenant_id AND s.revoked_at IS NULL
      WHERE p.tenant_id=${this.actor.tenantId} AND p.expires_at > ${new Date(this.now())} AND p.proposed_by<>${this.actor.userId} LIMIT 50`
    const pending = rows.filter(p => {
      const change = parse(p.payload)
      // NA-0196: every kind is approved on screen (item and policy included), except item changes approval would refuse.
      if (change.kind === 'item' && (p.itemId === null || p.itemId === undefined)) return false
      return managers.includes(Number(p.proposedBy)) && !(('userId' in change) && change.userId === this.actor.userId)
    }).length
    return { manager: true, pending, managers }
  }
  /** NA-0188: refuse what could never be approved, before anyone waits for it. */
  private async assertApprovable(change: VaultChange, proposer: number): Promise<void> {
    const managers = await this.managerIds(change.kind === 'manager')
    const target = change.kind === 'grant' || change.kind === 'manager' ? change.userId : undefined
    if (!managers.some(id => id !== proposer && id !== target)) noApprover()
  }
  /** Managers only: tenant users with their grants and the live proposals (by stored hash; the original id is never kept). */
  async overview(): Promise<VaultAdministrationOverview> {
    await this.manager(this.actor.userId)
    const now = this.now()
    const users = await this.db.$queryRaw<Array<{ id: number; name: string; email: string }>>`SELECT id,name,email FROM users
      WHERE tenant_id=${this.actor.tenantId} AND active=TRUE AND deleted_at IS NULL ORDER BY name,id LIMIT 500`
    const grants = await this.db.$queryRaw<Array<{ userId: number; action: string; enabled: unknown }>>`SELECT user_id AS userId,action,enabled
      FROM vault_entitlements WHERE tenant_id=${this.actor.tenantId}`
    const proposals = await this.db.$queryRaw<Array<{ reference: string; proposedBy: number; name: string | null; payload: unknown; expiresAt: Date
      beneficiaryId: number | null; beneficiaryName: string | null; beneficiaryEmail: string | null; itemId: number | null; itemAlias: string | null }>>`SELECT p.proposal_hash AS reference,
      p.proposed_by AS proposedBy,u.name,p.payload,p.expires_at AS expiresAt,b.id AS beneficiaryId,b.name AS beneficiaryName,b.email AS beneficiaryEmail,
      s.id AS itemId,s.alias AS itemAlias
      FROM vault_proposals p LEFT JOIN users u ON u.id=p.proposed_by AND u.tenant_id=p.tenant_id
      LEFT JOIN secrets s ON s.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.secretId')) AS UNSIGNED) AND s.tenant_id=p.tenant_id AND s.revoked_at IS NULL
      LEFT JOIN users b ON b.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(p.payload,'$.userId')) AS UNSIGNED) AND b.tenant_id=p.tenant_id
        AND b.active=TRUE AND b.deleted_at IS NULL
      WHERE p.tenant_id=${this.actor.tenantId} AND p.expires_at > ${new Date(now)} ORDER BY p.expires_at LIMIT 50`
    const managers = await this.managerIds()
    const items = await this.db.$queryRaw<Array<{ id: number; alias: string }>>`SELECT s.id,s.alias FROM vault_web_items w
      JOIN secrets s ON s.id=w.secret_id AND s.tenant_id=w.tenant_id WHERE w.tenant_id=${this.actor.tenantId} AND w.enabled=TRUE AND s.revoked_at IS NULL
      ORDER BY s.alias,s.id LIMIT 1000`
    const byUser = new Map<number, VaultAdministrationUser>(users.map(u => [u.id, { id: u.id, name: u.name, email: u.email, manager: managers.includes(Number(u.id)),
      grants: { reveal: false, copy: false, extension: false } }]))
    for (const g of grants) {
      const user = byUser.get(g.userId)
      if (user && (g.action === 'reveal' || g.action === 'copy' || g.action === 'extension')) user.grants[g.action] = g.enabled === true || g.enabled === 1 || g.enabled === 1n
    }
    // NA-0188: hide what approval would refuse anyway — proposer no longer a manager, or an inactive/removed person to
    // grant or promote (with 24 h proposals this happens); removing a manager stays listed whatever their account state.
    const live = proposals.filter(p => {
      const change = parse(p.payload)
      return managers.includes(Number(p.proposedBy)) && !('userId' in change && p.beneficiaryId === null && !(change.kind === 'manager' && !change.enabled))
        // NA-0196: any item change for a Secret revoked or removed would be refused too.
        && !(change.kind === 'item' && p.itemId === null)
    })
    return { users: [...byUser.values()], serverNow: now, proposals: live.map(p => ({ reference: p.reference, proposedBy: { id: p.proposedBy, name: p.name ?? '' },
      mine: p.proposedBy === this.actor.userId, expiresAt: p.expiresAt.getTime(),
      beneficiary: p.beneficiaryId === null ? null : { id: p.beneficiaryId, name: p.beneficiaryName ?? '', email: p.beneficiaryEmail ?? '' },
      item: p.itemId === null ? null : { id: Number(p.itemId), alias: p.itemAlias ?? '' },
      change: parse(p.payload) })), items: items.map(i => ({ id: Number(i.id), alias: i.alias })) }
  }
  async propose(id: string, change: VaultChange, windowSeconds = PROPOSAL_DEFAULT_SECONDS): Promise<void> {
    await this.manager(this.actor.userId)
    if ((change.kind === 'grant' || change.kind === 'manager') && change.userId === this.actor.userId) denied()
    if (change.kind === 'confirmation' && !validConfirmationSeconds(change.seconds)) denied()
    if (change.kind === 'proposalWindow' && !validProposalSeconds(change.seconds)) denied()
    if (!validProposalSeconds(windowSeconds)) denied()
    await this.assertApprovable(change, this.actor.userId)
    await this.db.$executeRaw`INSERT INTO vault_proposals(tenant_id,proposal_hash,proposed_by,payload,expires_at)
      VALUES(${this.actor.tenantId},${hash(id)},${this.actor.userId},${JSON.stringify(change)},${new Date(this.now()+windowSeconds*1000)})`
  }
  async approve(id: string, byReference = false): Promise<{ change: VaultChange; proposedBy: number }> {
    await this.manager(this.actor.userId)
    const key = byReference ? id : hash(id)
    const rows = await this.db.$queryRaw<Array<{ proposedBy: number; payload: unknown; expiresAt: Date }>>`SELECT proposed_by AS proposedBy,payload,expires_at AS expiresAt
      FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposal_hash=${key} FOR UPDATE`
    const p = rows[0]
    if (!p || p.expiresAt.getTime() <= this.now() || p.proposedBy === this.actor.userId) unavailable()
    await this.manager(p.proposedBy)
    const change = parse(p.payload)
    if ((change.kind === 'grant' || change.kind === 'manager') && (change.userId === p.proposedBy || change.userId === this.actor.userId)) denied()
    // The approver is already a distinct manager, so this cannot refuse here; it takes the manager-set lock (FOR UPDATE OF m)
    // that serializes concurrent manager changes.
    await this.assertApprovable(change, p.proposedBy)
    if (change.kind === 'grant') {
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
    } else if (change.kind === 'manager') {
      const users = change.enabled
        ? await this.db.$queryRaw<Array<{ id: number }>>`SELECT id FROM users WHERE id=${change.userId} AND tenant_id=${this.actor.tenantId} AND active=TRUE AND deleted_at IS NULL FOR SHARE`
        : await this.db.$queryRaw<Array<{ id: number }>>`SELECT id FROM users WHERE id=${change.userId} AND tenant_id=${this.actor.tenantId} FOR SHARE`
      if (!users.length) denied()
      await this.db.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${this.actor.tenantId},${change.userId},${change.enabled})
        ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`
      // A removed manager's open proposals die with the role (re-adding later does not revive them).
      if (!change.enabled) await this.db.$executeRaw`DELETE FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposed_by=${change.userId}`
    } else if (change.kind === 'proposalWindow') {
      if (!validProposalSeconds(change.seconds)) denied()
      await this.db.$executeRaw`UPDATE vault_policies SET config=JSON_SET(config,'$.proposalSeconds',${change.seconds}) WHERE tenant_id=${this.actor.tenantId}`
      // Shortening the validity also shortens the proposals already open (never lengthens them).
      await this.db.$executeRaw`UPDATE vault_proposals SET expires_at=LEAST(expires_at,${new Date(this.now() + change.seconds * 1000)}) WHERE tenant_id=${this.actor.tenantId}`
    } else if (change.kind === 'confirmation') {
      if (!validConfirmationSeconds(change.seconds)) denied()
      await this.db.$executeRaw`UPDATE vault_policies SET config=JSON_SET(config,'$.confirmationSeconds',${change.seconds}) WHERE tenant_id=${this.actor.tenantId}`
    } else denied()
    // Every administrative change invalidates ALL older sessions/grants, including disable/re-enable.
    await this.db.$executeRaw`UPDATE vault_policies SET version=version+1 WHERE tenant_id=${this.actor.tenantId}`
    await this.db.$executeRaw`DELETE FROM vault_proposals WHERE tenant_id=${this.actor.tenantId} AND proposal_hash=${key}`
    return { change, proposedBy: p.proposedBy }
  }
}
