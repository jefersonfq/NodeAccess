import { Prisma, type PrismaClient } from '@prisma/client'

export interface SnippetUsageReportFilters {
  dateFrom: Date
  dateTo: Date
  search?: string
  status?: string
  userId?: number
  snippetId?: number
  hostId?: number
  page?: number
  limit?: number
}

export interface SnippetUsageSummaryRow {
  totalExecutions: number | bigint
  uniqueUsers: number | bigint
  uniqueSnippets: number | bigint
  failedExecutions: number | bigint
}

export interface SnippetUsageTopSnippetRow {
  snippetId: number | null
  snippetName: string | null
  count: number | bigint
  failedCount: number | bigint
}

export interface SnippetUsageTopUserRow {
  userId: number
  userName: string
  userEmail: string
  count: number | bigint
}

export interface SnippetUsageExecutionRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  snippetId: number | null
  snippetName: string | null
  snippetScope: string | null
  hostId: number | null
  hostName: string | null
  sessionId: number | null
  source: string
  status: string
  executedAt: Date
}

function buildWhere(tenantId: number, filters: SnippetUsageReportFilters) {
  const where: Prisma.Sql[] = [
    Prisma.sql`e.tenant_id = ${tenantId}`,
    Prisma.sql`e.executed_at >= ${filters.dateFrom}`,
    Prisma.sql`e.executed_at <= ${filters.dateTo}`,
  ]

  if (filters.status !== undefined) where.push(Prisma.sql`e.status = ${filters.status}`)
  if (filters.userId !== undefined) where.push(Prisma.sql`e.user_id = ${filters.userId}`)
  if (filters.snippetId !== undefined) where.push(Prisma.sql`e.snippet_id = ${filters.snippetId}`)
  if (filters.hostId !== undefined) where.push(Prisma.sql`e.host_id = ${filters.hostId}`)
  if (filters.search !== undefined) {
    const like = `%${filters.search}%`
    where.push(Prisma.sql`(
      COALESCE(sn.name, '') LIKE ${like}
      OR u.name LIKE ${like}
      OR u.email LIKE ${like}
      OR COALESCE(h.name, '') LIKE ${like}
    )`)
  }

  const combined = where.slice(1).reduce(
    (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
    where[0]!,
  )
  return Prisma.sql`WHERE ${combined}`
}

export class SnippetUsageReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async getReport(tenantId: number, filters: SnippetUsageReportFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const skip = (page - 1) * limit
    const whereSql = buildWhere(tenantId, filters)

    const [
      summaryRows,
      topSnippets,
      topUsers,
      executions,
      totalRows,
    ] = await Promise.all([
      this.db.$queryRaw<SnippetUsageSummaryRow[]>(Prisma.sql`
        SELECT
          COUNT(*) AS totalExecutions,
          COUNT(DISTINCT e.user_id) AS uniqueUsers,
          COUNT(DISTINCT e.snippet_id) AS uniqueSnippets,
          SUM(CASE WHEN e.status <> 'SENT' THEN 1 ELSE 0 END) AS failedExecutions
        FROM snippet_execution_events e
        INNER JOIN users u ON u.id = e.user_id
        LEFT JOIN snippets sn ON sn.id = e.snippet_id
        LEFT JOIN hosts h ON h.id = e.host_id
        ${whereSql}
      `),
      this.db.$queryRaw<SnippetUsageTopSnippetRow[]>(Prisma.sql`
        SELECT
          e.snippet_id AS snippetId,
          sn.name AS snippetName,
          COUNT(*) AS count,
          SUM(CASE WHEN e.status <> 'SENT' THEN 1 ELSE 0 END) AS failedCount
        FROM snippet_execution_events e
        INNER JOIN users u ON u.id = e.user_id
        LEFT JOIN snippets sn ON sn.id = e.snippet_id
        LEFT JOIN hosts h ON h.id = e.host_id
        ${whereSql}
        GROUP BY e.snippet_id, sn.name
        ORDER BY count DESC
        LIMIT 8
      `),
      this.db.$queryRaw<SnippetUsageTopUserRow[]>(Prisma.sql`
        SELECT
          e.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          COUNT(*) AS count
        FROM snippet_execution_events e
        INNER JOIN users u ON u.id = e.user_id
        LEFT JOIN snippets sn ON sn.id = e.snippet_id
        LEFT JOIN hosts h ON h.id = e.host_id
        ${whereSql}
        GROUP BY e.user_id, u.name, u.email
        ORDER BY count DESC
        LIMIT 8
      `),
      this.db.$queryRaw<SnippetUsageExecutionRow[]>(Prisma.sql`
        SELECT
          e.id,
          e.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          e.snippet_id AS snippetId,
          sn.name AS snippetName,
          sn.scope AS snippetScope,
          e.host_id AS hostId,
          h.name AS hostName,
          e.session_id AS sessionId,
          e.source,
          e.status,
          e.executed_at AS executedAt
        FROM snippet_execution_events e
        INNER JOIN users u ON u.id = e.user_id
        LEFT JOIN snippets sn ON sn.id = e.snippet_id
        LEFT JOIN hosts h ON h.id = e.host_id
        ${whereSql}
        ORDER BY e.executed_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `),
      this.db.$queryRaw<Array<{ total: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM snippet_execution_events e
        INNER JOIN users u ON u.id = e.user_id
        LEFT JOIN snippets sn ON sn.id = e.snippet_id
        LEFT JOIN hosts h ON h.id = e.host_id
        ${whereSql}
      `),
    ])

    return {
      summary: summaryRows[0],
      topSnippets,
      topUsers,
      executions,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    }
  }
}
