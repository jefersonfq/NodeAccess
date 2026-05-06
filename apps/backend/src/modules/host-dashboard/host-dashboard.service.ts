import type { Redis } from 'ioredis'
import type { HostDashboard, HostDashboardPeriodDays } from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { HostDashboardRepository, HostDashboardViewer } from './host-dashboard.repository.js'

const CACHE_TTL_SECONDS = 45

function toNumber(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') return Number(value)
  return value ?? 0
}

function mapScope(scope: 'PERSONAL' | 'TEAM' | 'GLOBAL'): HostDashboard['host']['scope'] {
  return scope.toLowerCase() as HostDashboard['host']['scope']
}

function mapConnectionMode(mode: HostDashboard['host']['connectionMode'] | string): HostDashboard['host']['connectionMode'] {
  return String(mode).toLowerCase() as HostDashboard['host']['connectionMode']
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildDailySeries(periodDays: HostDashboardPeriodDays, rows: Array<{ date: string; sessions: number | bigint; failedSessions: number | bigint }>) {
  const byDate = new Map(rows.map((row) => [
    typeof row.date === 'string' ? row.date.slice(0, 10) : dayKey(new Date(row.date)),
    row,
  ]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return Array.from({ length: periodDays }).map((_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (periodDays - 1 - index))
    const key = dayKey(date)
    const row = byDate.get(key)
    return {
      date: key,
      sessions: toNumber(row?.sessions),
      failedSessions: toNumber(row?.failedSessions),
    }
  })
}

function groupedCount(row: { _count?: true | { _all?: number } | undefined }): number {
  return typeof row._count === 'object' ? row._count._all ?? 0 : 0
}

function buildHealth(input: {
  summary: HostDashboard['summary']
  auditPosture: HostDashboard['auditPosture']
  host: HostDashboard['host']
}): HostDashboard['health'] {
  const reasons: string[] = []
  let score = 100
  const failureRate = input.summary.sessions > 0
    ? input.summary.failedSessions / input.summary.sessions
    : 0

  if (input.summary.failedSessions > 0) {
    const penalty = failureRate >= 0.25 ? 30 : failureRate >= 0.1 ? 18 : 10
    score -= penalty
    reasons.push(`${input.summary.failedSessions} falha(s) de sessao no periodo`)
  }

  if (input.auditPosture.riskHigh > 0) {
    score -= 25
    reasons.push(`${input.auditPosture.riskHigh} auditoria(s) com risco alto`)
  }

  if (input.auditPosture.failed > 0) {
    score -= 12
    reasons.push(`${input.auditPosture.failed} auditoria(s) com falha`)
  }

  if (!input.host.trustedHostKeyVerifiedAt) {
    score -= 15
    reasons.push('Host key ainda nao foi confiada')
  }

  if (input.host.connectionMode !== 'direct') {
    score -= 5
    reasons.push('Host depende de rota por agente')
  }

  if (input.host.effectiveBastionSource !== 'none') {
    reasons.push(`Usa bastion ${input.host.effectiveBastionName ?? 'configurado'}`)
  }

  if (input.summary.webForwardings > 0) {
    score -= 8
    reasons.push(`${input.summary.webForwardings} forwarding(s) web ativo(s)`)
  }

  const boundedScore = Math.max(0, Math.min(100, score))
  const status = boundedScore < 60 || input.auditPosture.riskHigh > 0
    ? 'critical'
    : boundedScore < 85 || input.summary.failedSessions > 0
      ? 'attention'
      : 'healthy'

  return {
    status,
    score: boundedScore,
    title: status === 'healthy'
      ? 'Saude boa'
      : status === 'attention'
        ? 'Requer atencao'
        : 'Critico',
    reasons: reasons.length ? reasons : ['Sem sinais relevantes de instabilidade no periodo'],
  }
}

export class HostDashboardService {
  constructor(
    private readonly repo: HostDashboardRepository,
    private readonly userRepo: UserRepository,
    private readonly redis: Redis,
  ) {}

  async getDashboard(input: {
    hostId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
    periodDays: HostDashboardPeriodDays
    forceRefresh?: boolean
  }): Promise<HostDashboard> {
    const viewer: HostDashboardViewer = {
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      userGroupIds: input.role === 'USER' ? await this.userRepo.findGroupIdsByUser(input.userId) : [],
    }
    const cacheKey = this.cacheKey(input.hostId, viewer, input.periodDays)
    const cached = input.forceRefresh ? null : await this.readCache(cacheKey)
    if (cached) return { ...cached, cache: { ...cached.cache, enabled: true, hit: true, ttlSeconds: CACHE_TTL_SECONDS } }

    const host = await this.repo.findVisibleHost(input.hostId, viewer)
    if (!host) {
      if (input.role === 'ADMIN') throw new NotFoundError('Host')
      throw new ForbiddenError('Sem acesso a este host')
    }

    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (input.periodDays - 1))

    const [summary, dailyRows, routeRows, originRows, recentSessions, timeline] = await Promise.all([
      this.repo.getSummary(input.hostId, viewer, from),
      this.repo.getDailySeries(input.hostId, viewer, from),
      this.repo.getRouteDistribution(input.hostId, viewer, from),
      this.repo.getOriginDistribution(input.hostId, viewer, from),
      this.repo.getRecentSessions(input.hostId, viewer, from),
      this.repo.getTimeline(input.hostId, viewer, from),
    ])

    const hostBastion = host.bastion
    const groupBastion = host.group?.bastion ?? null
    const effectiveBastion = hostBastion ?? groupBastion
    const effectiveBastionSource = hostBastion ? 'host' : groupBastion ? 'group' : 'none'

    const statusCounts = new Map(summary.auditStatusRows.map((row) => [row.status, groupedCount(row)]))
    const riskCounts = new Map(summary.auditRiskRows.map((row) => [String(row.aiRiskLevel ?? '').toLowerCase(), groupedCount(row)]))

    const dashboardHost: HostDashboard['host'] = {
      id: host.id,
      name: host.name,
      ip: host.ip,
      port: host.port,
      sshUser: host.sshUser,
      deleted: host.deletedAt !== null,
      deletedAt: host.deletedAt,
      scope: mapScope(host.scope),
      connectionMode: mapConnectionMode(host.connectionMode),
      effectiveBastionName: effectiveBastion?.name ?? null,
      effectiveBastionSource,
      trustedHostKeyVerifiedAt: host.trustedHostKeyVerifiedAt,
      tags: host.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color ?? '#6b7280' })),
      associatedLinksCount: host.associatedLinks.length,
    }
    const dashboardSummary: HostDashboard['summary'] = {
      sessions: summary.sessions,
      activeSessions: summary.activeSessions,
      failedSessions: summary.failedSessions,
      uniqueUsers: summary.uniqueUsers,
      audits: summary.audits,
      auditEvents: toNumber(summary.auditEvents),
      bytesIn: toNumber(summary.bytesIn),
      bytesOut: toNumber(summary.bytesOut),
      sharedSessions: summary.sharedSessions,
      activeSharedSessions: summary.activeSharedSessions,
      forwardings: summary.forwardings,
      webForwardings: summary.webForwardings,
    }
    const dashboardAuditPosture: HostDashboard['auditPosture'] = {
      running: statusCounts.get('RUNNING') ?? 0,
      completed: statusCounts.get('COMPLETED') ?? 0,
      failed: statusCounts.get('FAILED') ?? 0,
      purged: statusCounts.get('PURGED') ?? 0,
      riskHigh: riskCounts.get('high') ?? riskCounts.get('alto') ?? 0,
      riskMedium: riskCounts.get('medium') ?? riskCounts.get('medio') ?? riskCounts.get('médio') ?? 0,
      riskLow: riskCounts.get('low') ?? riskCounts.get('baixo') ?? 0,
    }

    const dashboard: HostDashboard = {
      host: dashboardHost,
      periodDays: input.periodDays,
      viewer: {
        role: input.role === 'ADMIN' ? 'admin' : 'user',
        restrictedToOwnActivity: input.role === 'USER',
      },
      summary: dashboardSummary,
      daily: buildDailySeries(input.periodDays, dailyRows),
      routes: routeRows.map((row) => ({
        route: row.connectionMethod,
        count: row._count.connectionMethod,
      })),
      origins: originRows.map((row) => ({
        ip: row.ip,
        count: toNumber(row.count),
        lastSeenAt: row.lastSeenAt,
      })),
      auditPosture: dashboardAuditPosture,
      health: buildHealth({ summary: dashboardSummary, auditPosture: dashboardAuditPosture, host: dashboardHost }),
      recentSessions: recentSessions.map((session) => ({
        id: session.id,
        userName: input.role === 'ADMIN' ? session.user.name : null,
        userEmail: input.role === 'ADMIN' ? session.user.email : null,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        active: session.active,
        connectionMethod: session.connectionMethod,
        clientIp: session.clientIp,
        agentRemoteIp: session.agentRemoteIp,
        errorCode: session.errorCode,
      })),
      timeline,
      cache: { enabled: true, hit: false, ttlSeconds: CACHE_TTL_SECONDS, generatedAt: new Date() },
    }

    await this.writeCache(cacheKey, dashboard)
    return dashboard
  }

  private cacheKey(hostId: number, viewer: HostDashboardViewer, periodDays: number): string {
    return `host-dashboard:${viewer.tenantId}:${hostId}:${periodDays}:${viewer.role}:${viewer.userId}`
  }

  private async readCache(cacheKey: string): Promise<HostDashboard | null> {
    try {
      const cached = await this.redis.get(cacheKey)
      return cached ? JSON.parse(cached) as HostDashboard : null
    } catch {
      return null
    }
  }

  private async writeCache(cacheKey: string, dashboard: HostDashboard): Promise<void> {
    try {
      await this.redis.set(cacheKey, JSON.stringify(dashboard), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // Cache e apenas acelerador; falha nao deve afetar a consulta.
    }
  }
}
