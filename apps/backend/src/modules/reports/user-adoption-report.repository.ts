import { Prisma, type PrismaClient } from '@prisma/client'

export interface UserAdoptionReportFilters {
  dateFrom: Date
  dateTo: Date
  search?: string
  page?: number
  limit?: number
}

export interface UserAdoptionSummaryRow {
  activeUsers: number | bigint
  totalSessions: number | bigint
  totalSnippets: number | bigint
  totalSshTunnels: number | bigint
  totalLiveSessions: number | bigint
}

export interface UserAdoptionRow {
  userId: number
  userName: string
  userEmail: string
  sessions: number | bigint
  snippets: number | bigint
  sshTunnels: number | bigint
  liveSessions: number | bigint
  lastActivityAt: Date | null
}

function buildUserWhere(tenantId: number, search?: string) {
  const where: Prisma.Sql[] = [
    Prisma.sql`u.tenant_id = ${tenantId}`,
    Prisma.sql`u.deleted_at IS NULL`,
  ]
  if (search !== undefined) {
    const like = `%${search}%`
    where.push(Prisma.sql`(u.name LIKE ${like} OR u.email LIKE ${like})`)
  }
  const combined = where.slice(1).reduce(
    (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
    where[0]!,
  )
  return Prisma.sql`WHERE ${combined}`
}

export class UserAdoptionReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async getReport(tenantId: number, filters: UserAdoptionReportFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const skip = (page - 1) * limit
    const userWhereSql = buildUserWhere(tenantId, filters.search)
    const from = filters.dateFrom
    const to = filters.dateTo

    const baseCtes = Prisma.sql`
      WITH
      session_usage AS (
        SELECT user_id, COUNT(*) AS sessions, MAX(started_at) AS last_activity_at
        FROM sessions
        WHERE started_at >= ${from} AND started_at <= ${to}
        GROUP BY user_id
      ),
      snippet_usage AS (
        SELECT user_id, COUNT(*) AS snippets, MAX(executed_at) AS last_activity_at
        FROM snippet_execution_events
        WHERE tenant_id = ${tenantId} AND executed_at >= ${from} AND executed_at <= ${to} AND status = 'SENT'
        GROUP BY user_id
      ),
      ssh_tunnel_usage AS (
        SELECT user_id, COUNT(*) AS sshTunnels, MAX(occurred_at) AS last_activity_at
        FROM local_access_events
        WHERE tenant_id = ${tenantId} AND occurred_at >= ${from} AND occurred_at <= ${to}
        GROUP BY user_id
      ),
      live_owned_usage AS (
        SELECT owner_user_id AS user_id, COUNT(*) AS liveOwned, MAX(created_at) AS last_activity_at
        FROM shared_sessions
        WHERE tenant_id = ${tenantId} AND created_at >= ${from} AND created_at <= ${to}
        GROUP BY owner_user_id
      ),
      live_participated_usage AS (
        SELECT user_id, COUNT(*) AS liveParticipated, MAX(joined_at) AS last_activity_at
        FROM shared_session_participants
        WHERE role = 'VIEWER' AND joined_at >= ${from} AND joined_at <= ${to}
        GROUP BY user_id
      )
    `

    const rows = await this.db.$queryRaw<UserAdoptionRow[]>(Prisma.sql`
      ${baseCtes}
      SELECT
        userId,
        userName,
        userEmail,
        sessions,
        snippets,
        sshTunnels,
        liveSessions,
        lastActivityAt
      FROM (
        SELECT
          u.id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          COALESCE(s.sessions, 0) AS sessions,
          COALESCE(sn.snippets, 0) AS snippets,
          COALESCE(la.sshTunnels, 0) AS sshTunnels,
          COALESCE(lo.liveOwned, 0) + COALESCE(lp.liveParticipated, 0) AS liveSessions,
          COALESCE(s.sessions, 0)
            + COALESCE(sn.snippets, 0)
            + COALESCE(la.sshTunnels, 0)
            + COALESCE(lo.liveOwned, 0)
            + COALESCE(lp.liveParticipated, 0) AS totalUsage,
          GREATEST(
            COALESCE(s.last_activity_at, TIMESTAMP('1970-01-01')),
            COALESCE(sn.last_activity_at, TIMESTAMP('1970-01-01')),
            COALESCE(la.last_activity_at, TIMESTAMP('1970-01-01')),
            COALESCE(lo.last_activity_at, TIMESTAMP('1970-01-01')),
            COALESCE(lp.last_activity_at, TIMESTAMP('1970-01-01'))
          ) AS lastActivityAt
        FROM users u
        LEFT JOIN session_usage s ON s.user_id = u.id
        LEFT JOIN snippet_usage sn ON sn.user_id = u.id
        LEFT JOIN ssh_tunnel_usage la ON la.user_id = u.id
        LEFT JOIN live_owned_usage lo ON lo.user_id = u.id
        LEFT JOIN live_participated_usage lp ON lp.user_id = u.id
        ${userWhereSql}
      ) adopted_users
      WHERE totalUsage > 0
      ORDER BY (sessions + snippets + sshTunnels + liveSessions) DESC, lastActivityAt DESC
      LIMIT ${limit} OFFSET ${skip}
    `)

    const totalRows = await this.db.$queryRaw<Array<{ total: number | bigint }>>(Prisma.sql`
      ${baseCtes}
      SELECT COUNT(*) AS total
      FROM (
        SELECT
          u.id,
          COALESCE(s.sessions, 0)
            + COALESCE(sn.snippets, 0)
            + COALESCE(la.sshTunnels, 0)
            + COALESCE(lo.liveOwned, 0)
            + COALESCE(lp.liveParticipated, 0) AS totalUsage
        FROM users u
        LEFT JOIN session_usage s ON s.user_id = u.id
        LEFT JOIN snippet_usage sn ON sn.user_id = u.id
        LEFT JOIN ssh_tunnel_usage la ON la.user_id = u.id
        LEFT JOIN live_owned_usage lo ON lo.user_id = u.id
        LEFT JOIN live_participated_usage lp ON lp.user_id = u.id
        ${userWhereSql}
      ) adopted_users
      WHERE totalUsage > 0
    `)

    const summaryRows = await this.db.$queryRaw<UserAdoptionSummaryRow[]>(Prisma.sql`
      ${baseCtes}
      SELECT
        COUNT(*) AS activeUsers,
        SUM(sessions) AS totalSessions,
        SUM(snippets) AS totalSnippets,
        SUM(sshTunnels) AS totalSshTunnels,
        SUM(liveSessions) AS totalLiveSessions
      FROM (
        SELECT
          u.id,
          COALESCE(s.sessions, 0) AS sessions,
          COALESCE(sn.snippets, 0) AS snippets,
          COALESCE(la.sshTunnels, 0) AS sshTunnels,
          COALESCE(lo.liveOwned, 0) + COALESCE(lp.liveParticipated, 0) AS liveSessions,
          COALESCE(s.sessions, 0)
            + COALESCE(sn.snippets, 0)
            + COALESCE(la.sshTunnels, 0)
            + COALESCE(lo.liveOwned, 0)
            + COALESCE(lp.liveParticipated, 0) AS totalUsage
        FROM users u
        LEFT JOIN session_usage s ON s.user_id = u.id
        LEFT JOIN snippet_usage sn ON sn.user_id = u.id
        LEFT JOIN ssh_tunnel_usage la ON la.user_id = u.id
        LEFT JOIN live_owned_usage lo ON lo.user_id = u.id
        LEFT JOIN live_participated_usage lp ON lp.user_id = u.id
        ${userWhereSql}
      ) usage_rows
      WHERE totalUsage > 0
    `)

    return {
      summary: summaryRows[0],
      rows,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    }
  }
}
