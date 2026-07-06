import { Prisma, type PrismaClient } from '@prisma/client'

export interface SshTunnelReportFilters {
  dateFrom: Date
  dateTo: Date
  search?: string
  type?: string
  userId?: number
  forwardingId?: number
  hostId?: number
  page?: number
  limit?: number
}

export interface SshTunnelSummaryRow {
  totalAccesses: number | bigint
  webAccesses: number | bigint
  tunnelAccesses: number | bigint
  uniqueUsers: number | bigint
  uniqueForwardings: number | bigint
}

export interface SshTunnelTopForwardingRow {
  forwardingId: number | null
  label: string | null
  hostId: number | null
  hostName: string | null
  remoteHost: string
  remotePort: number
  count: number | bigint
}

export interface SshTunnelTopUserRow {
  userId: number
  userName: string
  userEmail: string
  count: number | bigint
}

export interface SshTunnelEventRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  forwardingId: number | null
  label: string | null
  hostId: number | null
  hostName: string | null
  remoteHost: string
  remotePort: number
  type: string
  timestamp: Date
}

function buildWhere(tenantId: number, filters: SshTunnelReportFilters) {
  const where: Prisma.Sql[] = [
    Prisma.sql`e.tenant_id = ${tenantId}`,
    Prisma.sql`e.occurred_at >= ${filters.dateFrom}`,
    Prisma.sql`e.occurred_at <= ${filters.dateTo}`,
  ]

  if (filters.type === 'web') where.push(Prisma.sql`e.event_type = 'WEB'`)
  if (filters.type === 'tunnel') where.push(Prisma.sql`e.event_type = 'TUNNEL'`)
  if (filters.userId !== undefined) where.push(Prisma.sql`e.user_id = ${filters.userId}`)
  if (filters.forwardingId !== undefined) where.push(Prisma.sql`e.forwarding_id = ${filters.forwardingId}`)
  if (filters.hostId !== undefined) where.push(Prisma.sql`e.host_id = ${filters.hostId}`)
  if (filters.search !== undefined) {
    const like = `%${filters.search}%`
    where.push(Prisma.sql`(
      u.name LIKE ${like}
      OR u.email LIKE ${like}
      OR COALESCE(e.host_name_snapshot, '') LIKE ${like}
      OR e.remote_host_snapshot LIKE ${like}
      OR COALESCE(e.label_snapshot, '') LIKE ${like}
    )`)
  }

  const combined = where.slice(1).reduce(
    (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
    where[0]!,
  )
  return Prisma.sql`WHERE ${combined}`
}

export class SshTunnelReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async getReport(tenantId: number, filters: SshTunnelReportFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const skip = (page - 1) * limit
    const whereSql = buildWhere(tenantId, filters)

    const [summaryRows, topForwardings, topUsers, events, totalRows] = await Promise.all([
      this.db.$queryRaw<SshTunnelSummaryRow[]>(Prisma.sql`
        SELECT
          COUNT(*) AS totalAccesses,
          SUM(CASE WHEN e.event_type = 'WEB' THEN 1 ELSE 0 END) AS webAccesses,
          SUM(CASE WHEN e.event_type = 'TUNNEL' THEN 1 ELSE 0 END) AS tunnelAccesses,
          COUNT(DISTINCT e.user_id) AS uniqueUsers,
          COUNT(DISTINCT e.forwarding_id) AS uniqueForwardings
        FROM local_access_events e
        INNER JOIN users u ON u.id = e.user_id
        ${whereSql}
      `),
      this.db.$queryRaw<SshTunnelTopForwardingRow[]>(Prisma.sql`
        SELECT
          e.forwarding_id AS forwardingId,
          e.label_snapshot AS label,
          e.host_id AS hostId,
          e.host_name_snapshot AS hostName,
          e.remote_host_snapshot AS remoteHost,
          e.remote_port_snapshot AS remotePort,
          COUNT(*) AS count
        FROM local_access_events e
        INNER JOIN users u ON u.id = e.user_id
        ${whereSql}
        GROUP BY e.forwarding_id, e.label_snapshot, e.host_id, e.host_name_snapshot, e.remote_host_snapshot, e.remote_port_snapshot
        ORDER BY count DESC
        LIMIT 8
      `),
      this.db.$queryRaw<SshTunnelTopUserRow[]>(Prisma.sql`
        SELECT
          e.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          COUNT(*) AS count
        FROM local_access_events e
        INNER JOIN users u ON u.id = e.user_id
        ${whereSql}
        GROUP BY e.user_id, u.name, u.email
        ORDER BY count DESC
        LIMIT 8
      `),
      this.db.$queryRaw<SshTunnelEventRow[]>(Prisma.sql`
        SELECT
          e.id,
          e.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          e.forwarding_id AS forwardingId,
          e.label_snapshot AS label,
          e.host_id AS hostId,
          e.host_name_snapshot AS hostName,
          e.remote_host_snapshot AS remoteHost,
          e.remote_port_snapshot AS remotePort,
          CASE WHEN e.event_type = 'WEB' THEN 'web' ELSE 'tunnel' END AS type,
          e.occurred_at AS timestamp
        FROM local_access_events e
        INNER JOIN users u ON u.id = e.user_id
        ${whereSql}
        ORDER BY e.occurred_at DESC
        LIMIT ${limit} OFFSET ${skip}
      `),
      this.db.$queryRaw<Array<{ total: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM local_access_events e
        INNER JOIN users u ON u.id = e.user_id
        ${whereSql}
      `),
    ])

    return {
      summary: summaryRows[0],
      topForwardings,
      topUsers,
      events,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    }
  }
}
