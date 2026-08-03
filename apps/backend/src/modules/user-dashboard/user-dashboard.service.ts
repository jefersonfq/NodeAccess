import type { Redis } from 'ioredis'
import type { UserDashboard, UserDashboardPeriodDays, UserDashboardSummary } from '@nodeaccess/shared'
import { NotFoundError, ForbiddenError } from '../../shared/errors.js'
import type { UserDashboardRepository, UserDashboardTimelineRow, UserDashboardTopHostRow } from './user-dashboard.repository.js'
import type { SshRepository } from '../ssh/ssh.repository.js'

const CACHE_TTL_SECONDS = 45

function toNumber(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return value ?? 0
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildDailySeries(
  periodDays: UserDashboardPeriodDays,
  rows: Array<{ date: string; sessions: number | bigint; failedSessions: number | bigint }>,
) {
  const byDate = new Map(
    rows.map((row) => [
      typeof row.date === 'string' ? row.date.slice(0, 10) : dayKey(new Date(row.date as string)),
      row,
    ]),
  )
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: periodDays }).map((_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (periodDays - 1 - index))
    const key = dayKey(date)
    const row = byDate.get(key)
    return { date: key, sessions: toNumber(row?.sessions), failedSessions: toNumber(row?.failedSessions) }
  })
}

type AuditStatusRow = { status: string; _count: { _all: number } }
type AuditRiskRow = { aiRiskLevel: string | null; _count: { _all: number } }

function groupedCount(row: AuditStatusRow | AuditRiskRow): number {
  return row._count._all
}

export class UserDashboardService {
  constructor(
    private readonly repo: UserDashboardRepository,
    private readonly redis: Redis,
    private readonly sshRepo: SshRepository,
  ) {}

  async getDashboard(input: {
    targetUserId: number
    viewerUserId: number
    tenantId: number
    viewerRole: 'ADMIN' | 'USER'
    periodDays: UserDashboardPeriodDays
    forceRefresh?: boolean
  }): Promise<UserDashboard> {
    if (input.viewerRole === 'USER' && input.targetUserId !== input.viewerUserId) {
      throw new ForbiddenError('Sem acesso ao dashboard deste usuario')
    }

    const cacheEnabled = input.viewerRole === 'ADMIN'
    const cacheKey = `user-dashboard:${input.tenantId}:${input.targetUserId}:${input.periodDays}:${input.viewerRole}:${input.viewerUserId}`
    const cached = cacheEnabled && !input.forceRefresh ? await this.readCache(cacheKey) : null
    if (cached) return { ...cached, cache: { ...cached.cache, hit: true } }

    const user = await this.repo.findUser(input.targetUserId, input.tenantId)
    if (!user) throw new NotFoundError('Usuario')

    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (input.periodDays - 1))

    const [summaryRaw, dailyRows, topHostRows, recentSessions, timeline] = await Promise.all([
      this.repo.getSummary(input.tenantId, input.targetUserId, from),
      this.repo.getDailySeries(input.tenantId, input.targetUserId, from),
      this.repo.getTopHosts(input.tenantId, input.targetUserId, from),
      this.repo.getRecentSessions(input.tenantId, input.targetUserId, from),
      this.repo.getTimeline(input.tenantId, input.targetUserId, from),
    ])
    const visibleHostIds = await this.resolveVisibleHostIds(input, [
      ...topHostRows.map((row) => row.hostId),
      ...recentSessions.map((session) => session.hostId),
      ...timeline.map((item) => item.hostId),
    ])
    const visibleTopHostRows = this.filterRowsByVisibleHost(topHostRows, visibleHostIds)
    const visibleRecentSessions = visibleHostIds === null
      ? recentSessions
      : recentSessions.filter((session) => visibleHostIds.has(session.hostId))
    const visibleTimeline = this.filterRowsByVisibleHost(timeline, visibleHostIds)

    const statusCounts = new Map(
      summaryRaw.auditStatusRows.map((row) => [row.status, groupedCount(row as AuditStatusRow)]),
    )
    const riskCounts = new Map(
      summaryRaw.auditRiskRows.map((row) => [
        String(row.aiRiskLevel ?? '').toLowerCase(),
        groupedCount(row as AuditRiskRow),
      ]),
    )

    const dashboard: UserDashboard = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role === 'ADMIN' ? 'admin' : 'user',
      },
      periodDays: input.periodDays,
      summary: {
        sessions: summaryRaw.sessions,
        activeSessions: summaryRaw.activeSessions,
        failedSessions: summaryRaw.failedSessions,
        hostsAccessed: summaryRaw.hostsAccessed,
        audits: summaryRaw.audits,
        auditEvents: toNumber(summaryRaw.auditEvents),
        bytesIn: toNumber(summaryRaw.bytesIn),
        bytesOut: toNumber(summaryRaw.bytesOut),
        sharedSessionsOwned: summaryRaw.sharedOwned,
        sharedSessionsParticipated: summaryRaw.sharedParticipated,
      },
      daily: buildDailySeries(input.periodDays, dailyRows),
      topHosts: visibleTopHostRows.map((row) => ({
        hostId: row.hostId,
        hostName: row.hostName,
        hostIp: row.hostIp,
        hostDeleted: Boolean(row.hostDeleted),
        count: toNumber(row.count),
        lastSeenAt: row.lastSeenAt,
      })),
      auditPosture: {
        running: statusCounts.get('RUNNING') ?? 0,
        completed: statusCounts.get('COMPLETED') ?? 0,
        failed: statusCounts.get('FAILED') ?? 0,
        purged: statusCounts.get('PURGED') ?? 0,
        riskHigh: riskCounts.get('high') ?? riskCounts.get('alto') ?? 0,
        riskMedium: riskCounts.get('medium') ?? riskCounts.get('medio') ?? riskCounts.get('médio') ?? 0,
        riskLow: riskCounts.get('low') ?? riskCounts.get('baixo') ?? 0,
      },
      recentSessions: visibleRecentSessions.map((s) => ({
        id: s.id,
        hostName: s.host.name,
        hostIp: s.host.ip,
        hostDeleted: s.host.deletedAt !== null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        active: s.active,
        connectionMethod: s.connectionMethod,
        errorCode: s.errorCode,
      })),
      timeline: visibleTimeline.map((item) => ({
        ...item,
        hostDeleted: Boolean(item.hostDeleted),
      })),
      cache: { enabled: true, hit: false, ttlSeconds: CACHE_TTL_SECONDS, generatedAt: new Date() },
    }

    if (cacheEnabled) await this.writeCache(cacheKey, dashboard)
    return dashboard
  }

  // Legado para /summary endpoint
  async getSummary(tenantId: number, userId: number): Promise<UserDashboardSummary> {
    const summary = await this.repo.getSummaryLegacy(tenantId, userId)
    const visibleHostIds = await this.sshRepo.findHostIdsWithEffectivePermission(
      [
        ...summary.topHostsLast30Days.map((host) => host.hostId),
        ...summary.topSshTunnelsLast30Days.map((tunnel) => tunnel.hostId),
      ],
      tenantId,
      userId,
      'view',
      'USER',
    )

    return {
      ...summary,
      topHostsLast30Days: summary.topHostsLast30Days.filter((host) => visibleHostIds.has(host.hostId)),
      topSshTunnelsLast30Days: summary.topSshTunnelsLast30Days
        .filter((tunnel) => visibleHostIds.has(tunnel.hostId))
        .map(({ hostId: _hostId, ...tunnel }) => tunnel),
    }
  }

  private async readCache(key: string): Promise<UserDashboard | null> {
    try {
      const cached = await this.redis.get(key)
      return cached ? (JSON.parse(cached) as UserDashboard) : null
    } catch {
      return null
    }
  }

  private async writeCache(key: string, dashboard: UserDashboard): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(dashboard), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // cache é apenas acelerador
    }
  }

  private async resolveVisibleHostIds(
    input: {
      tenantId: number
      viewerUserId: number
      viewerRole: 'ADMIN' | 'USER'
    },
    hostIds: number[],
  ): Promise<Set<number> | null> {
    if (input.viewerRole === 'ADMIN') return null
    return this.sshRepo.findHostIdsWithEffectivePermission(
      hostIds,
      input.tenantId,
      input.viewerUserId,
      'view',
      'USER',
    )
  }

  private filterRowsByVisibleHost<T extends UserDashboardTopHostRow | UserDashboardTimelineRow>(
    rows: T[],
    visibleHostIds: Set<number> | null,
  ): T[] {
    if (visibleHostIds === null) return rows
    return rows.filter((row) => visibleHostIds.has(row.hostId))
  }
}
