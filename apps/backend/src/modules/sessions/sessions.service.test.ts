import { describe, expect, it, vi } from 'vitest'
import { SessionsService } from './sessions.service.js'
import type { SessionsRepository, ActiveSessionOverviewRow } from './sessions.repository.js'
import type { AppEvent } from '../app-events/app-event.bus.js'

function makeOverviewRow(): ActiveSessionOverviewRow {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return {
    id: 1,
    userId: 10,
    userName: 'Usuario',
    userEmail: 'usuario@example.com',
    userAvatarUpdatedAt: null,
    hostId: 20,
    hostTenantId: 1,
    hostName: 'host',
    hostIp: '10.0.0.20',
    hostPort: 22,
    hostScope: 'GLOBAL',
    hostGroupName: null,
    hostAccessProtocol: 'SSH',
    startedAt: now,
    lastSeenAt: now,
    connectionMethod: 'direct',
    accessType: 'authenticated',
    clientIp: null,
    agentRemoteIp: null,
    agentNameSnapshot: null,
  }
}

describe('SessionsService access map cache', () => {
  it('invalidates cached presence after stale sessions are cleaned up', async () => {
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockResolvedValue([makeOverviewRow()]),
    }
    const service = new SessionsService(repo as unknown as SessionsRepository)
    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    repo.endStaleActive.mockResolvedValueOnce(1)
    repo.findActiveOverview.mockResolvedValue([])
    expect(await service.cleanupStaleActive()).toBe(1)
    expect((await service.getAccessMap(1, { userId: 10, role: 'admin' })).totals.activeSessions).toBe(0)
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
  })

  it('recovers after a repository failure without caching a false empty result', async () => {
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue([makeOverviewRow()]),
    }
    const service = new SessionsService(repo as unknown as SessionsRepository)
    await expect(service.getAccessMap(1, { userId: 10, role: 'admin' })).rejects.toThrow('database unavailable')
    expect((await service.getAccessMap(1, { userId: 10, role: 'admin' })).totals.activeSessions).toBe(1)
  })

  it('does not cache an old read that finishes after a session-ended invalidation', async () => {
    let finish!: (rows: ActiveSessionOverviewRow[]) => void
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([]),
    }
    const service = new SessionsService(repo as unknown as SessionsRepository)
    const oldRead = service.getAccessMap(1, { userId: 10, role: 'admin' })
    await vi.waitFor(() => expect(repo.findActiveOverview).toHaveBeenCalledTimes(1))
    service.clearAccessMapCache()
    finish([makeOverviewRow()])
    await oldRead
    const current = await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(current.totals.activeSessions).toBe(0)
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
  })
  it('inclui avatar versionado dos usuarios ativos', async () => {
    const avatarUpdatedAt = new Date('2026-01-01T00:10:00.000Z')
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockResolvedValue([{ ...makeOverviewRow(), userAvatarUpdatedAt: avatarUpdatedAt }]),
    }

    const service = new SessionsService(
      repo as unknown as SessionsRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    )

    const overview = await service.getAccessMap(1, { userId: 10, role: 'admin' })

    expect(overview.hosts[0]?.sessions[0]?.user.avatarUrl).toBe(`/api/v1/users/10/avatar?v=${avatarUpdatedAt.getTime()}`)
    expect(overview.hosts[0]?.sessions[0]?.user.avatarVersion).toBe(String(avatarUpdatedAt.getTime()))
  })

  it('limpa o cache quando ACL de inventario muda', async () => {
    let handler: ((event: AppEvent) => void | Promise<void>) | null = null
    const appEventBus = {
      onEvent: vi.fn((nextHandler: (event: AppEvent) => void | Promise<void>) => {
        handler = nextHandler
        return () => {}
      }),
    }
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockResolvedValue([makeOverviewRow()]),
    }

    const service = new SessionsService(
      repo as unknown as SessionsRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      appEventBus as never,
    )

    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(1)

    await handler?.({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 30,
      hostId: 20,
      actorId: 1,
      principalType: 'USER',
      principalId: 10,
      action: 'upsert',
      changedAt: '2026-01-01T00:00:00.000Z',
    })

    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
  })

  it('limpa o cache quando associacao de usuario a grupo muda', async () => {
    let handler: ((event: AppEvent) => void | Promise<void>) | null = null
    const appEventBus = {
      onEvent: vi.fn((nextHandler: (event: AppEvent) => void | Promise<void>) => {
        handler = nextHandler
        return () => {}
      }),
    }
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockResolvedValue([makeOverviewRow()]),
    }

    const service = new SessionsService(
      repo as unknown as SessionsRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      appEventBus as never,
    )

    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(1)

    await handler?.({
      type: 'user_acl_membership_changed',
      tenantId: 1,
      userId: 10,
      actorId: 1,
      previousGroupIds: [7],
      nextGroupIds: [],
      changedAt: '2026-01-01T00:00:00.000Z',
    })

    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
  })

  it('limpa o cache quando presenca de sessao muda', async () => {
    let handler: ((event: AppEvent) => void | Promise<void>) | null = null
    const appEventBus = {
      onEvent: vi.fn((nextHandler: (event: AppEvent) => void | Promise<void>) => {
        handler = nextHandler
        return () => {}
      }),
    }
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      findActiveOverview: vi.fn().mockResolvedValue([makeOverviewRow()]),
    }

    const service = new SessionsService(
      repo as unknown as SessionsRepository,
      undefined,
      undefined,
      undefined,
      undefined,
      appEventBus as never,
    )

    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(1)

    await handler?.({
      type: 'session_presence_changed',
      tenantId: 1,
      hostId: 20,
      sessionId: 1,
      userId: 10,
      action: 'ended',
      changedAt: '2026-01-01T00:00:00.000Z',
    })

    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
  })
})

describe('multi-user presence and recovery', () => {
  function fixture() {
    const repo = {
      endStaleActive: vi.fn().mockResolvedValue(0),
      endAllActive: vi.fn().mockResolvedValue(1),
      endActiveSessions: vi.fn().mockResolvedValue(1),
      findActiveOverview: vi.fn().mockResolvedValue([makeOverviewRow()]),
    }
    return { repo, service: new SessionsService(repo as unknown as SessionsRepository) }
  }

  it.each(['manual', 'startup'])('invalidates presence after %s cleanup', async (mode) => {
    const { repo, service } = fixture()
    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    if (mode === 'manual') await service.cleanupGhosts(1)
    else await service.cleanupAllGhosts()
    repo.findActiveOverview.mockResolvedValue([])
    expect((await service.getAccessMap(1, { userId: 10, role: 'admin' })).totals.activeSessions).toBe(0)
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
  })

  it('does not claim cleanup succeeded when the database fails', async () => {
    const { repo, service } = fixture()
    await service.getAccessMap(1, { userId: 10, role: 'admin' })
    repo.endActiveSessions.mockRejectedValueOnce(new Error('offline'))
    await expect(service.cleanupGhosts(1)).rejects.toThrow('offline')
    expect((await service.getAccessMap(1, { userId: 10, role: 'admin' })).totals.activeSessions).toBe(1)
  })

  it('aggregates multiple tabs, people and hosts without counting a person twice globally', async () => {
    const { repo, service } = fixture()
    repo.findActiveOverview.mockResolvedValue([
      makeOverviewRow(),
      { ...makeOverviewRow(), id: 2 },
      { ...makeOverviewRow(), id: 3, userId: 11 },
      { ...makeOverviewRow(), id: 4, hostId: 21 },
    ])
    const map = await service.getAccessMap(1, { userId: 10, role: 'admin' })
    expect(map.totals).toEqual({ activeHosts: 2, activeSessions: 4, uniqueUsers: 2, concurrentHosts: 1 })
    expect(map.hosts[0]).toMatchObject({ activeSessions: 3, uniqueUsers: 2 })
    expect(map.hosts[1]).toMatchObject({ activeSessions: 1, uniqueUsers: 1 })
  })

  it('refreshes after cache expiry even when the realtime event was lost', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const { repo, service } = fixture()
      await service.getAccessMap(1, { userId: 10, role: 'admin' })
      repo.findActiveOverview.mockResolvedValue([])
      clock.mockReturnValue(1_006_000)
      expect((await service.getAccessMap(1, { userId: 10, role: 'admin' })).totals.activeSessions).toBe(0)
      expect(repo.findActiveOverview).toHaveBeenCalledTimes(2)
    } finally { clock.mockRestore() }
  })

  it('keeps cache scoped by tenant, viewer and role', async () => {
    const { repo, service } = fixture()
    for (const [tenantId, userId, role] of [[1, 10, 'admin'], [2, 10, 'admin'], [1, 11, 'admin'], [1, 10, 'user']] as const) {
      await service.getAccessMap(tenantId, { userId, role })
      expect(repo.findActiveOverview).toHaveBeenLastCalledWith(tenantId, { userId, role: role.toUpperCase() })
    }
    expect(repo.findActiveOverview).toHaveBeenCalledTimes(4)
  })

  it('filters inaccessible hosts before counting people and sessions', async () => {
    const { repo } = fixture()
    repo.findActiveOverview.mockResolvedValue([makeOverviewRow(), { ...makeOverviewRow(), id: 2, hostId: 21, userId: 99 }])
    const sshRepo = { findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([20])) }
    const service = new SessionsService(repo as unknown as SessionsRepository, undefined, undefined, undefined, sshRepo as never)
    const map = await service.getAccessMap(1, { userId: 10, role: 'user' })
    expect(map.totals).toMatchObject({ activeHosts: 1, activeSessions: 1, uniqueUsers: 1 })
    expect(map.hosts.flatMap(host => host.sessions.map(session => session.user.id))).toEqual([10])
    expect(sshRepo.findHostIdsWithEffectivePermission).toHaveBeenCalledWith([20, 21], 1, 10, 'view', 'USER')
  })
})

describe('closing sessions under runtime failures', () => {
  it.each(['not_found', 'not_active', 'not_in_runtime', 'closed'] as const)('reports %s without claiming another session was closed', async reason => {
    const repo = {
      findActiveRuntimeSession: vi.fn().mockResolvedValue(reason === 'not_found' ? null : { id: 123, active: reason !== 'not_active', connectionMethod: 'direct' }),
      endStaleActive: vi.fn().mockResolvedValue(0),
    }
    const runtime = { close: vi.fn().mockReturnValue(reason === 'closed') }
    const bus = { closeSession: vi.fn().mockResolvedValue({ closed: false }) }
    const service = new SessionsService(repo as unknown as SessionsRepository, runtime as never, undefined, bus as never)
    expect(await service.closeActiveSession(7, 123)).toMatchObject({ closed: reason === 'closed', reason })
    expect(repo.findActiveRuntimeSession).toHaveBeenCalledWith(7, 123)
    if (reason === 'not_found' || reason === 'not_active') expect(runtime.close).not.toHaveBeenCalled()
    else expect(runtime.close).toHaveBeenCalledWith(123, 'admin_closed')
    if (reason === 'not_in_runtime') expect(repo.endStaleActive).toHaveBeenCalledTimes(1)
  })

  it('closes a session owned by another gateway through the control bus', async () => {
    const repo = { findActiveRuntimeSession: vi.fn().mockResolvedValue({ id: 123, active: true, connectionMethod: 'direct' }) }
    const runtime = { close: vi.fn().mockReturnValue(false) }
    const bus = { closeSession: vi.fn().mockResolvedValue({ closed: true }) }
    const service = new SessionsService(repo as unknown as SessionsRepository, runtime as never, undefined, bus as never)
    expect(await service.closeActiveSession(7, 123)).toMatchObject({ closed: true, reason: 'closed' })
    expect(bus.closeSession).toHaveBeenCalledWith(123)
  })

  it('propagates a control bus failure instead of reporting success', async () => {
    const repo = { findActiveRuntimeSession: vi.fn().mockResolvedValue({ id: 123, active: true, connectionMethod: 'direct' }) }
    const bus = { closeSession: vi.fn().mockRejectedValue(new Error('redis unavailable')) }
    const service = new SessionsService(repo as unknown as SessionsRepository, undefined, undefined, bus as never)
    await expect(service.closeActiveSession(7, 123)).rejects.toThrow('redis unavailable')
  })
})
