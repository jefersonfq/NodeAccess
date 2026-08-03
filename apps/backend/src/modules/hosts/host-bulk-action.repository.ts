import { Prisma, type PrismaClient } from '@prisma/client'
import type { HostBulkAction, HostBulkActionHistoryItem, HostBulkApplyRow, HostBulkFilter, HostBulkHistoryAction, HostBulkSelection } from '@nodeaccess/shared'
import type { HostFilters, HostRow } from './host.repository.js'

const activeHostWhere = { deletedAt: null } as const

const hostBulkInclude = {
  tags: { include: { tag: true } },
  bastion: { select: { id: true, name: true } },
  pemKey: { select: { id: true, name: true } },
  group: {
    select: {
      id: true,
      name: true,
      bastionId: true,
      bastion: { select: { id: true, name: true } },
    },
  },
  inventoryNode: {
    select: {
      parentId: true,
      parent: { select: { name: true, type: true } },
    },
  },
} as const

export type HostBulkRow = Prisma.HostGetPayload<{ include: typeof hostBulkInclude }>

interface CreateHostBulkHistoryInput {
  tenantId: number
  actorUserId: number
  action: HostBulkHistoryAction
  actionLabel: string
  selection: HostBulkSelection
  requested: number
  updated: number
  skipped: number
  failed: number
  rows: HostBulkApplyRow[]
}

interface HostBulkHistoryDbRow {
  id: number
  actor_name: string
  actor_email: string
  action_type: string
  action_label: string
  selection_json: unknown
  action_json: unknown
  requested: number
  updated: number
  skipped: number
  failed: number
  result_rows_json: unknown
  created_at: Date
}

interface HostBulkSnapshotRestoreRow {
  hostId: number
  bastionId?: number | null
  pemKeyId?: number | null
  tagIds?: number[]
  inventoryParentId?: number | null
}

export class HostBulkActionRepository {
  constructor(private readonly db: PrismaClient) {}

  async resolveSelection(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    selection: HostBulkSelection,
  ): Promise<HostBulkRow[]> {
    const where = this.visibleWhere(tenantId, userId, role)

    if (selection.mode === 'ids') {
      return this.db.host.findMany({
        where: {
          ...where,
          id: { in: [...new Set(selection.hostIds)] },
        },
        include: hostBulkInclude,
        orderBy: { name: 'asc' },
      })
    }

    return this.db.host.findMany({
      where: {
        ...where,
        ...await this.filterWhere(tenantId, userId, selection.filter),
      },
      include: hostBulkInclude,
      orderBy: { name: 'asc' },
      take: 500,
    })
  }

  async countSelection(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    selection: HostBulkSelection,
  ): Promise<number> {
    const where = this.visibleWhere(tenantId, userId, role)
    if (selection.mode === 'ids') {
      return this.db.host.count({
        where: {
          ...where,
          id: { in: [...new Set(selection.hostIds)] },
        },
      })
    }
    return this.db.host.count({
      where: {
        ...where,
        ...await this.filterWhere(tenantId, userId, selection.filter),
      },
    })
  }

  async bastionName(id: number, tenantId: number): Promise<string | null> {
    const row = await this.db.bastionHost.findFirst({ where: { id, tenantId }, select: { name: true } })
    return row?.name ?? null
  }

  async pemKeyName(id: number, tenantId: number): Promise<string | null> {
    const row = await this.db.pemKey.findFirst({ where: { id, createdBy: { tenantId } }, select: { name: true } })
    return row?.name ?? null
  }

  async tagNames(ids: number[], tenantId: number): Promise<Map<number, string>> {
    const rows = await this.db.tag.findMany({
      where: { id: { in: [...new Set(ids)] }, tenantId },
      select: { id: true, name: true },
    })
    return new Map(rows.map((row) => [row.id, row.name]))
  }

  async inventoryFolder(id: number, tenantId: number): Promise<{ name: string; aclEntries: number } | null> {
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

  async applyAction(
    hostIds: number[],
    tenantId: number,
    action: HostBulkAction,
    actorUserId: number,
  ): Promise<void> {
    const ids = [...new Set(hostIds)]
    if (ids.length === 0) return

    await this.db.$transaction(async (tx) => {
      if (action.type === 'set_bastion') {
        await tx.host.updateMany({ where: { tenantId, id: { in: ids }, ...activeHostWhere }, data: { bastionId: action.bastionId } })
        return
      }

      if (action.type === 'set_pem_key') {
        await tx.host.updateMany({ where: { tenantId, id: { in: ids }, ...activeHostWhere }, data: { pemKeyId: action.pemKeyId } })
        return
      }

      if (action.type === 'move_inventory') {
        await tx.$executeRaw(Prisma.sql`
          UPDATE inventory_nodes node
          INNER JOIN inventory_nodes parent
            ON parent.id = ${action.inventoryParentId}
           AND parent.tenant_id = ${tenantId}
           AND parent.type IN ('ROOT', 'FOLDER')
           AND parent.deleted_at IS NULL
          SET
            node.parent_id = parent.id,
            node.path = CONCAT(parent.path, node.id, '/'),
            node.depth = parent.depth + 1,
            node.updated_by_id = ${actorUserId},
            node.updated_at = CURRENT_TIMESTAMP(3)
          WHERE node.tenant_id = ${tenantId}
            AND node.host_id IN (${Prisma.join(ids)})
            AND node.type = 'HOST'
            AND node.deleted_at IS NULL
        `)
        return
      }

      if (action.type === 'add_tags') {
        for (const hostId of ids) {
          for (const tagId of action.tagIds) {
            await tx.hostTag.upsert({
              where: { hostId_tagId: { hostId, tagId } },
              create: { hostId, tagId },
              update: {},
            })
          }
        }
        return
      }

      if (action.type === 'remove_tags') {
        await tx.hostTag.deleteMany({
          where: {
            hostId: { in: ids },
            tagId: { in: action.tagIds },
          },
        })
      }
    })
  }

  async restoreSnapshots(
    tenantId: number,
    rows: HostBulkSnapshotRestoreRow[],
    fields: Array<'bastionId' | 'pemKeyId' | 'tagIds' | 'inventoryParentId'>,
    actorUserId?: number,
  ): Promise<Set<number>> {
    const ids = [...new Set(rows.map((row) => row.hostId))]
    if (ids.length === 0) return new Set()

    const activeRows = await this.db.host.findMany({
      where: { tenantId, id: { in: ids }, ...activeHostWhere },
      select: { id: true },
    })
    const activeIds = new Set(activeRows.map((row) => row.id))

    await this.db.$transaction(async (tx) => {
      for (const row of rows) {
        if (!activeIds.has(row.hostId)) continue

        if (fields.includes('bastionId')) {
          await tx.host.updateMany({
            where: { tenantId, id: row.hostId, ...activeHostWhere },
            data: { bastionId: row.bastionId ?? null },
          })
        }

        if (fields.includes('pemKeyId')) {
          await tx.host.updateMany({
            where: { tenantId, id: row.hostId, ...activeHostWhere },
            data: { pemKeyId: row.pemKeyId ?? null },
          })
        }

        if (fields.includes('tagIds')) {
          await tx.hostTag.deleteMany({ where: { hostId: row.hostId } })
          for (const tagId of row.tagIds ?? []) {
            await tx.hostTag.create({ data: { hostId: row.hostId, tagId } })
          }
        }

        if (fields.includes('inventoryParentId') && row.inventoryParentId) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE inventory_nodes node
            INNER JOIN inventory_nodes parent
              ON parent.id = ${row.inventoryParentId}
             AND parent.tenant_id = ${tenantId}
             AND parent.type IN ('ROOT', 'FOLDER')
             AND parent.deleted_at IS NULL
            SET
              node.parent_id = parent.id,
              node.path = CONCAT(parent.path, node.id, '/'),
              node.depth = parent.depth + 1,
              node.updated_by_id = ${actorUserId ?? null},
              node.updated_at = CURRENT_TIMESTAMP(3)
            WHERE node.tenant_id = ${tenantId}
              AND node.host_id = ${row.hostId}
              AND node.type = 'HOST'
              AND node.deleted_at IS NULL
          `)
        }
      }
    })

    return activeIds
  }

  async createHistory(input: CreateHostBulkHistoryInput): Promise<void> {
    await this.db.$executeRaw`
      INSERT INTO host_bulk_action_history (
        tenant_id,
        actor_user_id,
        action_type,
        action_label,
        selection_json,
        action_json,
        requested,
        updated,
        skipped,
        failed,
        result_rows_json
      ) VALUES (
        ${input.tenantId},
        ${input.actorUserId},
        ${input.action.type},
        ${input.actionLabel},
        ${JSON.stringify(input.selection)},
        ${JSON.stringify(input.action)},
        ${input.requested},
        ${input.updated},
        ${input.skipped},
        ${input.failed},
        ${JSON.stringify(input.rows)}
      )
    `
  }

  async listHistory(tenantId: number, limit = 50): Promise<HostBulkActionHistoryItem[]> {
    const take = Math.min(Math.max(limit, 1), 100)
    const rows = await this.db.$queryRaw<HostBulkHistoryDbRow[]>`
      SELECT
        h.id,
        u.name AS actor_name,
        u.email AS actor_email,
        h.action_type,
        h.action_label,
        h.selection_json,
        h.action_json,
        h.requested,
        h.updated,
        h.skipped,
        h.failed,
        h.result_rows_json,
        h.created_at
      FROM host_bulk_action_history h
      INNER JOIN users u ON u.id = h.actor_user_id
      WHERE h.tenant_id = ${tenantId}
      ORDER BY h.created_at DESC
      LIMIT ${take}
    `

    return rows.map(historyDbRowToPublic)
  }

  async getHistoryById(tenantId: number, historyId: number): Promise<HostBulkActionHistoryItem | null> {
    const rows = await this.db.$queryRaw<HostBulkHistoryDbRow[]>`
      SELECT
        h.id,
        u.name AS actor_name,
        u.email AS actor_email,
        h.action_type,
        h.action_label,
        h.selection_json,
        h.action_json,
        h.requested,
        h.updated,
        h.skipped,
        h.failed,
        h.result_rows_json,
        h.created_at
      FROM host_bulk_action_history h
      INNER JOIN users u ON u.id = h.actor_user_id
      WHERE h.tenant_id = ${tenantId} AND h.id = ${historyId}
      LIMIT 1
    `
    return rows[0] ? historyDbRowToPublic(rows[0]) : null
  }

  private visibleWhere(
    tenantId: number,
    _userId: number,
    role: 'ADMIN' | 'USER',
  ): Prisma.HostWhereInput {
    return role === 'ADMIN'
      ? { tenantId, ...activeHostWhere }
      : { tenantId, ...activeHostWhere, id: { in: [] } }
  }

  private async filterWhere(tenantId: number, userId: number, filter: HostBulkFilter): Promise<Prisma.HostWhereInput> {
    const scope = filter.scope?.toUpperCase() as HostFilters['scope'] | undefined
    const folderHostIds = filter.folderId != null
      ? await this.personalFolderHostIds(tenantId, userId, filter.folderId)
      : null
    const filedHostIds = filter.unfiled === true
      ? await this.personalFolderHostIds(tenantId, userId)
      : null
    return {
      ...(scope && { scope }),
      ...(filter.groupId !== undefined && { groupId: filter.groupId }),
      ...(folderHostIds !== null && { id: { in: folderHostIds } }),
      ...(filter.bastionId !== undefined && { bastionId: filter.bastionId }),
      ...(filter.pemKeyId !== undefined && { pemKeyId: filter.pemKeyId }),
      ...(filter.authType !== undefined && { authType: filter.authType.toUpperCase() as 'PEM' | 'PASSWORD' | 'PEM_PASSWORD' }),
      ...(filter.connectionMode !== undefined && { connectionMode: filter.connectionMode.toUpperCase() as 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO' }),
      ...(filedHostIds !== null && filedHostIds.length > 0 && { NOT: { id: { in: filedHostIds } } }),
      ...(filter.tagId !== undefined && { tags: { some: { tagId: filter.tagId } } }),
      ...(filter.search !== undefined && filter.search.trim() && {
        OR: [
          { name: { contains: filter.search.trim() } },
          { ip: { contains: filter.search.trim() } },
        ],
      }),
    }
  }

  private async personalFolderHostIds(tenantId: number, userId: number, folderId?: number): Promise<number[]> {
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
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return JSON.parse(value)
}

function historyDbRowToPublic(row: HostBulkHistoryDbRow): HostBulkActionHistoryItem {
  const rows = parseJson(row.result_rows_json) as HostBulkApplyRow[]
  return {
    id: row.id,
    actorName: row.actor_name,
    actorEmail: row.actor_email,
    actionType: row.action_type as HostBulkHistoryAction['type'],
    actionLabel: row.action_label,
    selection: parseJson(row.selection_json) as HostBulkSelection,
    action: parseJson(row.action_json) as HostBulkHistoryAction,
    requested: row.requested,
    updated: row.updated,
    skipped: row.skipped,
    failed: row.failed,
    rows,
    createdAt: row.created_at,
    reversible: isHistoryReversible(row.action_type, rows),
  }
}

function isHistoryReversible(actionType: string, rows: HostBulkApplyRow[]): boolean {
  if (actionType === 'rollback') return false
  return rows.some((row) => row.status === 'updated' && !!row.before)
}
