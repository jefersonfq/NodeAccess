import { Prisma, type PrismaClient } from '@prisma/client'

export interface SessionUsageReportFilters {
  dateFrom: Date
  dateTo: Date
  search?: string
  status?: string
  userId?: number
  hostId?: number
  page?: number
  limit?: number
}

export interface SessionUsageSummaryRow {
  totalSessions: number | bigint
  activeSessions: number | bigint
  failedSessions: number | bigint
  uniqueUsers: number | bigint
  uniqueHosts: number | bigint
}

export interface SessionUsageTopHostRow {
  hostId: number
  hostName: string
  hostIp: string
  count: number | bigint
  failedCount: number | bigint
}

export interface SessionUsageTopUserRow {
  userId: number
  userName: string
  userEmail: string
  count: number | bigint
  failedCount: number | bigint
}

export interface SessionUsageRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  hostId: number
  hostName: string
  hostIp: string
  startedAt: Date
  endedAt: Date | null
  active: boolean | number
  connectionMethod: string
  accessType: string
  errorCode: string | null
  endedReason: string | null
}

function buildWhere(tenantId: number, filters: SessionUsageReportFilters) {
  const where: Prisma.Sql[] = [
    Prisma.sql`u.tenant_id = ${tenantId}`,
    Prisma.sql`s.started_at >= ${filters.dateFrom}`,
    Prisma.sql`s.started_at <= ${filters.dateTo}`,
  ]

  if (filters.status === 'active') where.push(Prisma.sql`s.active = TRUE`)
  if (filters.status === 'failed') where.push(Prisma.sql`(s.error_code IS NOT NULL OR s.ended_reason = 'error')`)
  if (filters.status === 'completed') where.push(Prisma.sql`s.active = FALSE AND s.error_code IS NULL AND COALESCE(s.ended_reason, '') <> 'error'`)
  if (filters.userId !== undefined) where.push(Prisma.sql`s.user_id = ${filters.userId}`)
  if (filters.hostId !== undefined) where.push(Prisma.sql`s.host_id = ${filters.hostId}`)
  if (filters.search !== undefined) {
    const like = `%${filters.search}%`
    where.push(Prisma.sql`(
      u.name LIKE ${like}
      OR u.email LIKE ${like}
      OR h.name LIKE ${like}
      OR h.ip LIKE ${like}
      OR COALESCE(s.error_code, '') LIKE ${like}
    )`)
  }

  const combined = where.slice(1).reduce(
    (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
    where[0]!,
  )
  return Prisma.sql`WHERE ${combined}`
}

export class SessionUsageReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async getReport(tenantId: number, filters: SessionUsageReportFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const skip = (page - 1) * limit
    const whereSql = buildWhere(tenantId, filters)

    const [summaryRows, topHosts, topUsers, sessions, totalRows] = await Promise.all([
      this.db.$queryRaw<SessionUsageSummaryRow[]>(Prisma.sql`
        SELECT
          COUNT(*) AS totalSessions,
          SUM(CASE WHEN s.active = TRUE THEN 1 ELSE 0 END) AS activeSessions,
          SUM(CASE WHEN s.error_code IS NOT NULL OR s.ended_reason = 'error' THEN 1 ELSE 0 END) AS failedSessions,
          COUNT(DISTINCT s.user_id) AS uniqueUsers,
          COUNT(DISTINCT s.host_id) AS uniqueHosts
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
      `),
      this.db.$queryRaw<SessionUsageTopHostRow[]>(Prisma.sql`
        SELECT
          s.host_id AS hostId,
          h.name AS hostName,
          h.ip AS hostIp,
          COUNT(*) AS count,
          SUM(CASE WHEN s.error_code IS NOT NULL OR s.ended_reason = 'error' THEN 1 ELSE 0 END) AS failedCount
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
        GROUP BY s.host_id, h.name, h.ip
        ORDER BY count DESC
        LIMIT 8
      `),
      this.db.$queryRaw<SessionUsageTopUserRow[]>(Prisma.sql`
        SELECT
          s.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          COUNT(*) AS count,
          SUM(CASE WHEN s.error_code IS NOT NULL OR s.ended_reason = 'error' THEN 1 ELSE 0 END) AS failedCount
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
        GROUP BY s.user_id, u.name, u.email
        ORDER BY count DESC
        LIMIT 8
      `),
      this.db.$queryRaw<SessionUsageRow[]>(Prisma.sql`
        SELECT
          s.id,
          s.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          s.host_id AS hostId,
          h.name AS hostName,
          h.ip AS hostIp,
          s.started_at AS startedAt,
          s.ended_at AS endedAt,
          s.active,
          s.connection_method AS connectionMethod,
          s.access_type AS accessType,
          s.error_code AS errorCode,
          s.ended_reason AS endedReason
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
        ORDER BY s.started_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `),
      this.db.$queryRaw<Array<{ total: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
      `),
    ])

    return {
      summary: summaryRows[0],
      topHosts,
      topUsers,
      sessions,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    }
  }
}
