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
}

export class HostBulkActionRepository {
  constructor(private readonly db: PrismaClient) {}

  async resolveSelection(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
    selection: HostBulkSelection,
  ): Promise<HostBulkRow[]> {
    const where = this.visibleWhere(tenantId, userId, role, userGroupIds)

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
        ...this.filterWhere(selection.filter),
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
    userGroupIds: number[],
    selection: HostBulkSelection,
  ): Promise<number> {
    const where = this.visibleWhere(tenantId, userId, role, userGroupIds)
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
        ...this.filterWhere(selection.filter),
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

  async applyAction(hostIds: number[], tenantId: number, action: HostBulkAction): Promise<void> {
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
    fields: Array<'bastionId' | 'pemKeyId' | 'tagIds'>,
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
    userId: number,
    role: 'ADMIN' | 'USER',
    userGroupIds: number[],
  ): Prisma.HostWhereInput {
    return role === 'ADMIN'
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
  }

  private filterWhere(filter: HostBulkFilter): Prisma.HostWhereInput {
    const scope = filter.scope?.toUpperCase() as HostFilters['scope'] | undefined
    return {
      ...(scope && { scope }),
      ...(filter.groupId !== undefined && { groupId: filter.groupId }),
      ...(filter.folderId !== undefined && { folderId: filter.folderId }),
      ...(filter.bastionId !== undefined && { bastionId: filter.bastionId }),
      ...(filter.pemKeyId !== undefined && { pemKeyId: filter.pemKeyId }),
      ...(filter.authType !== undefined && { authType: filter.authType.toUpperCase() as 'PEM' | 'PASSWORD' | 'PEM_PASSWORD' }),
      ...(filter.connectionMode !== undefined && { connectionMode: filter.connectionMode.toUpperCase() as 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO' }),
      ...(filter.unfiled === true && { folderId: null }),
      ...(filter.tagId !== undefined && { tags: { some: { tagId: filter.tagId } } }),
      ...(filter.search !== undefined && filter.search.trim() && {
        OR: [
          { name: { contains: filter.search.trim() } },
          { ip: { contains: filter.search.trim() } },
        ],
      }),
    }
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
