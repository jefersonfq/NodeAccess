import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  VaultSiteCreateSchema, VaultSiteUpdateSchema, VaultSiteVersionSchema, VaultSiteDeliverySchema, VaultSiteListSchema,
  type VaultSiteCreate, type VaultSiteUpdate, type VaultSiteVersion, type VaultSiteDelivery, type VaultSiteMetadata,
} from '@nodeaccess/shared'
import { encrypt } from '../../shared/crypto.js'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { VaultIdentity, VaultSecret } from './vault-domain.js'

export interface VaultSitesAccess {
  channel: 'portal' | 'extension'
  /** Main reads and locks the grant in this same authorized transaction. */
  sharedWrite: boolean
  visibleHost(db: Prisma.TransactionClient, identity: VaultIdentity, hostId: number): Promise<{ id: number; name: string } | null>
}
interface SiteRow {
  id: number; tenantId: number; kind: 'login' | 'url'; label: string; scope: 'PERSONAL' | 'GROUP' | 'TENANT'
  ownerUserId: number | null; groupId: number | null; createdByUserId: number
  username: string | null; origins: string[] | string; url: string | null; hostId: number | null
  allowFill: boolean | number | bigint; version: number; revokedAt: Date | null; deletedAt: Date | null
}
const metadataColumns = Prisma.sql`s.id,s.tenant_id AS tenantId,s.kind,s.label,s.scope,s.owner_user_id AS ownerUserId,
  s.group_id AS groupId,s.created_by_user_id AS createdByUserId,s.username,s.origins,s.url,s.host_id AS hostId,
  s.allow_fill AS allowFill,s.version,s.revoked_at AS revokedAt,s.deleted_at AS deletedAt`
const enabled = (value: unknown): boolean => value === true || value === 1 || value === 1n
const conflict = (): never => { throw new AppError('Item alterado ou indisponível; atualize a lista', 409, 'VAULT_SITE_CONFLICT') }
const originList = (row: SiteRow): string[] => typeof row.origins === 'string' ? JSON.parse(row.origins) as string[] : row.origins

/** Construct only inside the existing authorized vault transaction (license, active user, session, device).
 * Never pass a root PrismaClient. Do not catch an audit error and commit the caller's transaction.
 * No network response or credential delivery may escape before that transaction commits.
 */
export class SqlVaultSites {
  constructor(private readonly db: Prisma.TransactionClient, private readonly identity: VaultIdentity,
    private readonly role: 'admin' | 'user', private readonly access: VaultSitesAccess) {}

  private acl(): Prisma.Sql {
    return Prisma.sql`(${this.role === 'admin'} OR s.owner_user_id=${this.identity.userId} OR s.scope='TENANT'
      OR (s.scope='GROUP' AND EXISTS(SELECT 1 FROM user_groups ug JOIN \`groups\` g ON g.id=ug.group_id
        WHERE ug.user_id=${this.identity.userId} AND ug.group_id=s.group_id AND g.tenant_id=${this.identity.tenantId})))`
  }
  private canManage(row: SiteRow): boolean {
    return this.role === 'admin' || row.ownerUserId === this.identity.userId ||
      (row.scope === 'GROUP' && row.createdByUserId === this.identity.userId)
  }
  private writing(scope: SiteRow['scope']): void {
    if (this.access.channel === 'extension' && scope !== 'PERSONAL' && !this.access.sharedWrite) throw new ForbiddenError()
  }
  private async member(groupId: number): Promise<void> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>`SELECT g.id FROM user_groups ug JOIN \`groups\` g ON g.id=ug.group_id
      WHERE g.tenant_id=${this.identity.tenantId} AND ug.group_id=${groupId} AND ug.user_id=${this.identity.userId} FOR SHARE`
    if (!rows.length) throw new NotFoundError('Item')
  }
  private async row(id: number): Promise<SiteRow> {
    const rows = await this.db.$queryRaw<SiteRow[]>(Prisma.sql`SELECT ${metadataColumns} FROM vault_site_items s
      WHERE s.tenant_id=${this.identity.tenantId} AND s.id=${id} AND s.deleted_at IS NULL AND ${this.acl()} FOR UPDATE`)
    if (!rows[0]) throw new NotFoundError('Item')
    // A locking clause on the outer SELECT does not lock a membership subquery.
    if (rows[0].scope === 'GROUP' && this.role !== 'admin') await this.member(rows[0].groupId!)
    return rows[0]
  }
  private async managed(input: VaultSiteVersion, allowRevoked = false): Promise<SiteRow> {
    const row = await this.row(input.id)
    if (!this.canManage(row)) throw new ForbiddenError()
    this.writing(row.scope)
    if (row.version !== input.version || (!allowRevoked && row.revokedAt !== null)) conflict()
    return row
  }
  private async host(hostId: number | null | undefined): Promise<void> {
    if (hostId != null && !await this.access.visibleHost(this.db, this.identity, hostId)) throw new NotFoundError('Host')
  }
  private async audit(action: string, id: number, version: number): Promise<void> {
    // Deliberately exclude labels, origins, usernames, passwords and ciphertext.
    const metadata = JSON.stringify({ siteId: id, version, channel: this.access.channel })
    await this.db.$executeRaw`INSERT INTO vault_audit(event_id,tenant_id,user_id,event_type,metadata)
      VALUES(${randomUUID()},${this.identity.tenantId},${this.identity.userId},${action},${metadata})`
  }
  private async metadata(row: SiteRow): Promise<VaultSiteMetadata> {
    const host = row.hostId === null ? null : await this.access.visibleHost(this.db, this.identity, row.hostId)
    return { id: row.id, version: row.version, kind: row.kind, label: row.label, scope: row.scope,
      groupId: row.groupId, username: row.username, origins: originList(row), url: row.url,
      host: host ? { id: host.id, name: host.name } : null,
      allowFill: enabled(row.allowFill), canManage: this.canManage(row) &&
        (this.access.channel === 'portal' || row.scope === 'PERSONAL' || this.access.sharedWrite) }
  }
  async list(raw: { origin?: string | undefined; q?: string | undefined; after?: number | undefined; limit?: number | undefined } = {}): Promise<{ items: VaultSiteMetadata[]; next: number | null }> {
    const input = VaultSiteListSchema.parse(raw)
    const origin = input.origin ? Prisma.sql`AND JSON_CONTAINS(s.origins,${JSON.stringify(input.origin)})` : Prisma.empty
    const query = input.q ? Prisma.sql`AND (INSTR(LOWER(s.label),LOWER(${input.q}))>0 OR INSTR(LOWER(COALESCE(s.username,'')),LOWER(${input.q}))>0)` : Prisma.empty
    const rows = await this.db.$queryRaw<SiteRow[]>(Prisma.sql`SELECT ${metadataColumns} FROM vault_site_items s
      WHERE s.tenant_id=${this.identity.tenantId} AND s.deleted_at IS NULL AND s.revoked_at IS NULL
      AND s.id>${input.after} AND ${this.acl()} ${origin} ${query} ORDER BY s.id LIMIT ${input.limit + 1}`)
    const page = rows.slice(0, input.limit)
    return { items: await Promise.all(page.map(row => this.metadata(row))),
      next: rows.length > input.limit ? page[page.length - 1]!.id : null }
  }
  async create(raw: VaultSiteCreate): Promise<VaultSiteVersion> {
    const input = VaultSiteCreateSchema.parse(raw)
    this.writing(input.scope)
    await this.host(input.hostId)
    if (input.scope === 'TENANT' && this.role !== 'admin') throw new ForbiddenError()
    if (input.scope === 'GROUP') {
      const groups = await this.db.$queryRaw<Array<{ id: number }>>`SELECT g.id FROM \`groups\` g
        WHERE g.id=${input.groupId} AND g.tenant_id=${this.identity.tenantId} AND
          (${this.role === 'admin'} OR EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=g.id AND ug.user_id=${this.identity.userId})) FOR SHARE`
      if (!groups.length) throw new NotFoundError('Grupo')
      if (this.role !== 'admin') await this.member(input.groupId!)
    }
    const payload = input.kind === 'login' ? encrypt(input.password) : null
    const origins = input.kind === 'login' ? input.origins : [new URL(input.url).origin]
    await this.db.$executeRaw`INSERT INTO vault_site_items(tenant_id,kind,label,scope,owner_user_id,group_id,created_by_user_id,
      username,origins,url,host_id,allow_fill,encrypted_value,iv) VALUES(${this.identity.tenantId},${input.kind},${input.label},${input.scope},
      ${input.scope === 'PERSONAL' ? this.identity.userId : null},${input.groupId ?? null},${this.identity.userId},
      ${input.kind === 'login' ? input.username : null},${JSON.stringify(origins)},${input.kind === 'url' ? input.url : null},
      ${input.hostId ?? null},${input.kind === 'login' && input.allowFill},${payload?.encrypted ?? null},${payload?.iv ?? null})`
    const ids = await this.db.$queryRaw<Array<{ id: bigint | number }>>`SELECT LAST_INSERT_ID() AS id`
    const id = Number(ids[0]!.id)
    await this.audit('site.created', id, 1)
    return { id, version: 1 }
  }
  async update(raw: VaultSiteUpdate): Promise<VaultSiteVersion> {
    const input = VaultSiteUpdateSchema.parse(raw)
    const row = await this.managed(input)
    await this.host(input.hostId)
    if ((row.kind === 'login' && input.url !== undefined) ||
      (row.kind === 'url' && [input.password, input.username, input.origins, input.allowFill].some(value => value !== undefined))) {
      throw new AppError('Campos incompatíveis com o tipo do item', 400, 'VAULT_SITE_KIND')
    }
    const updates: Prisma.Sql[] = [Prisma.sql`version=version+1`, Prisma.sql`updated_at=CURRENT_TIMESTAMP(3)`]
    if (input.label !== undefined) updates.push(Prisma.sql`label=${input.label}`)
    if (input.username !== undefined) updates.push(Prisma.sql`username=${input.username}`)
    if (input.hostId !== undefined) updates.push(Prisma.sql`host_id=${input.hostId}`)
    if (input.allowFill !== undefined) updates.push(Prisma.sql`allow_fill=${input.allowFill}`)
    if (input.origins !== undefined) updates.push(Prisma.sql`origins=${JSON.stringify(input.origins)}`)
    if (input.url !== undefined) updates.push(Prisma.sql`url=${input.url}`, Prisma.sql`origins=${JSON.stringify([new URL(input.url).origin])}`)
    if (input.password !== undefined) {
      const payload = encrypt(input.password)
      updates.push(Prisma.sql`encrypted_value=${payload.encrypted}`, Prisma.sql`iv=${payload.iv}`)
    }
    const count = await this.db.$executeRaw(Prisma.sql`UPDATE vault_site_items SET ${Prisma.join(updates)}
      WHERE tenant_id=${this.identity.tenantId} AND id=${input.id} AND version=${input.version} AND deleted_at IS NULL AND revoked_at IS NULL`)
    if (count !== 1) conflict()
    await this.audit('site.updated', input.id, input.version + 1)
    return { id: input.id, version: input.version + 1 }
  }
  async revoke(raw: VaultSiteVersion): Promise<VaultSiteVersion> { return this.remove(raw, false) }
  async delete(raw: VaultSiteVersion): Promise<VaultSiteVersion> { return this.remove(raw, true) }
  private async remove(raw: VaultSiteVersion, deleting: boolean): Promise<VaultSiteVersion> {
    const input = VaultSiteVersionSchema.parse(raw)
    await this.managed(input, deleting)
    const column = deleting ? Prisma.sql`deleted_at=CURRENT_TIMESTAMP(3)` : Prisma.sql`revoked_at=CURRENT_TIMESTAMP(3)`
    const count = await this.db.$executeRaw(Prisma.sql`UPDATE vault_site_items SET ${column},encrypted_value=NULL,iv=NULL,
      allow_fill=FALSE,version=version+1,updated_at=CURRENT_TIMESTAMP(3)
      WHERE tenant_id=${this.identity.tenantId} AND id=${input.id} AND version=${input.version} AND deleted_at IS NULL`)
    if (count !== 1) conflict()
    await this.audit(deleting ? 'site.deleted' : 'site.revoked', input.id, input.version + 1)
    return { id: input.id, version: input.version + 1 }
  }
  /** Only the E7 authorize/consume service calls this, after fill grant, fresh proof, kill switch and
   * single-use device/tab/frame/document binding checks in this same transaction. No reveal/copy API. */
  async delivery(raw: VaultSiteDelivery): Promise<{ secret: VaultSecret; username: string; origins: string[]; version: number }> {
    const input = VaultSiteDeliverySchema.parse(raw)
    const row = await this.row(input.id)
    if (row.kind !== 'login' || row.revokedAt !== null || row.version !== input.version || !enabled(row.allowFill) ||
      !originList(row).includes(input.origin)) throw new ForbiddenError()
    const rows = await this.db.$queryRaw<Array<{ encrypted: string; iv: string }>>`SELECT encrypted_value AS encrypted,iv FROM vault_site_items
      WHERE tenant_id=${this.identity.tenantId} AND id=${row.id} AND version=${row.version} AND revoked_at IS NULL AND deleted_at IS NULL AND allow_fill=TRUE`
    if (!rows[0]?.encrypted || !rows[0].iv) throw new ForbiddenError()
    await this.audit('site.delivery.checked', row.id, row.version)
    return { secret: { version: String(row.version), encrypted: rows[0].encrypted, iv: rows[0].iv },
      username: row.username!, origins: originList(row), version: row.version }
  }
}
export type VaultSites = Pick<SqlVaultSites, 'list' | 'create' | 'update' | 'revoke' | 'delete' | 'delivery'>
