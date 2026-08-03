import { Prisma, type PrismaClient } from '@prisma/client'
import { endStaleActiveSessions } from '../sessions/session-liveness.js'

// ─── Tipos da camada de repo ──────────────────────────────────────────────────

export interface UserDashboardDailyRow {
  date: string
  sessions: number | bigint
  failedSessions: number | bigint
}

export interface UserDashboardTopHostRow {
  hostId: number
  hostName: string
  hostIp: string
  hostDeleted: boolean | number
  count: number | bigint
  lastSeenAt: Date
}

export interface UserDashboardTimelineRow {
  id: string
  type: 'session' | 'audit' | 'sharing'
  hostId: number
  title: string
  description: string
  hostDeleted: boolean | number
  occurredAt: Date
  severity: 'info' | 'success' | 'warning' | 'error'
  sessionId: number | null
}

interface LegacySnippetUsageRow {
  targetId: number
  count: number | bigint
}

export class UserDashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUser(userId: number, tenantId: number) {
    return this.db.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, name: true, email: true, role: true },
    })
  }

  async getSummary(tenantId: number, userId: number, from: Date) {
    const sessionWhere = { userId, startedAt: { gte: from } } as const
    const auditWhere = { userId, tenantId, startedAt: { gte: from } } as const

    const [
      sessions,
      activeSessions,
      failedSessions,
      uniqueHostRows,
      audits,
      auditBytes,
      auditEvents,
      sharedOwned,
      sharedParticipated,
      auditStatusRows,
      auditRiskRows,
    ] = await this.db.$transaction([
      this.db.session.count({ where: sessionWhere }),
      this.db.session.count({ where: { userId, active: true } }),
      this.db.session.count({
        where: { ...sessionWhere, OR: [{ errorCode: { not: null } }, { endedReason: 'error' }] },
      }),
      this.db.session.groupBy({ by: ['hostId'], where: sessionWhere, orderBy: { hostId: 'asc' } }),
      this.db.sessionAudit.count({ where: auditWhere }),
      this.db.sessionAudit.aggregate({ where: auditWhere, _sum: { bytesIn: true, bytesOut: true } }),
      this.db.sessionAuditChunk.aggregate({ where: { sessionAudit: auditWhere }, _sum: { eventCount: true } }),
      this.db.sharedSession.count({ where: { ownerUserId: userId, tenantId, createdAt: { gte: from } } }),
      this.db.sharedSessionParticipant.count({ where: { userId, role: 'VIEWER', joinedAt: { gte: from } } }),
      this.db.sessionAudit.groupBy({ by: ['status'], where: auditWhere, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.db.sessionAudit.groupBy({
        by: ['aiRiskLevel'],
        where: { ...auditWhere, aiRiskLevel: { not: null } },
        _count: { _all: true },
        orderBy: { aiRiskLevel: 'asc' },
      }),
    ])

    return {
      sessions,
      activeSessions,
      failedSessions,
      hostsAccessed: uniqueHostRows.length,
      audits,
      auditEvents: auditEvents._sum.eventCount ?? 0,
      bytesIn: auditBytes._sum.bytesIn ?? BigInt(0),
      bytesOut: auditBytes._sum.bytesOut ?? BigInt(0),
      sharedOwned,
      sharedParticipated,
      auditStatusRows,
      auditRiskRows,
    }
  }

  async getDailySeries(tenantId: number, userId: number, from: Date): Promise<UserDashboardDailyRow[]> {
    return this.db.$queryRaw<UserDashboardDailyRow[]>(Prisma.sql`
      SELECT
        DATE(s.started_at) AS date,
        COUNT(*) AS sessions,
        SUM(CASE WHEN s.error_code IS NOT NULL OR s.ended_reason = 'error' THEN 1 ELSE 0 END) AS failedSessions
      FROM sessions s
      JOIN hosts h ON h.id = s.host_id
      WHERE h.tenant_id = ${tenantId}
        AND s.user_id = ${userId}
        AND s.started_at >= ${from}
      GROUP BY DATE(s.started_at)
      ORDER BY DATE(s.started_at) ASC
    `)
  }

  async getTopHosts(tenantId: number, userId: number, from: Date): Promise<UserDashboardTopHostRow[]> {
    return this.db.$queryRaw<UserDashboardTopHostRow[]>(Prisma.sql`
      SELECT
        h.id AS hostId,
        h.name AS hostName,
        h.ip AS hostIp,
        (h.deleted_at IS NOT NULL) AS hostDeleted,
        COUNT(*) AS count,
        MAX(s.started_at) AS lastSeenAt
      FROM sessions s
      JOIN hosts h ON h.id = s.host_id
      WHERE h.tenant_id = ${tenantId}
        AND s.user_id = ${userId}
        AND s.started_at >= ${from}
      GROUP BY h.id, h.name, h.ip
      ORDER BY count DESC, lastSeenAt DESC
      LIMIT 8
    `)
  }

  async getRecentSessions(tenantId: number, userId: number, from: Date) {
    return this.db.session.findMany({
      where: { userId, startedAt: { gte: from } },
      include: { host: { select: { name: true, ip: true, tenantId: true, deletedAt: true } } },
      orderBy: { startedAt: 'desc' },
      take: 8,
    })
  }

  async getTimeline(tenantId: number, userId: number, from: Date): Promise<UserDashboardTimelineRow[]> {
    return this.db.$queryRaw<UserDashboardTimelineRow[]>(Prisma.sql`
      SELECT * FROM (
        SELECT
          CONCAT('session-', s.id) AS id,
          'session' AS type,
          h.id AS hostId,
          CASE
            WHEN s.error_code IS NOT NULL THEN 'Sessao com falha'
            WHEN s.active = 1 THEN 'Sessao ativa'
            ELSE 'Sessao encerrada'
          END AS title,
          CONCAT(h.name, ' (', h.ip, ')') AS description,
          (h.deleted_at IS NOT NULL) AS hostDeleted,
          s.started_at AS occurredAt,
          CASE
            WHEN s.error_code IS NOT NULL THEN 'error'
            WHEN s.active = 1 THEN 'success'
            ELSE 'info'
          END AS severity,
          s.id AS sessionId
        FROM sessions s
        JOIN hosts h ON h.id = s.host_id
        WHERE h.tenant_id = ${tenantId}
          AND s.user_id = ${userId}
          AND s.started_at >= ${from}

        UNION ALL

        SELECT
          CONCAT('audit-', sa.session_id) AS id,
          'audit' AS type,
          h.id AS hostId,
          CASE
            WHEN sa.status = 'FAILED' THEN 'Auditoria com falha'
            WHEN sa.status = 'COMPLETED' THEN 'Auditoria concluida'
            ELSE 'Auditoria em andamento'
          END AS title,
          CONCAT(h.name, ' - ', sa.chunk_count, ' chunks') AS description,
          (h.deleted_at IS NOT NULL) AS hostDeleted,
          COALESCE(sa.ended_at, sa.started_at) AS occurredAt,
          CASE
            WHEN sa.status = 'FAILED' THEN 'error'
            WHEN sa.status = 'COMPLETED' THEN 'success'
            ELSE 'warning'
          END AS severity,
          sa.session_id AS sessionId
        FROM session_audits sa
        JOIN hosts h ON h.id = sa.host_id
        WHERE sa.tenant_id = ${tenantId}
          AND sa.user_id = ${userId}
          AND sa.started_at >= ${from}

        UNION ALL

        SELECT
          CONCAT('sharing-', ss.id) AS id,
          'sharing' AS type,
          h.id AS hostId,
          'Sessao compartilhada' AS title,
          CONCAT(h.name, ' - ', ss.status) AS description,
          (h.deleted_at IS NOT NULL) AS hostDeleted,
          ss.created_at AS occurredAt,
          CASE
            WHEN ss.status = 'ACTIVE' THEN 'success'
            WHEN ss.status = 'REVOKED' THEN 'warning'
            ELSE 'info'
          END AS severity,
          ss.session_id AS sessionId
        FROM shared_sessions ss
        JOIN hosts h ON h.id = ss.host_id
        WHERE ss.tenant_id = ${tenantId}
          AND ss.owner_user_id = ${userId}
          AND ss.created_at >= ${from}
      ) timeline
      ORDER BY occurredAt DESC
      LIMIT 20
    `)
  }

  // Método legado mantido para backward compat com /summary endpoint
  async getSummaryLegacy(tenantId: number, userId: number): Promise<{
    activeSessions: number
    totalSessionsLast30Days: number
    uniqueHostsLast30Days: number
    totalSnippetExecutionsLast30Days: number
    totalSshTunnelsLast30Days: number
    sharedSessionsOwnedLast30Days: number
    sharedSessionsParticipatedLast30Days: number
    topHostsLast30Days: Array<{
      hostId: number
      hostName: string
      hostIp: string
      hostDeleted: boolean
      accessCount: number
      lastAccessedAt: Date
    }>
    topSnippetsLast30Days: Array<{ snippetId: number; snippetName: string; usageCount: number }>
    topSshTunnelsLast30Days: Array<{ forwardingId: number; label: string; hostId: number; hostName: string; usageCount: number }>
    weeklyActivityLast4Weeks: Array<{ periodStart: Date; periodEnd: Date; sessions: number; sharedSessions: number }>
  }> {
    await endStaleActiveSessions(this.db)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [
      activeSessions,
      totalSessionsLast30Days,
      groupedHosts,
      groupedSnippets,
      totalSnippetExecutionsRows,
      totalSshTunnelRows,
      sharedSessionsOwnedLast30Days,
      sharedSessionsParticipatedLast30Days,
      sessionTrendRows,
      sharedOwnedTrendRows,
      sharedParticipantTrendRows,
    ] = await Promise.all([
      this.db.session.count({ where: { userId, active: true } }),
      this.db.session.count({ where: { userId, startedAt: { gte: since } } }),
      this.db.session.groupBy({
        by: ['hostId'],
        where: { userId, startedAt: { gte: since } },
        _count: { hostId: true },
        _max: { startedAt: true },
        orderBy: { _count: { hostId: 'desc' } },
        take: 5,
      }),
      this.db.$queryRaw<LegacySnippetUsageRow[]>`
        SELECT snippet_id AS targetId, COUNT(*) AS count
        FROM snippet_execution_events
        WHERE tenant_id = ${tenantId}
          AND user_id = ${userId}
          AND executed_at >= ${since}
          AND status = 'SENT'
          AND snippet_id IS NOT NULL
        GROUP BY snippet_id
        ORDER BY count DESC
        LIMIT 5
      `,
      this.db.$queryRaw<Array<{ count: number | bigint }>>`
        SELECT COUNT(*) AS count
        FROM snippet_execution_events
        WHERE tenant_id = ${tenantId}
          AND user_id = ${userId}
          AND executed_at >= ${since}
          AND status = 'SENT'
      `,
      this.db.$queryRaw<Array<{ count: number | bigint }>>`
        SELECT COUNT(*) AS count
        FROM local_access_events
        WHERE tenant_id = ${tenantId}
          AND user_id = ${userId}
          AND occurred_at >= ${since}
      `,
      this.db.sharedSession.count({ where: { ownerUserId: userId, createdAt: { gte: since } } }),
      this.db.sharedSessionParticipant.count({ where: { userId, role: 'VIEWER', joinedAt: { gte: since } } }),
      this.db.session.findMany({ where: { userId, startedAt: { gte: since } }, select: { startedAt: true } }),
      this.db.sharedSession.findMany({ where: { ownerUserId: userId, createdAt: { gte: since } }, select: { createdAt: true } }),
      this.db.sharedSessionParticipant.findMany({ where: { userId, role: 'VIEWER', joinedAt: { gte: since } }, select: { joinedAt: true } }),
    ])

    const uniqueHostsLast30Days = await this.db.session.groupBy({
      by: ['hostId'],
      where: { userId, startedAt: { gte: since } },
    })

    const hosts = groupedHosts.length
      ? await this.db.host.findMany({
          where: { id: { in: groupedHosts.map((r) => r.hostId) } },
          select: { id: true, name: true, ip: true, deletedAt: true },
        })
      : []
    const snippets = groupedSnippets.length
      ? await this.db.snippet.findMany({
          where: { id: { in: groupedSnippets.map((r) => r.targetId) }, tenantId },
          select: { id: true, name: true },
        })
      : []
    const groupedSshTunnelRows = await this.db.$queryRaw<Array<{ targetId: number; count: number | bigint }>>`
      SELECT forwarding_id AS targetId, COUNT(*) AS count
      FROM local_access_events
      WHERE tenant_id = ${tenantId}
        AND user_id = ${userId}
        AND occurred_at >= ${since}
        AND forwarding_id IS NOT NULL
      GROUP BY forwarding_id
      ORDER BY count DESC
      LIMIT 5
    `

    const forwardings = groupedSshTunnelRows.length
      ? await this.db.portForwarding.findMany({
          where: { id: { in: groupedSshTunnelRows.map((r) => r.targetId) } },
          select: {
            id: true,
            description: true,
            remoteHost: true,
            remotePort: true,
            hostId: true,
            host: { select: { name: true } },
          },
        })
      : []

    const hostMap = new Map(hosts.map((h) => [h.id, h]))
    const snippetMap = new Map(snippets.map((s) => [s.id, s]))
    const forwardingMap = new Map(forwardings.map((f) => [f.id, f]))

    const now = new Date()
    const totalWindowMs = now.getTime() - since.getTime()
    const bucketSizeMs = totalWindowMs / 4
    const weeklyActivityLast4Weeks = Array.from({ length: 4 }, (_, i) => {
      const periodStart = new Date(since.getTime() + i * bucketSizeMs)
      const periodEnd = i === 3 ? new Date(now) : new Date(since.getTime() + (i + 1) * bucketSizeMs)
      const sessions = sessionTrendRows.filter((r) => r.startedAt >= periodStart && r.startedAt < periodEnd).length
      const sharedSessions = [
        ...sharedOwnedTrendRows.map((r) => r.createdAt),
        ...sharedParticipantTrendRows.map((r) => r.joinedAt),
      ].filter((d) => d >= periodStart && d < periodEnd).length
      return { periodStart, periodEnd, sessions, sharedSessions }
    })

    return {
      activeSessions,
      totalSessionsLast30Days,
      uniqueHostsLast30Days: uniqueHostsLast30Days.length,
      totalSnippetExecutionsLast30Days: Number(totalSnippetExecutionsRows[0]?.count ?? 0),
      totalSshTunnelsLast30Days: Number(totalSshTunnelRows[0]?.count ?? 0),
      sharedSessionsOwnedLast30Days,
      sharedSessionsParticipatedLast30Days,
      topHostsLast30Days: groupedHosts
        .map((r) => {
          const h = hostMap.get(r.hostId)
          if (!h || !r._max.startedAt) return null
          return {
            hostId: r.hostId,
            hostName: h.name,
            hostIp: h.ip,
            hostDeleted: h.deletedAt !== null,
            accessCount: r._count.hostId,
            lastAccessedAt: r._max.startedAt,
          }
        })
        .filter((r): r is NonNullable<typeof r> => !!r),
      topSnippetsLast30Days: groupedSnippets
        .map((r) => {
          const s = snippetMap.get(r.targetId)
          if (!s) return null
          return { snippetId: s.id, snippetName: s.name, usageCount: Number(r.count) }
        })
        .filter((r): r is NonNullable<typeof r> => !!r),
      topSshTunnelsLast30Days: groupedSshTunnelRows
        .map((r) => {
          const f = forwardingMap.get(r.targetId)
          if (!f) return null
          return {
            forwardingId: f.id,
            label: f.description?.trim() || `${f.remoteHost}:${f.remotePort}`,
            hostId: f.hostId,
            hostName: f.host.name,
            usageCount: Number(r.count),
          }
        })
        .filter((r): r is NonNullable<typeof r> => !!r),
      weeklyActivityLast4Weeks,
    }
  }
}
