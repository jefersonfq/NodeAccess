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
