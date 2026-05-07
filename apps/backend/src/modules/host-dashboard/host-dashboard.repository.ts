import { Prisma, type PrismaClient } from '@prisma/client'

type ViewerRole = 'ADMIN' | 'USER'

export interface HostDashboardViewer {
  tenantId: number
  userId: number
  role: ViewerRole
  userGroupIds: number[]
}

export interface HostDashboardHostRow {
  id: number
  name: string
  ip: string
  port: number
  sshUser: string
  deletedAt: Date | null
  scope: 'PERSONAL' | 'TEAM' | 'GLOBAL'
  connectionMode: 'DIRECT' | 'AGENT' | 'AGENT_USER' | 'AGENT_TENANT_FALLBACK' | 'AUTO'
  trustedHostKeyVerifiedAt: Date | null
  bastion: { id: number; name: string } | null
  group: { id: number; name: string; bastion: { id: number; name: string } | null } | null
  tags: Array<{ tag: { id: number; name: string; color: string | null } }>
  associatedLinks: Array<{ id: number }>
}

export interface HostDashboardDailyRow {
  date: string
  sessions: number | bigint
  failedSessions: number | bigint
}

export interface HostDashboardOriginRow {
  ip: string
  count: number | bigint
  lastSeenAt: Date
}

export interface HostDashboardTimelineRow {
  id: string
  type: 'session' | 'audit' | 'sharing'
  title: string
  description: string
  occurredAt: Date
  severity: 'info' | 'success' | 'warning' | 'error'
  sessionId: number | null
}

export class HostDashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  async findVisibleHost(hostId: number, viewer: HostDashboardViewer): Promise<HostDashboardHostRow | null> {
    return this.db.host.findFirst({
      where: {
        id: hostId,
        tenantId: viewer.tenantId,
        ...(viewer.role === 'USER'
          ? {
              deletedAt: null,
              OR: [
                { scope: 'PERSONAL', ownerId: viewer.userId },
                { scope: 'TEAM', groupId: { in: viewer.userGroupIds } },
                { scope: 'GLOBAL' },
              ],
            }
          : {}),
      },
      include: {
        bastion: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, bastion: { select: { id: true, name: true } } } },
        tags: { include: { tag: true } },
        associatedLinks: { select: { id: true }, where: { enabled: true } },
      },
    }) as Promise<HostDashboardHostRow | null>
  }

  async getSummary(hostId: number, viewer: HostDashboardViewer, from: Date) {
    const ownActivityOnly = viewer.role === 'USER'
    const sessionWhere = {
      hostId,
      startedAt: { gte: from },
      ...(ownActivityOnly ? { userId: viewer.userId } : {}),
    }
    const auditWhere = {
      hostId,
      tenantId: viewer.tenantId,
      startedAt: { gte: from },
      ...(ownActivityOnly ? { userId: viewer.userId } : {}),
    }
    const sharedWhere = {
      hostId,
      tenantId: viewer.tenantId,
      createdAt: { gte: from },
      ...(ownActivityOnly ? { ownerUserId: viewer.userId } : {}),
    }

    const [
      sessions,
      activeSessions,
      failedSessions,
      uniqueUserRows,
      audits,
      auditBytes,
      auditEvents,
      sharedSessions,
      activeSharedSessions,
      forwardings,
      webForwardings,
      auditStatusRows,
      auditRiskRows,
    ] = await this.db.$transaction([
      this.db.session.count({ where: sessionWhere }),
      this.db.session.count({ where: { hostId, active: true, ...(ownActivityOnly ? { userId: viewer.userId } : {}) } }),
      this.db.session.count({
        where: {
          ...sessionWhere,
          OR: [
            { errorCode: { not: null } },
            { endedReason: 'error' },
          ],
        },
      }),
      this.db.session.groupBy({
        by: ['userId'],
        where: sessionWhere,
        orderBy: { userId: 'asc' },
      }),
      this.db.sessionAudit.count({ where: auditWhere }),
      this.db.sessionAudit.aggregate({
        where: auditWhere,
        _sum: { bytesIn: true, bytesOut: true },
      }),
      this.db.sessionAuditChunk.aggregate({
        where: { sessionAudit: auditWhere },
        _sum: { eventCount: true },
      }),
      this.db.sharedSession.count({ where: sharedWhere }),
      this.db.sharedSession.count({ where: { ...sharedWhere, status: 'ACTIVE' } }),
      this.db.portForwarding.count({ where: { hostId } }),
      this.db.portForwarding.count({ where: { hostId, webEnabled: true } }),
      this.db.sessionAudit.groupBy({
        by: ['status'],
        where: auditWhere,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
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
      uniqueUsers: ownActivityOnly ? null : uniqueUserRows.length,
      audits,
      auditEvents: auditEvents._sum.eventCount ?? 0,
      bytesIn: auditBytes._sum.bytesIn ?? BigInt(0),
      bytesOut: auditBytes._sum.bytesOut ?? BigInt(0),
      sharedSessions,
      activeSharedSessions,
      forwardings,
      webForwardings,
      auditStatusRows,
      auditRiskRows,
    }
  }

  async getDailySeries(hostId: number, viewer: HostDashboardViewer, from: Date): Promise<HostDashboardDailyRow[]> {
    const userFilter = viewer.role === 'USER' ? Prisma.sql`AND s.user_id = ${viewer.userId}` : Prisma.empty
    return this.db.$queryRaw<HostDashboardDailyRow[]>(Prisma.sql`
      SELECT
        DATE(s.started_at) AS date,
        COUNT(*) AS sessions,
        SUM(CASE WHEN s.error_code IS NOT NULL OR s.ended_reason = 'error' THEN 1 ELSE 0 END) AS failedSessions
      FROM sessions s
      JOIN hosts h ON h.id = s.host_id
      WHERE h.tenant_id = ${viewer.tenantId}
        AND s.host_id = ${hostId}
        AND s.started_at >= ${from}
        ${userFilter}
      GROUP BY DATE(s.started_at)
      ORDER BY DATE(s.started_at) ASC
    `)
  }

  async getRouteDistribution(hostId: number, viewer: HostDashboardViewer, from: Date) {
    return this.db.session.groupBy({
      by: ['connectionMethod'],
      where: {
        hostId,
        startedAt: { gte: from },
        ...(viewer.role === 'USER' ? { userId: viewer.userId } : {}),
      },
      _count: { connectionMethod: true },
      orderBy: { _count: { connectionMethod: 'desc' } },
    })
  }

  async getOriginDistribution(hostId: number, viewer: HostDashboardViewer, from: Date): Promise<HostDashboardOriginRow[]> {
    const userFilter = viewer.role === 'USER' ? Prisma.sql`AND s.user_id = ${viewer.userId}` : Prisma.empty
    return this.db.$queryRaw<HostDashboardOriginRow[]>(Prisma.sql`
      SELECT
        COALESCE(s.agent_remote_ip, s.client_ip) AS ip,
        COUNT(*) AS count,
        MAX(s.started_at) AS lastSeenAt
      FROM sessions s
      JOIN hosts h ON h.id = s.host_id
      WHERE h.tenant_id = ${viewer.tenantId}
        AND s.host_id = ${hostId}
        AND s.started_at >= ${from}
        AND COALESCE(s.agent_remote_ip, s.client_ip) IS NOT NULL
        ${userFilter}
      GROUP BY COALESCE(s.agent_remote_ip, s.client_ip)
      ORDER BY count DESC, lastSeenAt DESC
      LIMIT 8
    `)
  }

  async getRecentSessions(hostId: number, viewer: HostDashboardViewer, from: Date) {
    return this.db.session.findMany({
      where: {
        hostId,
        startedAt: { gte: from },
        ...(viewer.role === 'USER' ? { userId: viewer.userId } : {}),
      },
      include: {
        user: { select: { name: true, email: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 8,
    })
  }

  async getTimeline(hostId: number, viewer: HostDashboardViewer, from: Date): Promise<HostDashboardTimelineRow[]> {
    const sessionUserFilter = viewer.role === 'USER' ? Prisma.sql`AND s.user_id = ${viewer.userId}` : Prisma.empty
    const auditUserFilter = viewer.role === 'USER' ? Prisma.sql`AND sa.user_id = ${viewer.userId}` : Prisma.empty
    const sharingUserFilter = viewer.role === 'USER' ? Prisma.sql`AND ss.owner_user_id = ${viewer.userId}` : Prisma.empty

    return this.db.$queryRaw<HostDashboardTimelineRow[]>(Prisma.sql`
      SELECT * FROM (
        SELECT
          CONCAT('session-', s.id) AS id,
          'session' AS type,
          CASE
            WHEN s.error_code IS NOT NULL THEN 'Sessao com falha'
            WHEN s.active = 1 THEN 'Sessao ativa'
            ELSE 'Sessao iniciada'
          END AS title,
          CONCAT(u.name, ' via ', COALESCE(s.connection_method, 'direct')) AS description,
          s.started_at AS occurredAt,
          CASE
            WHEN s.error_code IS NOT NULL THEN 'error'
            WHEN s.active = 1 THEN 'success'
            ELSE 'info'
          END AS severity,
          s.id AS sessionId
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        WHERE h.tenant_id = ${viewer.tenantId}
          AND s.host_id = ${hostId}
          AND s.started_at >= ${from}
          ${sessionUserFilter}

        UNION ALL

        SELECT
          CONCAT('audit-', sa.session_id) AS id,
          'audit' AS type,
          CASE
            WHEN sa.status = 'FAILED' THEN 'Auditoria com falha'
            WHEN sa.status = 'COMPLETED' THEN 'Auditoria concluida'
            ELSE 'Auditoria em andamento'
          END AS title,
          CONCAT(sa.user_name_snapshot, ' - ', sa.chunk_count, ' chunks') AS description,
          COALESCE(sa.ended_at, sa.started_at) AS occurredAt,
          CASE
            WHEN sa.status = 'FAILED' THEN 'error'
            WHEN sa.status = 'COMPLETED' THEN 'success'
            ELSE 'warning'
          END AS severity,
          sa.session_id AS sessionId
        FROM session_audits sa
        WHERE sa.tenant_id = ${viewer.tenantId}
          AND sa.host_id = ${hostId}
          AND sa.started_at >= ${from}
          ${auditUserFilter}

        UNION ALL

        SELECT
          CONCAT('sharing-', ss.id) AS id,
          'sharing' AS type,
          'Sessao compartilhada' AS title,
          CONCAT(u.name, ' - ', ss.status) AS description,
          ss.created_at AS occurredAt,
          CASE
            WHEN ss.status = 'ACTIVE' THEN 'success'
            WHEN ss.status = 'REVOKED' THEN 'warning'
            ELSE 'info'
          END AS severity,
          ss.session_id AS sessionId
        FROM shared_sessions ss
        INNER JOIN users u ON u.id = ss.owner_user_id
        WHERE ss.tenant_id = ${viewer.tenantId}
          AND ss.host_id = ${hostId}
          AND ss.created_at >= ${from}
          ${sharingUserFilter}
      ) timeline
      ORDER BY occurredAt DESC
      LIMIT 16
    `)
  }
}
