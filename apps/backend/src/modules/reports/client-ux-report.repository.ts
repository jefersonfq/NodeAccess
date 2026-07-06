import { Prisma, type PrismaClient } from '@prisma/client'

const CLIENT_UX_ACTIONS = [
  'CLIENT_UX_SESSION_EXPIRED',
  'CLIENT_UX_SESSION_EXPIRED_TERMINAL',
  'CLIENT_UX_STALE_RELOAD_RECOVERED',
  'CLIENT_UX_STALE_RELOAD_FAILED',
] as const

export interface ClientUxReportFilters {
  dateFrom: Date
  dateTo: Date
  search?: string
  action?: string
  userId?: number
  page?: number
  limit?: number
}

export interface ClientUxSummaryRow {
  totalEvents: number | bigint
  sessionExpired: number | bigint
  sessionExpiredTerminal: number | bigint
  staleReloadRecovered: number | bigint
  staleReloadFailed: number | bigint
  uniqueUsers: number | bigint
}

export interface ClientUxActionRow {
  action: string
  count: number | bigint
}

export interface ClientUxUserRow {
  userId: number
  userName: string
  userEmail: string
  count: number | bigint
  lastEventAt: Date
}

export interface ClientUxDailyRow {
  date: string | Date
  action: string
  count: number | bigint
}

export interface ClientUxEventRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  action: string
  details: string | null
  timestamp: Date
}

function buildWhere(tenantId: number, filters: ClientUxReportFilters) {
  const where: Prisma.Sql[] = [
    Prisma.sql`u.tenant_id = ${tenantId}`,
    Prisma.sql`l.target_type = 'ClientUx'`,
    Prisma.sql`l.action IN (${Prisma.join(CLIENT_UX_ACTIONS)})`,
    Prisma.sql`l.timestamp >= ${filters.dateFrom}`,
    Prisma.sql`l.timestamp <= ${filters.dateTo}`,
  ]

  if (filters.action !== undefined) where.push(Prisma.sql`l.action = ${filters.action}`)
  if (filters.userId !== undefined) where.push(Prisma.sql`l.admin_id = ${filters.userId}`)
  if (filters.search !== undefined) {
    const like = `%${filters.search}%`
    where.push(Prisma.sql`(
      u.name LIKE ${like}
      OR u.email LIKE ${like}
      OR l.action LIKE ${like}
      OR COALESCE(l.details, '') LIKE ${like}
    )`)
  }

  const combined = where.slice(1).reduce(
    (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
    where[0]!,
  )
  return Prisma.sql`WHERE ${combined}`
}

export class ClientUxReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async getReport(tenantId: number, filters: ClientUxReportFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const skip = (page - 1) * limit
    const whereSql = buildWhere(tenantId, filters)

    const [summaryRows, byAction, topUsers, daily, events, totalRows] = await Promise.all([
      this.db.$queryRaw<ClientUxSummaryRow[]>(Prisma.sql`
        SELECT
          COUNT(*) AS totalEvents,
          SUM(CASE WHEN l.action = 'CLIENT_UX_SESSION_EXPIRED' THEN 1 ELSE 0 END) AS sessionExpired,
          SUM(CASE WHEN l.action = 'CLIENT_UX_SESSION_EXPIRED_TERMINAL' THEN 1 ELSE 0 END) AS sessionExpiredTerminal,
          SUM(CASE WHEN l.action = 'CLIENT_UX_STALE_RELOAD_RECOVERED' THEN 1 ELSE 0 END) AS staleReloadRecovered,
          SUM(CASE WHEN l.action = 'CLIENT_UX_STALE_RELOAD_FAILED' THEN 1 ELSE 0 END) AS staleReloadFailed,
          COUNT(DISTINCT l.admin_id) AS uniqueUsers
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        ${whereSql}
      `),
      this.db.$queryRaw<ClientUxActionRow[]>(Prisma.sql`
        SELECT l.action, COUNT(*) AS count
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        ${whereSql}
        GROUP BY l.action
        ORDER BY count DESC
      `),
      this.db.$queryRaw<ClientUxUserRow[]>(Prisma.sql`
        SELECT
          l.admin_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          COUNT(*) AS count,
          MAX(l.timestamp) AS lastEventAt
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        ${whereSql}
        GROUP BY l.admin_id, u.name, u.email
        ORDER BY count DESC, lastEventAt DESC
        LIMIT 8
      `),
      this.db.$queryRaw<ClientUxDailyRow[]>(Prisma.sql`
        SELECT DATE(l.timestamp) AS date, l.action, COUNT(*) AS count
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        ${whereSql}
        GROUP BY DATE(l.timestamp), l.action
        ORDER BY date ASC
      `),
      this.db.$queryRaw<ClientUxEventRow[]>(Prisma.sql`
        SELECT
          l.id,
          l.admin_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          l.action,
          l.details,
          l.timestamp
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        ${whereSql}
        ORDER BY l.timestamp DESC
        LIMIT ${limit} OFFSET ${skip}
      `),
      this.db.$queryRaw<Array<{ total: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        ${whereSql}
      `),
    ])

    return {
      summary: summaryRows[0],
      byAction,
      topUsers,
      daily,
      events,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    }
  }
}
