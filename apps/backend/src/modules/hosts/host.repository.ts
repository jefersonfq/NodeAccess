import { Prisma, type PrismaClient } from '@prisma/client'
import type { HostAssociatedLink } from '@nodeaccess/shared'
import type { TagRepository } from '../tags/tag.repository.js'

type HostConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'
type HostAccessProtocol = 'SSH' | 'RDP' | 'TELNET' | 'VNC' | 'SERIAL'

const activeHostWhere = { deletedAt: null } as const

export interface HostFilters {
  search?:  string
  scope?:   'PERSONAL' | 'TEAM' | 'GLOBAL'
  groupId?: number
  folderId?: number
  tagId?:   number
  unfiled?: boolean
  bastionId?: number | null
  pemKeyId?: number | null
  authType?: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  accessProtocol?: HostAccessProtocol
  connectionMode?: HostConnectionMode
  page?:    number
  limit?:   number
}

export interface HostDeleteBlockers {
  sessions: number
  sessionAudits: number
  mcpInteractiveSessions: number
}

export interface HostDeleteCheck {
  canDelete: boolean
  blockers: HostDeleteBlockers
}

export interface HostSidebarSummary {
  all: number
  global: number
  unfiled: number
  maxHosts: number | null
  folders: Record<number, number>
  groups: Record<number, number>
  tags: Record<number, number>
}

type HostAssociatedLinkRow = {
  id: number
  hostId: number
  label: string
  urlTemplate: string
  position: number
  enabled: boolean
  openMode: 'new_tab' | 'same_tab'
  sourceType: 'manual' | 'integration' | 'derived'
  sourceProvider: string | null
  sourceRef: string | null
  sourceStatus: 'manual' | 'synced' | 'stale' | 'error'
  sourceUpdatedAt: Date | null
}

type RawHostAssociatedLinkRow = Omit<HostAssociatedLinkRow, 'openMode' | 'sourceType' | 'sourceStatus'> & {
  openMode: string
  sourceType: string
  sourceStatus: string
}

export type HostAssociatedLinkCatalogRow = HostAssociatedLinkRow & {
  hostName: string
  hostIp: string
  hostPort: number
  hostSshUser: string
}

type HostAssociatedLinkRecord = HostAssociatedLink & {
  sourceType?: 'manual' | 'integration' | 'derived' | undefined
  sourceProvider?: string | null | undefined
  sourceRef?: string | null | undefined
  sourceStatus?: 'manual' | 'synced' | 'stale' | 'error' | undefined
  sourceUpdatedAt?: Date | null | undefined
}

function normalizeAssociatedLinkOpenMode(value: string): HostAssociatedLinkRecord['openMode'] {
  return value.toLowerCase() === 'same_tab' ? 'same_tab' : 'new_tab'
}

function normalizeAssociatedLinkSourceType(value: string): NonNullable<HostAssociatedLinkRecord['sourceType']> {
  const normalized = value.toLowerCase()
  return normalized === 'integration' || normalized === 'derived' ? normalized : 'manual'
}

function normalizeAssociatedLinkSourceStatus(value: string): NonNullable<HostAssociatedLinkRecord['sourceStatus']> {
  const normalized = value.toLowerCase()
  if (normalized === 'synced' || normalized === 'stale' || normalized === 'error') return normalized
  return 'manual'
}

function normalizeAssociatedLinkRow(row: RawHostAssociatedLinkRow): HostAssociatedLinkRecord {
  return {
    id: row.id,
    label: row.label,
    urlTemplate: row.urlTemplate,
    position: row.position,
    enabled: !!row.enabled,
    openMode: normalizeAssociatedLinkOpenMode(row.openMode),
    sourceType: normalizeAssociatedLinkSourceType(row.sourceType),
    sourceProvider: row.sourceProvider,
    sourceRef: row.sourceRef,
    sourceStatus: normalizeAssociatedLinkSourceStatus(row.sourceStatus),
    sourceUpdatedAt: row.sourceUpdatedAt,
  }
}

const hostInclude = {
  tags: { include: { tag: true } },
  bastion: { select: { id: true, name: true } },
  group: {
    select: {
      id: true,
      name: true,
      bastionId: true,
      bastion: { select: { id: true, name: true } },
    },
  },
} as const

export type HostRow = Prisma.HostGetPayload<{ include: typeof hostInclude }> & {
  description?: string | null
  privateAccessConnectorId?: number | null
}

export class HostRepository {
  constructor(
    private readonly db:      PrismaClient,
    private readonly tagRepo: TagRepository,
  ) {}

  async findVisible(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
    filters: HostFilters,
  ): Promise<{ hosts: HostRow[]; total: number }> {
    const { search, scope, groupId, folderId, tagId, unfiled, bastionId, pemKeyId, authType, accessProtocol, connectionMode, page = 1, limit = 20 } = filters
    const skip = (page - 1) * limit

    const visibilityFilter: Prisma.HostWhereInput =
      role === 'ADMIN'
        ? { tenantId, ...activeHostWhere }
        : {
            tenantId,
            ...activeHostWhere,
            OR: [
              { scope: 'PERSONAL', ownerId: userId },
              { scope: 'TEAM', groupId: { in: userGroupIds } },
              { scope: 'GLOBAL' },
            ],
          }

    const connectionModeFilter = connectionMode !== undefined
      ? ({ connectionMode } as unknown as Prisma.HostWhereInput)
      : {}

    const where: Prisma.HostWhereInput = {
      ...visibilityFilter,
      ...(scope   && { scope }),
      ...(groupId && { groupId }),
      ...(folderId !== undefined && { folderId }),
      ...(bastionId !== undefined && { bastionId }),
      ...(pemKeyId !== undefined && { pemKeyId }),
      ...(authType !== undefined && { authType }),
      ...(accessProtocol !== undefined && { accessProtocol }),
      ...connectionModeFilter,
      ...(unfiled === true && { folderId: null }),
      ...(tagId   && { tags: { some: { tagId } } }),
      ...(search  && {
        OR: [
          { name: { contains: search } },
          { ip:   { contains: search } },
        ],
      }),
    }

    const [hosts, total] = await this.db.$transaction([
      this.db.host.findMany({ where, include: hostInclude, skip, take: limit, orderBy: { name: 'asc' } }),
      this.db.host.count({ where }),
    ])

    return { hosts: await this.hydrateHostDescriptions(hosts), total }
  }

  async getSidebarSummary(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
  ): Promise<HostSidebarSummary> {
    const whereSql = this.buildVisibleHostsWhereSql(tenantId, userId, role, userGroupIds, 'h')

    const [totals, folderCounts, groupCounts, tagCounts] = await Promise.all([
      this.db.$queryRaw<Array<{ allCount: bigint | number; globalCount: bigint | number; unfiledCount: bigint | number }>>(Prisma.sql`
        SELECT
          COUNT(*) AS allCount,
          SUM(CASE WHEN h.scope = 'GLOBAL' THEN 1 ELSE 0 END) AS globalCount,
          SUM(CASE WHEN h.folder_id IS NULL THEN 1 ELSE 0 END) AS unfiledCount
        FROM hosts h
        WHERE ${whereSql}
      `),
      this.db.$queryRaw<Array<{ folderId: number; count: bigint | number }>>(Prisma.sql`
        SELECT h.folder_id AS folderId, COUNT(*) AS count
        FROM hosts h
        WHERE ${whereSql} AND h.folder_id IS NOT NULL
        GROUP BY h.folder_id
      `),
      this.db.$queryRaw<Array<{ groupId: number; count: bigint | number }>>(Prisma.sql`
        SELECT h.group_id AS groupId, COUNT(*) AS count
        FROM hosts h
        WHERE ${whereSql} AND h.group_id IS NOT NULL
        GROUP BY h.group_id
      `),
      this.db.$queryRaw<Array<{ tagId: number; count: bigint | number }>>(Prisma.sql`
        SELECT ht.tag_id AS tagId, COUNT(*) AS count
        FROM host_tags ht
        INNER JOIN hosts h ON h.id = ht.host_id
        WHERE ${whereSql}
        GROUP BY ht.tag_id
      `),
    ])

    return {
      all: Number(totals[0]?.allCount ?? 0),
      global: Number(totals[0]?.globalCount ?? 0),
      unfiled: Number(totals[0]?.unfiledCount ?? 0),
      maxHosts: null,
      folders: Object.fromEntries(folderCounts.map((row) => [row.folderId, Number(row.count)])),
      groups: Object.fromEntries(groupCounts.map((row) => [row.groupId, Number(row.count)])),
      tags: Object.fromEntries(tagCounts.map((row) => [row.tagId, Number(row.count)])),
    }
  }

  async findById(id: number, tenantId: number): Promise<HostRow | null> {
    const host = await this.db.host.findFirst({ where: { id, tenantId, ...activeHostWhere }, include: hostInclude })
    return host ? this.hydrateHostDescription(host) : null
  }

  async bastionExists(id: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) AS count
        FROM bastion_hosts
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `,
    )
    return Number(rows[0]?.count ?? 0) > 0
  }

  async pemKeyExists(id: number, tenantId: number): Promise<boolean> {
    const count = await this.db.pemKey.count({ where: { id, createdBy: { tenantId } } })
    return count > 0
  }

  async privateAccessConnectorExists(id: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM agents
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND active = 1
        AND agent_type = 'PRIVATE_ACCESS_CONNECTOR'
        AND agent_mode = 'SERVICE_BOUND'
    `)
    return Number(rows[0]?.count ?? 0) > 0
  }

  async findVisibleByIds(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
    ids: number[],
  ): Promise<HostRow[]> {
    if (ids.length === 0) return []

    const visibilityFilter: Prisma.HostWhereInput =
      role === 'ADMIN'
        ? { tenantId, ...activeHostWhere }
        : {
            tenantId,
            ...activeHostWhere,
            OR: [
              { scope: 'PERSONAL', ownerId: userId },
              { scope: 'TEAM', groupId: { in: userGroupIds } },
              { scope: 'GLOBAL' },
            ],
          }

    const hosts = await this.db.host.findMany({
      where: {
        ...visibilityFilter,
        id: { in: ids },
      },
      include: hostInclude,
    })
    return this.hydrateHostDescriptions(hosts)
  }

  async create(data: {
    name:              string
    description?:      string | null
    ip:                string
    port:              number
    sshUser:           string
    accessProtocol:    HostAccessProtocol
    authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    connectionMode:    HostConnectionMode
    privateAccessConnectorId?: number | null
    scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
    tenantId:          number
    ownerId?:          number
    groupId?:          number
    folderId?:         number
    onePasswordRef?:   string
    bastionId?:        number
    pemKeyId?:         number
    passwordEncrypted?: string
    tagNames?:         string[]
    associatedLinks?:  HostAssociatedLink[]
  }): Promise<HostRow> {
    const { tagNames, associatedLinks, ...hostData } = data

    // Upsert tags first (auto-commit, fora da tx principal)
    const tagIds = tagNames?.length
      ? (await this.tagRepo.upsertByNames(data.tenantId, tagNames)).map((t) => t.id)
      : []

    const hostId = await this.db.$transaction(async (tx) => {
      const { connectionMode, privateAccessConnectorId, description, ...prismaHostData } = hostData
      const host = await tx.host.create({ data: prismaHostData })
      if (description !== undefined) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE hosts SET description = ${description} WHERE id = ${host.id}`,
        )
      }
      await tx.$executeRaw(
        Prisma.sql`UPDATE hosts SET connection_mode = ${connectionMode} WHERE id = ${host.id}`,
      )
      if (privateAccessConnectorId !== undefined) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE hosts SET private_access_connector_id = ${privateAccessConnectorId} WHERE id = ${host.id}`,
        )
      }
      await this.tagRepo.syncHostTags(tx as unknown as PrismaClient, host.id, tagIds)
      if (associatedLinks !== undefined) {
        await this.syncAssociatedLinksTx(tx as unknown as PrismaClient, host.id, data.tenantId, associatedLinks)
      }
      return host.id
    })

    return this.hydrateHostDescription(await this.db.host.findUniqueOrThrow({ where: { id: hostId }, include: hostInclude }))
  }

  async update(
    id: number,
    tenantId: number,
    data: Partial<{
      name:              string
      description:       string | null
      ip:                string
      port:              number
      sshUser:           string
      accessProtocol:    HostAccessProtocol
      authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
      connectionMode:    HostConnectionMode
      privateAccessConnectorId: number | null
      scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
      groupId:           number | null
      folderId:          number | null
      onePasswordRef:    string | null
      bastionId:         number | null
      pemKeyId:          number | null
      passwordEncrypted: string | null
      tagNames:          string[]
      associatedLinks:   HostAssociatedLink[]
    }>,
  ): Promise<HostRow> {
    const { tagNames, associatedLinks, ...hostData } = data

    // Upsert tags first (auto-commit, fora da tx principal)
    let tagIds: number[] | undefined
    if (tagNames !== undefined) {
      tagIds = tagNames.length > 0
        ? (await this.tagRepo.upsertByNames(tenantId, tagNames)).map((t) => t.id)
        : []
    }

    await this.db.$transaction(async (tx) => {
      const { connectionMode, privateAccessConnectorId, description, ...prismaHostData } = hostData
      await tx.host.update({ where: { id }, data: prismaHostData })
      if (description !== undefined) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE hosts SET description = ${description} WHERE id = ${id}`,
        )
      }
      if (connectionMode !== undefined) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE hosts SET connection_mode = ${connectionMode} WHERE id = ${id}`,
        )
      }
      if (privateAccessConnectorId !== undefined) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE hosts SET private_access_connector_id = ${privateAccessConnectorId} WHERE id = ${id}`,
        )
      }
      if (tagIds !== undefined) {
        await this.tagRepo.syncHostTags(tx as unknown as PrismaClient, id, tagIds)
      }
      if (associatedLinks !== undefined) {
        await this.syncAssociatedLinksTx(tx as unknown as PrismaClient, id, tenantId, associatedLinks)
      }
    })

    // Leitura após commit — enxerga todos os dados consistentes
    return this.hydrateHostDescription(await this.db.host.findUniqueOrThrow({ where: { id }, include: hostInclude }))
  }

  async trustHostKey(
    id: number,
    tenantId: number,
    fingerprint: string,
    userId: number,
  ): Promise<HostRow> {
    await this.db.host.update({
      where: { id, tenantId },
      data: {
        trustedHostKeyFingerprint: fingerprint,
        trustedHostKeyVerifiedAt: new Date(),
        trustedHostKeyVerifiedBy: userId,
      },
    })

    return this.hydrateHostDescription(await this.db.host.findUniqueOrThrow({ where: { id }, include: hostInclude }))
  }

  async delete(id: number): Promise<void> {
    await this.db.host.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  async hasActiveSessions(id: number): Promise<boolean> {
    const count = await this.db.session.count({ where: { hostId: id, active: true } })
    return count > 0
  }

  async countActiveSessions(id: number): Promise<number> {
    return this.db.session.count({ where: { hostId: id, active: true } })
  }

  async getDeleteBlockers(id: number): Promise<HostDeleteBlockers> {
    const [sessions, sessionAudits, mcpInteractiveSessions] = await this.db.$transaction([
      this.db.session.count({ where: { hostId: id } }),
      this.db.sessionAudit.count({ where: { hostId: id } }),
      this.db.mcpInteractiveSshSession.count({ where: { hostId: id } }),
    ])

    return { sessions, sessionAudits, mcpInteractiveSessions }
  }

  async countByTenant(tenantId: number): Promise<number> {
    return this.db.host.count({ where: { tenantId, ...activeHostWhere } })
  }

  private async hydrateHostDescription<T extends { id: number }>(host: T): Promise<T & { description: string | null; privateAccessConnectorId: number | null }> {
    const rows = await this.db.$queryRaw<Array<{ id: number; description: string | null; privateAccessConnectorId: number | null }>>(Prisma.sql`
      SELECT id, description, private_access_connector_id AS privateAccessConnectorId
      FROM hosts
      WHERE id = ${host.id}
      LIMIT 1
    `)
    return {
      ...host,
      description: rows[0]?.description ?? null,
      privateAccessConnectorId: rows[0]?.privateAccessConnectorId ?? null,
    }
  }

  private async hydrateHostDescriptions<T extends { id: number }>(hosts: T[]): Promise<Array<T & { description: string | null; privateAccessConnectorId: number | null }>> {
    if (hosts.length === 0) return []
    const rows = await this.db.$queryRaw<Array<{ id: number; description: string | null; privateAccessConnectorId: number | null }>>(Prisma.sql`
      SELECT id, description, private_access_connector_id AS privateAccessConnectorId
      FROM hosts
      WHERE id IN (${Prisma.join(hosts.map((host) => host.id))})
    `)
    const metaByHostId = new Map(rows.map((row) => [row.id, row]))
    return hosts.map((host) => {
      const meta = metaByHostId.get(host.id)
      return {
        ...host,
        description: meta?.description ?? null,
        privateAccessConnectorId: meta?.privateAccessConnectorId ?? null,
      }
    })
  }

  private buildVisibleHostsWhereSql(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
    alias = 'h',
  ): Prisma.Sql {
    const groupVisibility = userGroupIds.length > 0
      ? Prisma.sql`${Prisma.raw(`${alias}.scope`)} = 'TEAM' AND ${Prisma.raw(`${alias}.group_id`)} IN (${Prisma.join(userGroupIds)})`
      : Prisma.sql`FALSE`

    return role === 'ADMIN'
      ? Prisma.sql`${Prisma.raw(`${alias}.tenant_id`)} = ${tenantId} AND ${Prisma.raw(`${alias}.deleted_at`)} IS NULL`
      : Prisma.sql`
          ${Prisma.raw(`${alias}.tenant_id`)} = ${tenantId}
          AND ${Prisma.raw(`${alias}.deleted_at`)} IS NULL
          AND (
            (${Prisma.raw(`${alias}.scope`)} = 'PERSONAL' AND ${Prisma.raw(`${alias}.owner_id`)} = ${userId})
            OR (${groupVisibility})
            OR ${Prisma.raw(`${alias}.scope`)} = 'GLOBAL'
          )
        `
  }

  async listAssociatedLinksByHostIds(hostIds: number[], tenantId: number): Promise<Map<number, HostAssociatedLinkRecord[]>> {
    const linksByHostId = new Map<number, HostAssociatedLinkRecord[]>()
    if (hostIds.length === 0) return linksByHostId

    const rows = await this.db.$queryRaw<RawHostAssociatedLinkRow[]>(Prisma.sql`
      SELECT
        id,
        host_id AS hostId,
        label,
        url_template AS urlTemplate,
        position,
        enabled,
        open_mode AS openMode,
        source_type AS sourceType,
        source_provider AS sourceProvider,
        source_ref AS sourceRef,
        source_status AS sourceStatus,
        source_updated_at AS sourceUpdatedAt
      FROM host_associated_links
      WHERE tenant_id = ${tenantId}
        AND host_id IN (${Prisma.join(hostIds)})
      ORDER BY host_id ASC, position ASC, id ASC
    `)

    for (const row of rows) {
      const current = linksByHostId.get(row.hostId) ?? []
      current.push(normalizeAssociatedLinkRow(row))
      linksByHostId.set(row.hostId, current)
    }

    return linksByHostId
  }

  async listVisibleAssociatedLinksCatalog(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
    limit = 500,
  ): Promise<HostAssociatedLinkCatalogRow[]> {
    const whereSql = this.buildVisibleHostsWhereSql(tenantId, userId, role, userGroupIds, 'h')

    const rows = await this.db.$queryRaw<Array<RawHostAssociatedLinkRow & {
      hostName: string
      hostIp: string
      hostPort: number
      hostSshUser: string
    }>>(Prisma.sql`
      SELECT
        hal.id,
        hal.host_id AS hostId,
        h.name AS hostName,
        h.ip AS hostIp,
        h.port AS hostPort,
        h.ssh_user AS hostSshUser,
        hal.label,
        hal.url_template AS urlTemplate,
        hal.position,
        hal.enabled,
        hal.open_mode AS openMode,
        hal.source_type AS sourceType,
        hal.source_provider AS sourceProvider,
        hal.source_ref AS sourceRef,
        hal.source_status AS sourceStatus,
        hal.source_updated_at AS sourceUpdatedAt
      FROM host_associated_links hal
      INNER JOIN hosts h ON h.id = hal.host_id
      WHERE hal.tenant_id = ${tenantId}
        AND hal.enabled = TRUE
        AND ${whereSql}
      ORDER BY h.name ASC, hal.position ASC, hal.id ASC
      LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}
    `)
    return rows.map((row) => {
      const link = normalizeAssociatedLinkRow(row)
      return {
        id: row.id,
        hostId: row.hostId,
        label: row.label,
        urlTemplate: row.urlTemplate,
        position: row.position,
        enabled: !!row.enabled,
        openMode: link.openMode,
        sourceType: link.sourceType ?? 'manual',
        sourceProvider: row.sourceProvider,
        sourceRef: row.sourceRef,
        sourceStatus: link.sourceStatus ?? 'manual',
        sourceUpdatedAt: row.sourceUpdatedAt,
        hostName: row.hostName,
        hostIp: row.hostIp,
        hostPort: row.hostPort,
        hostSshUser: row.hostSshUser,
      }
    })
  }

  async findHostLicenseLimit(tenantId: number): Promise<number | null> {
    try {
      const rows = await this.db.$queryRaw<Array<{ maxHosts: number | null }>>(Prisma.sql`
        SELECT max_hosts AS maxHosts
        FROM licenses
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `)
      return rows[0]?.maxHosts ?? null
    } catch {
      return null
    }
  }

  private async syncAssociatedLinksTx(
    db: PrismaClient,
    hostId: number,
    tenantId: number,
    links: HostAssociatedLinkRecord[],
  ): Promise<void> {
    await db.$executeRaw(Prisma.sql`
      DELETE FROM host_associated_links
      WHERE tenant_id = ${tenantId}
        AND host_id = ${hostId}
    `)

    if (links.length === 0) return

    for (const [index, link] of links.entries()) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO host_associated_links (
          tenant_id,
          host_id,
          label,
          url_template,
          position,
          enabled,
          open_mode,
          source_type,
          source_provider,
          source_ref,
          source_status,
          source_updated_at
        ) VALUES (
          ${tenantId},
          ${hostId},
          ${link.label},
          ${link.urlTemplate},
          ${link.position ?? index},
          ${link.enabled},
          ${link.openMode.toUpperCase()},
          ${(link.sourceType ?? 'manual').toUpperCase()},
          ${link.sourceProvider ?? null},
          ${link.sourceRef ?? null},
          ${(link.sourceStatus ?? (link.sourceType === 'manual' || !link.sourceType ? 'manual' : 'synced')).toUpperCase()},
          ${link.sourceUpdatedAt ?? null}
        )
      `)
    }
  }
}
