import type { PrismaClient } from '@prisma/client'
import type { AuthLogRow } from '../logs/log.repository.js'
import { endStaleActiveSessions } from '../sessions/session-liveness.js'

const authLogInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const

const screenLabelMap: Record<number, string> = {
  1: 'Início',
  2: 'Hosts',
  3: 'Terminal',
  4: 'Arquivos',
  5: 'Snippets',
  6: 'Acessos locais',
  7: 'Perfil',
  100: 'Admin dashboard',
  101: 'Admin logs',
  102: 'Admin sessões',
  103: 'Admin auditoria SSH',
  104: 'Admin usuários',
  105: 'Admin grupos',
  106: 'Admin integrações',
  107: 'Admin configurações',
}

export class DashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  async getStats(tenantId: number, periodDays = 30): Promise<{
    activeUsers:    number
    maxUsers:       number | null
    totalHosts:     number
    activeSessions: number
    sessionsToday:  number
    clientUx:       {
      current: {
        sessionExpired: number
        sessionExpiredTerminal: number
        staleReloadRecovered: number
        staleReloadFailed: number
      }
      previous: {
        sessionExpired: number
        sessionExpiredTerminal: number
        staleReloadRecovered: number
        staleReloadFailed: number
      }
    }
    hostKey: {
      current: {
        trusted: number
        updated: number
      }
      previous: {
        trusted: number
        updated: number
      }
    }
    adoption: {
      topActiveUsers: Array<{
        userId: number
        userName: string
        userEmail: string | null
        sessionCount: number
        lastAccessedAt: Date
        primaryHostName: string | null
      }>
      topHosts: Array<{
        hostId: number
        hostName: string
        hostIp: string
        accessCount: number
        uniqueUsers: number
      }>
      topScreens: Array<{
        screenId: number
        screenLabel: string
        viewCount: number
      }>
      topResources: Array<{
        resourceType: string
        label: string
        usageCount: number
      }>
      userResourceUsage: Array<{
        userId: number
        userName: string
        userEmail: string | null
        sessions: number
        snippets: number
        localAccess: number
        liveSessions: number
      }>
      userDrilldowns: Array<{
        userId: number
        userName: string
        userEmail: string | null
        topHosts: Array<{
          hostId: number
          hostName: string
          hostIp: string
          accessCount: number
        }>
        recentAccesses: Array<{
          sessionId: number
          hostId: number
          hostName: string
          hostIp: string
          startedAt: Date
        }>
      }>
    }
    tagStats:       { id: number; name: string; color: string; hostCount: number }[]
  }> {
    await endStaleActiveSessions(this.db)

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const previous24h = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const last30d = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

    const [
      activeUsers,
      license,
      totalHosts,
      activeSessions,
      sessionsToday,
      totalSessionsInPeriod,
      currentClientUxRows,
      previousClientUxRows,
      currentHostKeyRows,
      previousHostKeyRows,
      tags,
      topUserSessionRows,
      topHostSessionRows,
      topScreenRows,
      snippetUsageRows,
      localAccessUsageRows,
      liveSessionsOwnedCount,
      liveSessionsParticipatedCount,
      userSessionRows,
      userSnippetRows,
      userLocalAccessRows,
      userLiveOwnedRows,
      userLiveParticipantRows,
    ] = await Promise.all([
      this.db.user.count({ where: { tenantId, active: true, licenseConsumed: true } }),
      this.db.license.findUnique({ where: { tenantId }, select: { maxUsers: true } }),
      this.db.host.count({ where: { tenantId } }),
      this.db.session.count({ where: { active: true, user: { tenantId } } }),
      this.db.session.count({ where: { user: { tenantId }, startedAt: { gte: todayStart } } }),
      this.db.session.count({
        where: {
          user: { tenantId },
          startedAt: { gte: last30d },
        },
      }),
      this.db.adminLog.groupBy({
        by: ['action'],
        where: {
          admin: { tenantId },
          targetType: 'ClientUx',
          timestamp: { gte: last24h },
          action: {
            in: [
              'CLIENT_UX_SESSION_EXPIRED',
              'CLIENT_UX_SESSION_EXPIRED_TERMINAL',
              'CLIENT_UX_STALE_RELOAD_RECOVERED',
              'CLIENT_UX_STALE_RELOAD_FAILED',
            ],
          },
        },
        _count: { action: true },
      }),
      this.db.adminLog.groupBy({
        by: ['action'],
        where: {
          admin: { tenantId },
          targetType: 'ClientUx',
          timestamp: { gte: previous24h, lt: last24h },
          action: {
            in: [
              'CLIENT_UX_SESSION_EXPIRED',
              'CLIENT_UX_SESSION_EXPIRED_TERMINAL',
              'CLIENT_UX_STALE_RELOAD_RECOVERED',
              'CLIENT_UX_STALE_RELOAD_FAILED',
            ],
          },
        },
        _count: { action: true },
      }),
      this.db.adminLog.groupBy({
        by: ['action'],
        where: {
          admin: { tenantId },
          targetType: 'Host',
          timestamp: { gte: last24h },
          action: {
            in: [
              'HOST_KEY_TRUSTED',
              'HOST_KEY_UPDATED',
            ],
          },
        },
        _count: { action: true },
      }),
      this.db.adminLog.groupBy({
        by: ['action'],
        where: {
          admin: { tenantId },
          targetType: 'Host',
          timestamp: { gte: previous24h, lt: last24h },
          action: {
            in: [
              'HOST_KEY_TRUSTED',
              'HOST_KEY_UPDATED',
            ],
          },
        },
        _count: { action: true },
      }),
      this.db.tag.findMany({
        where: { tenantId },
        include: { _count: { select: { hosts: true } } },
        orderBy: { hosts: { _count: 'desc' } },
      }),
      this.db.session.groupBy({
        by: ['userId'],
        where: {
          user: { tenantId },
          startedAt: { gte: last30d },
        },
        _count: { userId: true },
        _max: { startedAt: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 5,
      }),
      this.db.session.groupBy({
        by: ['hostId'],
        where: {
          user: { tenantId },
          startedAt: { gte: last30d },
        },
        _count: { hostId: true },
        orderBy: { _count: { hostId: 'desc' } },
        take: 5,
      }),
      this.db.adminLog.groupBy({
        by: ['targetId'],
        where: {
          admin: { tenantId },
          action: 'USER_SCREEN_VIEWED',
          targetType: 'Screen',
          timestamp: { gte: last30d },
        },
        _count: { targetId: true },
        orderBy: { _count: { targetId: 'desc' } },
        take: 6,
      }),
      this.db.adminLog.count({
        where: {
          admin: { tenantId },
          action: 'USER_SNIPPET_EXECUTED',
          targetType: 'Snippet',
          timestamp: { gte: last30d },
        },
      }),
      this.db.adminLog.count({
        where: {
          admin: { tenantId },
          action: { in: ['USER_WEB_ACCESS_OPENED', 'USER_TUNNEL_OPENED'] },
          targetType: 'PortForwarding',
          timestamp: { gte: last30d },
        },
      }),
      this.db.sharedSession.count({
        where: { tenantId, createdAt: { gte: last30d } },
      }),
      this.db.sharedSessionParticipant.count({
        where: {
          user: { tenantId },
          role: 'VIEWER',
          joinedAt: { gte: last30d },
        },
      }),
      this.db.session.groupBy({
        by: ['userId'],
        where: {
          user: { tenantId },
          startedAt: { gte: last30d },
        },
        _count: { userId: true },
      }),
      this.db.adminLog.groupBy({
        by: ['adminId'],
        where: {
          admin: { tenantId },
          action: 'USER_SNIPPET_EXECUTED',
          targetType: 'Snippet',
          timestamp: { gte: last30d },
        },
        _count: { adminId: true },
      }),
      this.db.adminLog.groupBy({
        by: ['adminId'],
        where: {
          admin: { tenantId },
          action: { in: ['USER_WEB_ACCESS_OPENED', 'USER_TUNNEL_OPENED'] },
          targetType: 'PortForwarding',
          timestamp: { gte: last30d },
        },
        _count: { adminId: true },
      }),
      this.db.sharedSession.groupBy({
        by: ['ownerUserId'],
        where: {
          tenantId,
          createdAt: { gte: last30d },
        },
        _count: { ownerUserId: true },
      }),
      this.db.sharedSessionParticipant.groupBy({
        by: ['userId'],
        where: {
          user: { tenantId },
          role: 'VIEWER',
          joinedAt: { gte: last30d },
        },
        _count: { userId: true },
      }),
    ])

    const currentClientUxCounts = {
      sessionExpired: 0,
      sessionExpiredTerminal: 0,
      staleReloadRecovered: 0,
      staleReloadFailed: 0,
    }

    const previousClientUxCounts = {
      sessionExpired: 0,
      sessionExpiredTerminal: 0,
      staleReloadRecovered: 0,
      staleReloadFailed: 0,
    }

    const currentHostKeyCounts = {
      trusted: 0,
      updated: 0,
    }

    const previousHostKeyCounts = {
      trusted: 0,
      updated: 0,
    }

    for (const row of currentClientUxRows) {
      if (row.action === 'CLIENT_UX_SESSION_EXPIRED') currentClientUxCounts.sessionExpired = row._count.action
      if (row.action === 'CLIENT_UX_SESSION_EXPIRED_TERMINAL') currentClientUxCounts.sessionExpiredTerminal = row._count.action
      if (row.action === 'CLIENT_UX_STALE_RELOAD_RECOVERED') currentClientUxCounts.staleReloadRecovered = row._count.action
      if (row.action === 'CLIENT_UX_STALE_RELOAD_FAILED') currentClientUxCounts.staleReloadFailed = row._count.action
    }

    for (const row of previousClientUxRows) {
      if (row.action === 'CLIENT_UX_SESSION_EXPIRED') previousClientUxCounts.sessionExpired = row._count.action
      if (row.action === 'CLIENT_UX_SESSION_EXPIRED_TERMINAL') previousClientUxCounts.sessionExpiredTerminal = row._count.action
      if (row.action === 'CLIENT_UX_STALE_RELOAD_RECOVERED') previousClientUxCounts.staleReloadRecovered = row._count.action
      if (row.action === 'CLIENT_UX_STALE_RELOAD_FAILED') previousClientUxCounts.staleReloadFailed = row._count.action
    }

    for (const row of currentHostKeyRows) {
      if (row.action === 'HOST_KEY_TRUSTED') currentHostKeyCounts.trusted = row._count.action
      if (row.action === 'HOST_KEY_UPDATED') currentHostKeyCounts.updated = row._count.action
    }

    for (const row of previousHostKeyRows) {
      if (row.action === 'HOST_KEY_TRUSTED') previousHostKeyCounts.trusted = row._count.action
      if (row.action === 'HOST_KEY_UPDATED') previousHostKeyCounts.updated = row._count.action
    }

    const topUserIds = topUserSessionRows.map((row) => row.userId)
    const userRows = topUserIds.length
      ? await this.db.user.findMany({
          where: { id: { in: topUserIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const topUserHostRows = await Promise.all(
      topUserIds.map(async (userId) => this.db.session.groupBy({
        by: ['hostId'],
        where: {
          userId,
          startedAt: { gte: last30d },
        },
        _count: { hostId: true },
        orderBy: { _count: { hostId: 'desc' } },
        take: 1,
      })),
    )
    const primaryHostIds = topUserHostRows.flatMap((rows) => rows.map((row) => row.hostId))
    const topHostIds = topHostSessionRows.map((row) => row.hostId)
    const userDrilldownTopHosts = await Promise.all(
      topUserIds.map(async (userId) => this.db.session.groupBy({
        by: ['hostId'],
        where: {
          userId,
          startedAt: { gte: last30d },
        },
        _count: { hostId: true },
        orderBy: { _count: { hostId: 'desc' } },
        take: 5,
      })),
    )
    const drilldownHostIds = userDrilldownTopHosts.flatMap((rows) => rows.map((row) => row.hostId))
    const hostRows = [...new Set([...primaryHostIds, ...topHostIds, ...drilldownHostIds])].length
      ? await this.db.host.findMany({
          where: { id: { in: [...new Set([...primaryHostIds, ...topHostIds, ...drilldownHostIds])] } },
          select: { id: true, name: true, ip: true },
        })
      : []

    const uniqueHostUserRows = await this.db.session.groupBy({
      by: ['hostId', 'userId'],
      where: {
        user: { tenantId },
        startedAt: { gte: last30d },
        hostId: { in: topHostIds.length ? topHostIds : [0] },
      },
    })

    const allUserIds = [...new Set([
      ...userSessionRows.map((row) => row.userId),
      ...userSnippetRows.map((row) => row.adminId),
      ...userLocalAccessRows.map((row) => row.adminId),
      ...userLiveOwnedRows.map((row) => row.ownerUserId),
      ...userLiveParticipantRows.map((row) => row.userId),
    ])]
    const adoptionUsers = allUserIds.length
      ? await this.db.user.findMany({
          where: { id: { in: allUserIds } },
          select: { id: true, name: true, email: true },
        })
      : []

    const userMap = new Map(userRows.map((row) => [row.id, row]))
    const adoptionUserMap = new Map(adoptionUsers.map((row) => [row.id, row]))
    const hostMap = new Map(hostRows.map((row) => [row.id, row]))
    const uniqueUsersByHost = new Map<number, number>()
    for (const row of uniqueHostUserRows) {
      uniqueUsersByHost.set(row.hostId, (uniqueUsersByHost.get(row.hostId) ?? 0) + 1)
    }

    const topActiveUsers = topUserSessionRows
      .map((row, index) => {
        const user = userMap.get(row.userId)
        if (!user || !row._max.startedAt) return null
        const primaryHostId = topUserHostRows[index]?.[0]?.hostId
        return {
          userId: row.userId,
          userName: user.name,
          userEmail: user.email,
          sessionCount: row._count.userId,
          lastAccessedAt: row._max.startedAt,
          primaryHostName: primaryHostId ? hostMap.get(primaryHostId)?.name ?? null : null,
        }
      })
      .filter((row): row is NonNullable<typeof row> => !!row)

    const userDrilldownSessions = await Promise.all(
      topUserIds.map(async (userId) => this.db.session.findMany({
        where: { userId },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          startedAt: true,
          host: {
            select: {
              id: true,
              name: true,
              ip: true,
            },
          },
        },
      })),
    )

    const userDrilldowns = topUserIds
      .map((userId, index) => {
        const user = userMap.get(userId)
        const drilldownSessions = userDrilldownSessions[index]
        const drilldownTopHosts = userDrilldownTopHosts[index]
        if (!user) return null
        if (!drilldownSessions || !drilldownTopHosts) return null

        const recentAccesses = drilldownSessions.map((row) => ({
          sessionId: row.id,
          hostId: row.host.id,
          hostName: row.host.name,
          hostIp: row.host.ip,
          startedAt: row.startedAt,
        }))
        const topHosts = drilldownTopHosts
          .map((row) => {
            const host = hostMap.get(row.hostId)
            if (!host) return null
            return {
              hostId: host.id,
              hostName: host.name,
              hostIp: host.ip,
              accessCount: row._count.hostId,
            }
          })
          .filter((row): row is NonNullable<typeof row> => !!row)

        return {
          userId,
          userName: user.name,
          userEmail: user.email,
          topHosts,
          recentAccesses,
        }
      })
      .filter((row): row is NonNullable<typeof row> => !!row)

    const topHostsAdoption = topHostSessionRows
      .map((row) => {
        const host = hostMap.get(row.hostId)
        if (!host) return null
        return {
          hostId: row.hostId,
          hostName: host.name,
          hostIp: host.ip,
          accessCount: row._count.hostId,
          uniqueUsers: uniqueUsersByHost.get(row.hostId) ?? 0,
        }
      })
      .filter((row): row is NonNullable<typeof row> => !!row)

    const topScreens = topScreenRows
      .map((row) => ({
        screenId: row.targetId,
        screenLabel: screenLabelMap[row.targetId] ?? `Tela ${row.targetId}`,
        viewCount: row._count.targetId,
      }))

    const topResources = [
      { resourceType: 'terminal', label: 'Sessões SSH', usageCount: totalSessionsInPeriod },
      { resourceType: 'snippet', label: 'Snippets', usageCount: snippetUsageRows },
      { resourceType: 'localAccess', label: 'Acessos locais', usageCount: localAccessUsageRows },
      { resourceType: 'liveSession', label: 'Sessões ao vivo', usageCount: liveSessionsOwnedCount + liveSessionsParticipatedCount },
    ]
      .filter((row) => row.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)

    const sessionCounts = new Map(userSessionRows.map((row) => [row.userId, row._count.userId]))
    const snippetCounts = new Map(userSnippetRows.map((row) => [row.adminId, row._count.adminId]))
    const localAccessCounts = new Map(userLocalAccessRows.map((row) => [row.adminId, row._count.adminId]))
    const liveOwnedCounts = new Map(userLiveOwnedRows.map((row) => [row.ownerUserId, row._count.ownerUserId]))
    const liveParticipantCounts = new Map(userLiveParticipantRows.map((row) => [row.userId, row._count.userId]))

    const userResourceUsage = allUserIds
      .map((userId) => {
        const user = adoptionUserMap.get(userId)
        if (!user) return null
        const liveSessions = (liveOwnedCounts.get(userId) ?? 0) + (liveParticipantCounts.get(userId) ?? 0)
        return {
          userId,
          userName: user.name,
          userEmail: user.email,
          sessions: sessionCounts.get(userId) ?? 0,
          snippets: snippetCounts.get(userId) ?? 0,
          localAccess: localAccessCounts.get(userId) ?? 0,
          liveSessions,
        }
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .sort((a, b) =>
        (b.sessions + b.snippets + b.localAccess + b.liveSessions)
        - (a.sessions + a.snippets + a.localAccess + a.liveSessions),
      )
      .slice(0, 8)

    return {
      activeUsers,
      maxUsers:       license?.maxUsers ?? null,
      totalHosts,
      activeSessions,
      sessionsToday,
      clientUx: {
        current: currentClientUxCounts,
        previous: previousClientUxCounts,
      },
      hostKey: {
        current: currentHostKeyCounts,
        previous: previousHostKeyCounts,
      },
      adoption: {
        topActiveUsers,
        topHosts: topHostsAdoption,
        topScreens,
        topResources,
        userResourceUsage,
        userDrilldowns,
      },
      tagStats: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, hostCount: t._count.hosts })),
    }
  }

  async getRecentAuthLogs(tenantId: number, limit = 8): Promise<AuthLogRow[]> {
    return this.db.authLog.findMany({
      where: {
        OR: [
          { userId: null },
          { user: { tenantId } },
        ],
      },
      include: authLogInclude,
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
  }
}
