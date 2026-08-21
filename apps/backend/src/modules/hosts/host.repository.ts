import { Prisma, type PrismaClient } from '@prisma/client'
import type { HostAssociatedLink } from '@nodeaccess/shared'
import type { TagRepository } from '../tags/tag.repository.js'

type HostConnectionMode = 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'PRIVATE_ACCESS_CONNECTOR' | 'AUTO'
type HostAccessProtocol = 'SSH' | 'RDP' | 'TELNET' | 'VNC' | 'SERIAL'
type HostOperatingSystem = 'UNKNOWN' | 'LINUX' | 'UBUNTU' | 'DEBIAN' | 'CENTOS' | 'RHEL' | 'ROCKY' | 'ALMALINUX' | 'SUSE' | 'WINDOWS' | 'WINDOWS_SERVER' | 'MACOS' | 'FREEBSD' | 'OTHER'

const activeHostWhere = { deletedAt: null } as const

export interface HostFilters {
  search?:  string
  scope?:   'PERSONAL' | 'TEAM' | 'GLOBAL'
  groupId?: number
  folderId?: number
  inventoryNodeId?: number
  tagId?:   number
  unfiled?: boolean
  bastionId?: number | null
  pemKeyId?: number | null
  authType?: 'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
  accessProtocol?: HostAccessProtocol
  operatingSystem?: HostOperatingSystem
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

export interface HostImportDuplicateCandidate {
  id: number
  name: string
  ip: string
  port: number
  sshUser: string | null
  accessProtocol: HostAccessProtocol
  inventoryParentId: number | null
  connectionMode: 'direct' | 'agent' | 'agent_user' | 'agent_tenant_fallback' | 'private_access_connector' | 'auto'
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
  inventoryNode: {
    select: {
      id: true,
      parentId: true,
      parent: { select: { id: true, name: true, type: true } },
    },
  },
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

  async findImportDuplicates(
    tenantId: number,
    endpoints: Array<{ ip: string; port: number; sshUser: string; accessProtocol: HostAccessProtocol }>,
  ): Promise<HostImportDuplicateCandidate[]> {
    if (!endpoints.length) return []
    const unique = new Map(endpoints.map(endpoint => [
      `${endpoint.accessProtocol}|${endpoint.ip.trim().toLowerCase()}|${endpoint.port}|${endpoint.sshUser.trim().toLowerCase()}`,
      endpoint,
    ]))
    const values = [...unique.values()]
    const result: HostImportDuplicateCandidate[] = []
    for (let offset = 0; offset < values.length; offset += 250) {
      const chunk = values.slice(offset, offset + 250)
      const rows = await this.db.host.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: chunk.map(endpoint => ({
            ip: endpoint.ip,
            port: endpoint.port,
            sshUser: endpoint.sshUser,
            accessProtocol: endpoint.accessProtocol,
          })),
        },
        select: {
          id: true, name: true, ip: true, port: true, sshUser: true, accessProtocol: true, connectionMode: true,
          inventoryNode: { select: { parentId: true } },
        },
      })
      result.push(...rows.map(({ inventoryNode, connectionMode, ...row }) => ({
        ...row,
        connectionMode: connectionMode.toLowerCase() as HostImportDuplicateCandidate['connectionMode'],
        inventoryParentId: inventoryNode?.parentId ?? null,
      })))
    }
    return result
  }

  async findVisible(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    filters: HostFilters,
  ): Promise<{ hosts: HostRow[]; total: number }> {
    const { search, scope, groupId, folderId, inventoryNodeId, tagId, unfiled, bastionId, pemKeyId, authType, accessProtocol, operatingSystem, connectionMode, page = 1, limit = 20 } = filters
    const skip = (page - 1) * limit
    const visibleHostIds = role === 'ADMIN'
      ? null
      : await this.findVisibleHostIds(tenantId, userId, role)
    const inventoryHostIds = inventoryNodeId === undefined
      ? null
      : await this.findHostIdsInInventorySubtree(tenantId, inventoryNodeId)
    if (visibleHostIds !== null && visibleHostIds.length === 0) {
      return { hosts: [], total: 0 }
    }
    if (inventoryHostIds !== null && inventoryHostIds.length === 0) {
      return { hosts: [], total: 0 }
    }
    const personalFolderHostIds = folderId !== undefined
      ? await this.findPersonalFolderHostIds(tenantId, userId, folderId)
      : null
    if (personalFolderHostIds !== null && personalFolderHostIds.length === 0) {
      return { hosts: [], total: 0 }
    }
    const personalFiledHostIds = unfiled === true
      ? await this.findPersonalFolderHostIds(tenantId, userId)
      : null

    const idFilters = [visibleHostIds, inventoryHostIds, personalFolderHostIds].filter((ids): ids is number[] => ids !== null)
    const allowedHostIds = idFilters.length > 0
      ? idFilters.reduce((current, ids) => {
          const allowed = new Set(ids)
          return current.filter((id) => allowed.has(id))
        })
      : null
    if (allowedHostIds !== null && allowedHostIds.length === 0) {
      return { hosts: [], total: 0 }
    }

    const visibilityFilter: Prisma.HostWhereInput =
      allowedHostIds !== null
        ? {
            tenantId,
            ...activeHostWhere,
            id: { in: allowedHostIds },
          }
        : role === 'ADMIN'
        ? {
            tenantId,
            ...activeHostWhere,
          }
        : {
            tenantId,
            ...activeHostWhere,
            id: { in: visibleHostIds ?? [] },
          }

    const connectionModeFilter = connectionMode !== undefined
      ? ({ connectionMode } as unknown as Prisma.HostWhereInput)
      : {}

    const where: Prisma.HostWhereInput = {
      ...visibilityFilter,
      ...(scope   && { scope }),
      ...(groupId && { groupId }),
      ...(bastionId !== undefined && { bastionId }),
      ...(pemKeyId !== undefined && { pemKeyId }),
      ...(authType !== undefined && { authType }),
      ...(accessProtocol !== undefined && { accessProtocol }),
      ...(operatingSystem !== undefined && { operatingSystem }),
      ...connectionModeFilter,
      ...(personalFiledHostIds !== null && personalFiledHostIds.length > 0 && {
        NOT: { id: { in: personalFiledHostIds } },
      }),
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

    return { hosts: await this.applyPersonalFolderOverlay(await this.hydrateHostDescriptions(hosts), tenantId, userId), total }
  }

  async getSidebarSummary(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<HostSidebarSummary> {
    const visibleHostIds = role === 'ADMIN'
      ? null
      : await this.findVisibleHostIds(tenantId, userId, role)
    if (visibleHostIds !== null && visibleHostIds.length === 0) {
      return { all: 0, global: 0, unfiled: 0, maxHosts: null, folders: {}, groups: {}, tags: {} }
    }

    const whereSql = visibleHostIds === null
      ? Prisma.sql`h.tenant_id = ${tenantId} AND h.deleted_at IS NULL`
      : Prisma.sql`h.tenant_id = ${tenantId} AND h.deleted_at IS NULL AND h.id IN (${Prisma.join(visibleHostIds)})`

    const [totals, folderCounts, groupCounts, tagCounts] = await Promise.all([
      this.db.$queryRaw<Array<{ allCount: bigint | number; globalCount: bigint | number; unfiledCount: bigint | number }>>(Prisma.sql`
        SELECT
          COUNT(*) AS allCount,
          SUM(CASE WHEN h.scope = 'GLOBAL' THEN 1 ELSE 0 END) AS globalCount,
          SUM(CASE WHEN hpf.folder_id IS NULL THEN 1 ELSE 0 END) AS unfiledCount
        FROM hosts h
        LEFT JOIN host_personal_folders hpf
          ON hpf.host_id = h.id
         AND hpf.tenant_id = ${tenantId}
         AND hpf.user_id = ${userId}
        WHERE ${whereSql}
      `),
      this.db.$queryRaw<Array<{ folderId: number; count: bigint | number }>>(Prisma.sql`
        SELECT hpf.folder_id AS folderId, COUNT(*) AS count
        FROM hosts h
        INNER JOIN host_personal_folders hpf
          ON hpf.host_id = h.id
         AND hpf.tenant_id = ${tenantId}
         AND hpf.user_id = ${userId}
        WHERE ${whereSql}
        GROUP BY hpf.folder_id
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

  async findByIdForUser(id: number, tenantId: number, userId: number): Promise<HostRow | null> {
    const host = await this.findById(id, tenantId)
    if (!host) return null
    const [withFolder] = await this.applyPersonalFolderOverlay([host], tenantId, userId)
    return withFolder ?? host
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

  async findBastionSourceHostId(id: number, tenantId: number): Promise<number | null> {
    const rows = await this.db.$queryRaw<Array<{ sourceHostId: number | null }>>(Prisma.sql`
      SELECT source_host_id AS sourceHostId
      FROM bastion_hosts
      WHERE id = ${id} AND tenant_id = ${tenantId}
      LIMIT 1
    `)
    return rows[0]?.sourceHostId ?? null
  }

  async findBastionProfileIdBySourceHost(hostId: number, tenantId: number): Promise<number | null> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT id FROM bastion_hosts
      WHERE source_host_id = ${hostId} AND tenant_id = ${tenantId}
      LIMIT 1
    `)
    return rows[0]?.id ?? null
  }

  async findGroupBastionId(groupId: number | null, tenantId: number): Promise<number | null> {
    if (groupId === null) return null
    const group = await this.db.group.findFirst({
      where: { id: groupId, tenantId },
      select: { bastionId: true },
    })
    return group?.bastionId ?? null
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

  async inventoryFolderAclSummary(id: number, tenantId: number): Promise<{ name: string; aclEntries: number } | null> {
    const rows = await this.db.$queryRaw<Array<{ name: string; aclEntries: bigint | number }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS is_local
        FROM inventory_nodes
        WHERE id = ${id}
          AND tenant_id = ${tenantId}
          AND type IN ('ROOT', 'FOLDER')
          AND deleted_at IS NULL

        UNION ALL

        SELECT parent.id, parent.parent_id, parent.name, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT
        (SELECT name FROM ancestors WHERE is_local = 1 LIMIT 1) AS name,
        COUNT(acl.id) AS aclEntries
      FROM ancestors
      LEFT JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id
       AND acl.tenant_id = ${tenantId}
       AND (ancestors.is_local = 1 OR acl.inherit_to_children = true)
    `)
    const row = rows[0]
    return row ? { name: row.name, aclEntries: Number(row.aclEntries) } : null
  }

  async inventoryFolderEffectivePermissions(
    id: number,
    tenantId: number,
    userId: number,
  ): Promise<{ view: boolean; connect: boolean; edit: boolean; admin: boolean }> {
    const rows = await this.db.$queryRaw<Array<{
      canView: bigint | number | boolean | null
      canConnect: bigint | number | boolean | null
      canEdit: bigint | number | boolean | null
      canAdmin: bigint | number | boolean | null
    }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, 1 AS is_local
        FROM inventory_nodes
        WHERE id = ${id}
          AND tenant_id = ${tenantId}
          AND type IN ('ROOT', 'FOLDER')
          AND deleted_at IS NULL

        UNION ALL

        SELECT parent.id, parent.parent_id, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT
        MAX(acl.can_view) AS canView,
        MAX(acl.can_connect) AS canConnect,
        MAX(acl.can_edit) AS canEdit,
        MAX(acl.can_admin) AS canAdmin
      FROM ancestors
      INNER JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id
       AND acl.tenant_id = ${tenantId}
      INNER JOIN users target_user
        ON target_user.id = ${userId}
       AND target_user.tenant_id = ${tenantId}
       AND target_user.deleted_at IS NULL
      WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
        AND (
          (acl.principal_type = 'USER' AND acl.principal_id = target_user.id)
          OR (
            acl.principal_type = 'GROUP'
            AND EXISTS (
              SELECT 1
              FROM user_groups ug
              INNER JOIN \`groups\` g ON g.id = ug.group_id
              WHERE ug.user_id = target_user.id
                AND ug.group_id = acl.principal_id
                AND g.tenant_id = ${tenantId}
            )
          )
          OR (
            acl.principal_type = 'ROLE'
            AND (
              acl.principal_id = 1
              OR (acl.principal_id = 2 AND target_user.role = 'ADMIN')
            )
          )
        )
    `)
    const row = rows[0]
    return {
      view: Boolean(row?.canView),
      connect: Boolean(row?.canConnect),
      edit: Boolean(row?.canEdit),
      admin: Boolean(row?.canAdmin),
    }
  }

  async personalFolderExists(id: number, userId: number, tenantId: number): Promise<boolean> {
    const count = await this.db.folder.count({ where: { id, userId, tenantId } })
    return count > 0
  }

  async findVisibleByIds(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    ids: number[],
  ): Promise<HostRow[]> {
    if (ids.length === 0) return []
    const visibleHostIds = role === 'ADMIN'
      ? null
      : await this.findVisibleHostIds(tenantId, userId, role)
    if (visibleHostIds !== null && visibleHostIds.length === 0) return []
    const allowedIds = visibleHostIds === null
      ? ids
      : (() => {
          const visible = new Set(visibleHostIds)
          return ids.filter((id) => visible.has(id))
        })()
    if (allowedIds.length === 0) return []

    const visibilityFilter: Prisma.HostWhereInput =
      role === 'ADMIN'
        ? { tenantId, ...activeHostWhere }
        : {
            tenantId,
            ...activeHostWhere,
          }

    const hosts = await this.db.host.findMany({
      where: {
        ...visibilityFilter,
        id: { in: allowedIds },
      },
      include: hostInclude,
    })
    return this.applyPersonalFolderOverlay(await this.hydrateHostDescriptions(hosts), tenantId, userId)
  }

  private async findPersonalFolderHostIds(tenantId: number, userId: number, folderId?: number): Promise<number[]> {
    const rows = folderId === undefined
      ? await this.db.$queryRaw<Array<{ hostId: number }>>(Prisma.sql`
          SELECT host_id AS hostId
          FROM host_personal_folders
          WHERE tenant_id = ${tenantId}
            AND user_id = ${userId}
        `)
      : await this.db.$queryRaw<Array<{ hostId: number }>>(Prisma.sql`
          SELECT host_id AS hostId
          FROM host_personal_folders
          WHERE tenant_id = ${tenantId}
            AND user_id = ${userId}
            AND folder_id = ${folderId}
        `)
    return rows.map((row) => row.hostId)
  }

  private async applyPersonalFolderOverlay(hosts: HostRow[], tenantId: number, userId: number): Promise<HostRow[]> {
    if (hosts.length === 0) return hosts
    const hostIds = hosts.map((host) => host.id)
    const rows = await this.db.$queryRaw<Array<{ hostId: number; folderId: number }>>(Prisma.sql`
      SELECT host_id AS hostId, folder_id AS folderId
      FROM host_personal_folders
      WHERE tenant_id = ${tenantId}
        AND user_id = ${userId}
        AND host_id IN (${Prisma.join(hostIds)})
    `)
    const folderByHostId = new Map(rows.map((row) => [row.hostId, row.folderId]))
    return hosts.map((host) => ({
      ...host,
      folderId: folderByHostId.get(host.id) ?? null,
    }))
  }

  async setPersonalFolder(hostId: number, folderId: number | null, userId: number, tenantId: number): Promise<void> {
    if (folderId === null) {
      await this.db.$executeRaw(Prisma.sql`
        DELETE FROM host_personal_folders
        WHERE tenant_id = ${tenantId}
          AND user_id = ${userId}
          AND host_id = ${hostId}
      `)
      return
    }

    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO host_personal_folders (tenant_id, user_id, host_id, folder_id)
      VALUES (${tenantId}, ${userId}, ${hostId}, ${folderId})
      ON DUPLICATE KEY UPDATE
        folder_id = VALUES(folder_id),
        updated_at = CURRENT_TIMESTAMP(3)
    `)
  }

  async create(data: {
    name:              string
    description?:      string | null
    ip:                string
    port:              number
    sshUser:           string
    accessProtocol:    HostAccessProtocol
    operatingSystem:   HostOperatingSystem
    authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
    connectionMode:    HostConnectionMode
    privateAccessConnectorId?: number | null
    scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
    tenantId:          number
    ownerId?:          number
    groupId?:          number
    folderId?:         number
    inventoryParentId: number
    onePasswordRef?:   string
    startupSnippetId?: number | null
    startupSnippetMode?: 'DISABLED' | 'SUGGEST' | 'AUTO'
    bastionId?:        number
    pemKeyId?:         number
    passwordEncrypted?: string
    tagNames?:         string[]
    associatedLinks?:  HostAssociatedLink[]
  }): Promise<HostRow> {
    const { tagNames, associatedLinks, inventoryParentId, ...hostData } = data

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
      const inventoryNodesCreated = await tx.$executeRaw(Prisma.sql`
        INSERT INTO inventory_nodes
          (tenant_id, parent_id, type, host_id, name, path, depth, updated_at)
        SELECT
          ${data.tenantId}, parent_node.id, 'HOST', ${host.id}, ${data.name}, '',
          parent_node.depth + 1, CURRENT_TIMESTAMP(3)
        FROM inventory_nodes parent_node
        WHERE parent_node.tenant_id = ${data.tenantId}
          AND parent_node.deleted_at IS NULL
          AND parent_node.type IN ('ROOT', 'FOLDER')
          AND parent_node.id = ${inventoryParentId}
      `)
      if (inventoryNodesCreated !== 1) {
        throw new Error(`Pasta do inventário não encontrada para o tenant ${data.tenantId}`)
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE inventory_nodes node
        INNER JOIN inventory_nodes parent ON parent.id = node.parent_id
        SET node.path = CONCAT(parent.path, node.id, '/')
        WHERE node.host_id = ${host.id}
      `)
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
      operatingSystem:   HostOperatingSystem
      authType:          'PEM' | 'PASSWORD' | 'PEM_PASSWORD'
      connectionMode:    HostConnectionMode
      privateAccessConnectorId: number | null
      scope:             'PERSONAL' | 'TEAM' | 'GLOBAL'
      ownerId:           number | null
      groupId:           number | null
      folderId:          number | null
      onePasswordRef:    string | null
      startupSnippetId:  number | null
      startupSnippetMode: 'DISABLED' | 'SUGGEST' | 'AUTO'
      bastionId:         number | null
      pemKeyId:          number | null
      passwordEncrypted: string | null
      tagNames:          string[]
      associatedLinks:   HostAssociatedLink[]
      inventoryParentId: number | null
    }>,
  ): Promise<HostRow> {
    const { tagNames, associatedLinks, inventoryParentId, ...hostData } = data

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
      if (data.name !== undefined) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE inventory_nodes
          SET name = ${data.name}, updated_at = CURRENT_TIMESTAMP(3)
          WHERE host_id = ${id} AND tenant_id = ${tenantId} AND deleted_at IS NULL
        `)
      }
      if (inventoryParentId !== undefined) {
        if (inventoryParentId === null) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE inventory_nodes
            SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP(3)),
                updated_at = CURRENT_TIMESTAMP(3)
            WHERE host_id = ${id}
              AND tenant_id = ${tenantId}
              AND type = 'HOST'
              AND deleted_at IS NULL
          `)
          return
        }
        const moved = await tx.$executeRaw(Prisma.sql`
          UPDATE inventory_nodes node
          INNER JOIN inventory_nodes parent_node
            ON parent_node.id = ${inventoryParentId}
           AND parent_node.tenant_id = ${tenantId}
           AND parent_node.deleted_at IS NULL
           AND parent_node.type IN ('ROOT', 'FOLDER')
          SET
            node.parent_id = parent_node.id,
            node.path = CONCAT(parent_node.path, node.id, '/'),
            node.depth = parent_node.depth + 1,
            node.updated_at = CURRENT_TIMESTAMP(3)
          WHERE node.host_id = ${id}
            AND node.tenant_id = ${tenantId}
            AND node.type = 'HOST'
            AND node.deleted_at IS NULL
        `)
        if (moved !== 1) {
          const created = await tx.$executeRaw(Prisma.sql`
            INSERT INTO inventory_nodes
              (tenant_id, parent_id, type, host_id, name, path, depth, updated_at)
            SELECT
              ${tenantId}, parent_node.id, 'HOST', host.id, host.name, '',
              parent_node.depth + 1, CURRENT_TIMESTAMP(3)
            FROM inventory_nodes parent_node
            INNER JOIN hosts host
              ON host.id = ${id}
             AND host.tenant_id = ${tenantId}
            WHERE parent_node.id = ${inventoryParentId}
              AND parent_node.tenant_id = ${tenantId}
              AND parent_node.deleted_at IS NULL
              AND parent_node.type IN ('ROOT', 'FOLDER')
          `)
          if (created !== 1) {
            throw new Error(`Pasta do inventário não encontrada para o tenant ${tenantId}`)
          }
          await tx.$executeRaw(Prisma.sql`
            UPDATE inventory_nodes node
            INNER JOIN inventory_nodes parent ON parent.id = node.parent_id
            SET node.path = CONCAT(parent.path, node.id, '/')
            WHERE node.host_id = ${id}
              AND node.tenant_id = ${tenantId}
              AND node.type = 'HOST'
              AND node.deleted_at IS NULL
          `)
        }
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
    await this.db.$transaction(async (tx) => {
      await tx.host.update({ where: { id }, data: { deletedAt: new Date() } })
      await tx.$executeRaw(Prisma.sql`
        UPDATE inventory_nodes
        SET deleted_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
        WHERE host_id = ${id} AND deleted_at IS NULL
      `)
    })
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
    alias = 'h',
  ): Prisma.Sql {
    return role === 'ADMIN'
      ? Prisma.sql`${Prisma.raw(`${alias}.tenant_id`)} = ${tenantId} AND ${Prisma.raw(`${alias}.deleted_at`)} IS NULL`
      : Prisma.sql`
          ${Prisma.raw(`${alias}.tenant_id`)} = ${tenantId}
          AND ${Prisma.raw(`${alias}.deleted_at`)} IS NULL
          AND EXISTS (
            WITH RECURSIVE ancestors AS (
              SELECT node.id, node.parent_id, 1 AS is_local
              FROM inventory_nodes node
              WHERE node.host_id = ${Prisma.raw(`${alias}.id`)}
                AND node.tenant_id = ${tenantId}
                AND node.deleted_at IS NULL

              UNION ALL

              SELECT parent.id, parent.parent_id, 0 AS is_local
              FROM inventory_nodes parent
              INNER JOIN ancestors child ON child.parent_id = parent.id
              WHERE parent.tenant_id = ${tenantId}
                AND parent.deleted_at IS NULL
            )
            SELECT 1
            FROM ancestors
            INNER JOIN resource_acl_entries acl
              ON acl.inventory_node_id = ancestors.id
             AND acl.tenant_id = ${tenantId}
            INNER JOIN users target_user
              ON target_user.id = ${userId}
             AND target_user.tenant_id = ${tenantId}
             AND target_user.deleted_at IS NULL
            WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
              AND acl.can_view = true
              AND (
                (acl.principal_type = 'USER' AND acl.principal_id = target_user.id)
                OR (
                  acl.principal_type = 'GROUP'
                  AND EXISTS (
                    SELECT 1
                    FROM user_groups ug
                    INNER JOIN \`groups\` g ON g.id = ug.group_id
                    WHERE ug.user_id = target_user.id
                      AND ug.group_id = acl.principal_id
                      AND g.tenant_id = ${tenantId}
                  )
                )
                OR (
                  acl.principal_type = 'ROLE'
                  AND (
                    acl.principal_id = 1
                    OR (acl.principal_id = 2 AND target_user.role = 'ADMIN')
                  )
                )
              )
          )
        `
  }

  private async findVisibleHostIds(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
  ): Promise<number[]> {
    if (role === 'ADMIN') {
      const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
        SELECT id
        FROM hosts
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
      `)
      return rows.map((row) => row.id)
    }

    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT host_node.host_id, host_node.id, host_node.parent_id, 1 AS is_local
        FROM inventory_nodes host_node
        INNER JOIN hosts host
          ON host.id = host_node.host_id
         AND host.tenant_id = ${tenantId}
         AND host.deleted_at IS NULL
        WHERE host_node.host_id IS NOT NULL
          AND host_node.tenant_id = ${tenantId}
          AND host_node.type = 'HOST'
          AND host_node.deleted_at IS NULL

        UNION ALL

        SELECT child.host_id, parent.id, parent.parent_id, 0 AS is_local
        FROM inventory_nodes parent
        INNER JOIN ancestors child ON child.parent_id = parent.id
        WHERE parent.tenant_id = ${tenantId}
          AND parent.deleted_at IS NULL
      )
      SELECT ancestors.host_id AS id
      FROM ancestors
      INNER JOIN resource_acl_entries acl
        ON acl.inventory_node_id = ancestors.id
       AND acl.tenant_id = ${tenantId}
      INNER JOIN users target_user
        ON target_user.id = ${userId}
       AND target_user.tenant_id = ${tenantId}
       AND target_user.deleted_at IS NULL
      WHERE (ancestors.is_local = 1 OR acl.inherit_to_children = true)
        AND acl.can_view = true
        AND (
          (acl.principal_type = 'USER' AND acl.principal_id = target_user.id)
          OR (
            acl.principal_type = 'GROUP'
            AND EXISTS (
              SELECT 1
              FROM user_groups ug
              INNER JOIN \`groups\` g ON g.id = ug.group_id
              WHERE ug.user_id = target_user.id
                AND ug.group_id = acl.principal_id
                AND g.tenant_id = ${tenantId}
            )
          )
          OR (
            acl.principal_type = 'ROLE'
            AND (
              acl.principal_id = 1
              OR (acl.principal_id = 2 AND target_user.role = 'ADMIN')
            )
          )
        )
      GROUP BY ancestors.host_id
    `)
    return rows.map((row) => row.id)
  }

  private async findHostIdsInInventorySubtree(
    tenantId: number,
    inventoryNodeId: number,
  ): Promise<number[]> {
    const rows = await this.db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT host_node.host_id AS id
      FROM inventory_nodes selected_node
      INNER JOIN inventory_nodes host_node
        ON host_node.tenant_id = selected_node.tenant_id
       AND host_node.deleted_at IS NULL
       AND host_node.type = 'HOST'
       AND host_node.path LIKE CONCAT(selected_node.path, '%')
      WHERE selected_node.id = ${inventoryNodeId}
        AND selected_node.tenant_id = ${tenantId}
        AND selected_node.deleted_at IS NULL
    `)
    return rows.map((row) => row.id)
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
    limit = 500,
  ): Promise<HostAssociatedLinkCatalogRow[]> {
    const whereSql = this.buildVisibleHostsWhereSql(tenantId, userId, role, 'h')

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
