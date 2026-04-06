import type { PrismaClient } from '@prisma/client'

export class UserDashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  async getSummary(userId: number): Promise<{
    activeSessions: number
    totalSessionsLast30Days: number
    uniqueHostsLast30Days: number
    totalSnippetExecutionsLast30Days: number
    totalLocalAccessLast30Days: number
    sharedSessionsOwnedLast30Days: number
    sharedSessionsParticipatedLast30Days: number
    topHostsLast30Days: Array<{
      hostId: number
      hostName: string
      hostIp: string
      accessCount: number
      lastAccessedAt: Date
    }>
    topSnippetsLast30Days: Array<{
      snippetId: number
      snippetName: string
      usageCount: number
    }>
    topLocalAccessLast30Days: Array<{
      forwardingId: number
      label: string
      hostName: string
      usageCount: number
    }>
    weeklyActivityLast4Weeks: Array<{
      periodStart: Date
      periodEnd: Date
      sessions: number
      sharedSessions: number
    }>
  }> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const trendStart = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)

    const [
      activeSessions,
      totalSessionsLast30Days,
      groupedHosts,
      groupedSnippets,
      groupedLocalAccess,
      sharedSessionsOwnedLast30Days,
      sharedSessionsParticipatedLast30Days,
      sessionTrendRows,
      sharedOwnedTrendRows,
      sharedParticipantTrendRows,
    ] = await Promise.all([
      this.db.session.count({
        where: { userId, active: true },
      }),
      this.db.session.count({
        where: {
          userId,
          startedAt: { gte: since },
        },
      }),
      this.db.session.groupBy({
        by: ['hostId'],
        where: {
          userId,
          startedAt: { gte: since },
        },
        _count: { hostId: true },
        _max: { startedAt: true },
        orderBy: {
          _count: { hostId: 'desc' },
        },
        take: 5,
      }),
      this.db.adminLog.groupBy({
        by: ['targetId'],
        where: {
          adminId: userId,
          action: 'USER_SNIPPET_EXECUTED',
          targetType: 'Snippet',
          timestamp: { gte: since },
        },
        _count: { targetId: true },
        orderBy: {
          _count: { targetId: 'desc' },
        },
        take: 5,
      }),
      this.db.adminLog.groupBy({
        by: ['targetId'],
        where: {
          adminId: userId,
          action: { in: ['USER_WEB_ACCESS_OPENED', 'USER_TUNNEL_OPENED'] },
          targetType: 'PortForwarding',
          timestamp: { gte: since },
        },
        _count: { targetId: true },
        orderBy: {
          _count: { targetId: 'desc' },
        },
        take: 5,
      }),
      this.db.sharedSession.count({
        where: {
          ownerUserId: userId,
          createdAt: { gte: since },
        },
      }),
      this.db.sharedSessionParticipant.count({
        where: {
          userId,
          role: 'VIEWER',
          joinedAt: { gte: since },
        },
      }),
      this.db.session.findMany({
        where: {
          userId,
          startedAt: { gte: trendStart },
        },
        select: { startedAt: true },
      }),
      this.db.sharedSession.findMany({
        where: {
          ownerUserId: userId,
          createdAt: { gte: trendStart },
        },
        select: { createdAt: true },
      }),
      this.db.sharedSessionParticipant.findMany({
        where: {
          userId,
          role: 'VIEWER',
          joinedAt: { gte: trendStart },
        },
        select: { joinedAt: true },
      }),
    ])

    const uniqueHostsLast30Days = await this.db.session.groupBy({
      by: ['hostId'],
      where: {
        userId,
        startedAt: { gte: since },
      },
    })

    const hosts = groupedHosts.length
      ? await this.db.host.findMany({
          where: { id: { in: groupedHosts.map((row) => row.hostId) } },
          select: { id: true, name: true, ip: true },
        })
      : []
    const snippets = groupedSnippets.length
      ? await this.db.snippet.findMany({
          where: { id: { in: groupedSnippets.map((row) => row.targetId) } },
          select: { id: true, name: true },
        })
      : []
    const forwardings = groupedLocalAccess.length
      ? await this.db.portForwarding.findMany({
          where: { id: { in: groupedLocalAccess.map((row) => row.targetId) } },
          select: {
            id: true,
            description: true,
            remoteHost: true,
            remotePort: true,
            host: { select: { name: true } },
          },
        })
      : []

    const hostMap = new Map(hosts.map((host) => [host.id, host]))
    const snippetMap = new Map(snippets.map((snippet) => [snippet.id, snippet]))
    const forwardingMap = new Map(forwardings.map((forwarding) => [forwarding.id, forwarding]))
    const weeklyActivityLast4Weeks = buildWeeklyActivity({
      sessionDates: sessionTrendRows.map((row) => row.startedAt),
      sharedDates: [
        ...sharedOwnedTrendRows.map((row) => row.createdAt),
        ...sharedParticipantTrendRows.map((row) => row.joinedAt),
      ],
    })

    return {
      activeSessions,
      totalSessionsLast30Days,
      uniqueHostsLast30Days: uniqueHostsLast30Days.length,
      totalSnippetExecutionsLast30Days: groupedSnippets.reduce((total, row) => total + row._count.targetId, 0),
      totalLocalAccessLast30Days: groupedLocalAccess.reduce((total, row) => total + row._count.targetId, 0),
      sharedSessionsOwnedLast30Days,
      sharedSessionsParticipatedLast30Days,
      topHostsLast30Days: groupedHosts
        .map((row) => {
          const host = hostMap.get(row.hostId)
          if (!host || !row._max.startedAt) return null
          return {
            hostId: row.hostId,
            hostName: host.name,
            hostIp: host.ip,
            accessCount: row._count.hostId,
            lastAccessedAt: row._max.startedAt,
          }
        })
        .filter((row): row is NonNullable<typeof row> => !!row),
      topSnippetsLast30Days: groupedSnippets
        .map((row) => {
          const snippet = snippetMap.get(row.targetId)
          if (!snippet) return null
          return {
            snippetId: snippet.id,
            snippetName: snippet.name,
            usageCount: row._count.targetId,
          }
        })
        .filter((row): row is NonNullable<typeof row> => !!row),
      topLocalAccessLast30Days: groupedLocalAccess
        .map((row) => {
          const forwarding = forwardingMap.get(row.targetId)
          if (!forwarding) return null
          return {
            forwardingId: forwarding.id,
            label: forwarding.description?.trim() || `${forwarding.remoteHost}:${forwarding.remotePort}`,
            hostName: forwarding.host.name,
            usageCount: row._count.targetId,
          }
        })
        .filter((row): row is NonNullable<typeof row> => !!row),
      weeklyActivityLast4Weeks,
    }
  }
}

function buildWeeklyActivity(input: {
  sessionDates: Date[]
  sharedDates: Date[]
}): Array<{
  periodStart: Date
  periodEnd: Date
  sessions: number
  sharedSessions: number
}> {
  const now = new Date()
  const start = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
  const buckets = Array.from({ length: 4 }, (_, index) => {
    const periodStart = new Date(start.getTime() + index * 7 * 24 * 60 * 60 * 1000)
    const periodEnd = new Date(periodStart.getTime() + 7 * 24 * 60 * 60 * 1000)
    return {
      periodStart,
      periodEnd,
      sessions: 0,
      sharedSessions: 0,
    }
  })

  for (const date of input.sessionDates) {
    const bucket = buckets.find((item) => date >= item.periodStart && date < item.periodEnd)
    if (bucket) bucket.sessions += 1
  }

  for (const date of input.sharedDates) {
    const bucket = buckets.find((item) => date >= item.periodStart && date < item.periodEnd)
    if (bucket) bucket.sharedSessions += 1
  }

  return buckets
}
