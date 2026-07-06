import { Prisma, type PrismaClient } from '@prisma/client'

const HOST_KEY_ACTIONS = ['HOST_KEY_TRUSTED', 'HOST_KEY_UPDATED'] as const

export interface HostKeyReportFilters {
  dateFrom: Date
  dateTo: Date
  search?: string
  action?: string
  userId?: number
  hostId?: number
  page?: number
  limit?: number
}

export interface HostKeySummaryRow {
  totalHosts: number | bigint
  trustedHosts: number | bigint
  missingHosts: number | bigint
  trustedEvents: number | bigint
  updatedEvents: number | bigint
  uniqueHostsWithEvents: number | bigint
}

export interface HostKeyEventRow {
  id: number
  action: string
  details: string | null
  timestamp: Date
  userId: number
  userName: string
  userEmail: string
  hostId: number | null
  hostName: string | null
  hostIp: string | null
  hostPort: number | null
  hostScope: string | null
  hostDeletedAt: Date | null
  currentFingerprint: string | null
  lastVerifiedAt: Date | null
}

export interface HostKeyMissingHostRow {
  hostId: number
  hostName: string
  hostIp: string
  hostPort: number
  hostScope: string
}

function buildEventWhere(tenantId: number, filters: HostKeyReportFilters) {
  const where: Prisma.Sql[] = [
    Prisma.sql`u.tenant_id = ${tenantId}`,
    Prisma.sql`l.target_type = 'Host'`,
    Prisma.sql`l.action IN (${Prisma.join(HOST_KEY_ACTIONS)})`,
    Prisma.sql`l.timestamp >= ${filters.dateFrom}`,
    Prisma.sql`l.timestamp <= ${filters.dateTo}`,
  ]

  if (filters.action !== undefined) where.push(Prisma.sql`l.action = ${filters.action}`)
  if (filters.userId !== undefined) where.push(Prisma.sql`l.admin_id = ${filters.userId}`)
  if (filters.hostId !== undefined) where.push(Prisma.sql`l.target_id = ${filters.hostId}`)
  if (filters.search !== undefined) {
    const like = `%${filters.search}%`
    where.push(Prisma.sql`(
      u.name LIKE ${like}
      OR u.email LIKE ${like}
      OR h.name LIKE ${like}
      OR h.ip LIKE ${like}
      OR l.action LIKE ${like}
      OR COALESCE(l.details, '') LIKE ${like}
      OR COALESCE(h.trusted_host_key_fingerprint, '') LIKE ${like}
    )`)
  }

  const combined = where.slice(1).reduce(
    (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
    where[0]!,
  )
  return Prisma.sql`WHERE ${combined}`
}

export class HostKeyReportRepository {
  constructor(private readonly db: PrismaClient) {}

  async getReport(tenantId: number, filters: HostKeyReportFilters) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const skip = (page - 1) * limit
    const whereSql = buildEventWhere(tenantId, filters)

    const [summaryRows, events, totalRows, missingHosts] = await Promise.all([
      this.db.$queryRaw<HostKeySummaryRow[]>(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM hosts h WHERE h.tenant_id = ${tenantId} AND h.deleted_at IS NULL) AS totalHosts,
          (SELECT COUNT(*) FROM hosts h WHERE h.tenant_id = ${tenantId} AND h.deleted_at IS NULL AND h.trusted_host_key_fingerprint IS NOT NULL) AS trustedHosts,
          (SELECT COUNT(*) FROM hosts h WHERE h.tenant_id = ${tenantId} AND h.deleted_at IS NULL AND h.trusted_host_key_fingerprint IS NULL) AS missingHosts,
          SUM(CASE WHEN l.action = 'HOST_KEY_TRUSTED' THEN 1 ELSE 0 END) AS trustedEvents,
          SUM(CASE WHEN l.action = 'HOST_KEY_UPDATED' THEN 1 ELSE 0 END) AS updatedEvents,
          COUNT(DISTINCT l.target_id) AS uniqueHostsWithEvents
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        LEFT JOIN hosts h ON h.id = l.target_id AND h.tenant_id = u.tenant_id
        ${whereSql}
      `),
      this.db.$queryRaw<HostKeyEventRow[]>(Prisma.sql`
        SELECT
          l.id,
          l.action,
          l.details,
          l.timestamp,
          l.admin_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          h.id AS hostId,
          h.name AS hostName,
          h.ip AS hostIp,
          h.port AS hostPort,
          h.scope AS hostScope,
          h.deleted_at AS hostDeletedAt,
          h.trusted_host_key_fingerprint AS currentFingerprint,
          h.trusted_host_key_verified_at AS lastVerifiedAt
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        LEFT JOIN hosts h ON h.id = l.target_id AND h.tenant_id = u.tenant_id
        ${whereSql}
        ORDER BY l.timestamp DESC
        LIMIT ${limit} OFFSET ${skip}
      `),
      this.db.$queryRaw<Array<{ total: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM admin_logs l
        INNER JOIN users u ON u.id = l.admin_id
        LEFT JOIN hosts h ON h.id = l.target_id AND h.tenant_id = u.tenant_id
        ${whereSql}
      `),
      this.db.$queryRaw<HostKeyMissingHostRow[]>(Prisma.sql`
        SELECT
          h.id AS hostId,
          h.name AS hostName,
          h.ip AS hostIp,
          h.port AS hostPort,
          h.scope AS hostScope
        FROM hosts h
        WHERE h.tenant_id = ${tenantId}
          AND h.deleted_at IS NULL
          AND h.trusted_host_key_fingerprint IS NULL
        ORDER BY h.name ASC
        LIMIT 12
      `),
    ])

    return {
      summary: summaryRows[0],
      events,
      missingHosts,
      total: Number(totalRows[0]?.total ?? 0),
      page,
      limit,
    }
  }
}
