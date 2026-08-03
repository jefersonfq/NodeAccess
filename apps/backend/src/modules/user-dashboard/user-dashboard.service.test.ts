import { describe, expect, it, vi } from 'vitest'
import { UserDashboardService } from './user-dashboard.service.js'
import type { UserDashboardRepository } from './user-dashboard.repository.js'

const now = new Date('2026-01-01T00:00:00.000Z')

function makeRepo() {
  return {
    findUser: vi.fn().mockResolvedValue({ id: 10, name: 'Usuario', email: 'u@example.com', role: 'USER' }),
    getSummary: vi.fn().mockResolvedValue({
      sessions: 2,
      activeSessions: 0,
      failedSessions: 0,
      hostsAccessed: 2,
      audits: 0,
      auditEvents: 0,
      bytesIn: 0,
      bytesOut: 0,
      sharedOwned: 0,
      sharedParticipated: 0,
      auditStatusRows: [],
      auditRiskRows: [],
    }),
    getDailySeries: vi.fn().mockResolvedValue([]),
    getTopHosts: vi.fn().mockResolvedValue([
      { hostId: 20, hostName: 'permitido', hostIp: '10.0.0.20', hostDeleted: false, count: 2, lastSeenAt: now },
      { hostId: 21, hostName: 'bloqueado', hostIp: '10.0.0.21', hostDeleted: false, count: 1, lastSeenAt: now },
    ]),
    getRecentSessions: vi.fn().mockResolvedValue([
      { id: 1, hostId: 20, host: { name: 'permitido', ip: '10.0.0.20', deletedAt: null }, startedAt: now, endedAt: null, active: false, connectionMethod: 'direct', errorCode: null },
      { id: 2, hostId: 21, host: { name: 'bloqueado', ip: '10.0.0.21', deletedAt: null }, startedAt: now, endedAt: null, active: false, connectionMethod: 'direct', errorCode: null },
    ]),
    getTimeline: vi.fn().mockResolvedValue([
      { id: 'session-1', type: 'session', hostId: 20, title: 'Sessao', description: 'permitido', hostDeleted: false, occurredAt: now, severity: 'info', sessionId: 1 },
      { id: 'session-2', type: 'session', hostId: 21, title: 'Sessao', description: 'bloqueado', hostDeleted: false, occurredAt: now, severity: 'info', sessionId: 2 },
    ]),
    getSummaryLegacy: vi.fn().mockResolvedValue({
      activeSessions: 0,
      totalSessionsLast30Days: 2,
      uniqueHostsLast30Days: 2,
      totalSnippetExecutionsLast30Days: 0,
      totalSshTunnelsLast30Days: 2,
      sharedSessionsOwnedLast30Days: 0,
      sharedSessionsParticipatedLast30Days: 0,
      topHostsLast30Days: [
        { hostId: 20, hostName: 'permitido', hostIp: '10.0.0.20', hostDeleted: false, accessCount: 2, lastAccessedAt: now },
        { hostId: 21, hostName: 'bloqueado', hostIp: '10.0.0.21', hostDeleted: false, accessCount: 1, lastAccessedAt: now },
      ],
      topSnippetsLast30Days: [],
      topSshTunnelsLast30Days: [
        { forwardingId: 1, label: 'permitido:5432', hostId: 20, hostName: 'permitido', usageCount: 2 },
        { forwardingId: 2, label: 'bloqueado:5432', hostId: 21, hostName: 'bloqueado', usageCount: 1 },
      ],
      weeklyActivityLast4Weeks: [],
    }),
  }
}

describe('UserDashboardService ACL filtering', () => {
  it('filtra hosts sem permissao de visualizacao para usuario comum', async () => {
    const repo = makeRepo()
    const redis = {
      get: vi.fn(),
      set: vi.fn(),
    }
    const sshRepo = {
      findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([20])),
    }
    const service = new UserDashboardService(
      repo as unknown as UserDashboardRepository,
      redis as never,
      sshRepo as never,
    )

    const dashboard = await service.getDashboard({
      targetUserId: 10,
      viewerUserId: 10,
      tenantId: 1,
      viewerRole: 'USER',
      periodDays: 30,
    })

    expect(dashboard.topHosts.map((host) => host.hostId)).toEqual([20])
    expect(dashboard.recentSessions.map((session) => session.id)).toEqual([1])
    expect(dashboard.timeline.map((item) => item.id)).toEqual(['session-1'])
    expect(redis.get).not.toHaveBeenCalled()
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('filtra hosts e tuneis sem permissao no resumo legado', async () => {
    const repo = makeRepo()
    const sshRepo = {
      findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([20])),
    }
    const service = new UserDashboardService(
      repo as unknown as UserDashboardRepository,
      {} as never,
      sshRepo as never,
    )

    const summary = await service.getSummary(1, 10)

    expect(summary.topHostsLast30Days.map((host) => host.hostId)).toEqual([20])
    expect(summary.topSshTunnelsLast30Days.map((tunnel) => tunnel.forwardingId)).toEqual([1])
    expect(summary.topSshTunnelsLast30Days[0]).not.toHaveProperty('hostId')
  })
})
