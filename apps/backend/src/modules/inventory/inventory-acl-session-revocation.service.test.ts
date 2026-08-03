import { describe, expect, it, vi } from 'vitest'
import type { AppEvent, AppEventBus } from '../app-events/app-event.bus.js'
import { InventoryAclSessionRevocationService } from './inventory-acl-session-revocation.service.js'

vi.mock('../../config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

function createService(options: {
  sessions?: Array<{ id: number; userId: number; userRole: 'ADMIN' | 'USER'; hostId: number; connectionMethod: string }>
  closedTunnels?: number
} = {}) {
  let handler: ((event: AppEvent) => void | Promise<void>) | null = null
  const appEventBus = {
    onEvent: vi.fn((registered) => {
      handler = registered
      return vi.fn()
    }),
  } as unknown as AppEventBus
  const sessionsRepo = {
    findActiveAuthenticatedByInventoryNode: vi.fn(async () => options.sessions ?? [
      { id: 101, userId: 10, userRole: 'USER', hostId: 20, connectionMethod: 'direct' },
      { id: 102, userId: 10, userRole: 'USER', hostId: 21, connectionMethod: 'direct' },
      { id: 103, userId: 1, userRole: 'ADMIN', hostId: 22, connectionMethod: 'rdp_gateway_pending' },
    ]),
    findActiveAuthenticatedByUser: vi.fn(async () => options.sessions ?? [
      { id: 101, userId: 10, userRole: 'USER', hostId: 20, connectionMethod: 'direct' },
      { id: 102, userId: 10, userRole: 'USER', hostId: 21, connectionMethod: 'direct' },
    ]),
  }
  const sshRepo = {
    findHostIdsWithEffectivePermission: vi.fn(async (
      hostIds: number[],
      _tenantId: number,
      _userId: number,
      _permission: string,
      role: 'ADMIN' | 'USER',
    ) => role === 'ADMIN' ? new Set(hostIds) : new Set([21])),
  }
  const runtimeControlBus = {
    closeSession: vi.fn(async () => ({ closed: true, handledByRuntime: true })),
  }
  const logRepo = {
    logAdminEvent: vi.fn(async () => undefined),
  }
  const activeTunnelCloser = {
    closeRevokedByAclChange: vi.fn(async () => options.closedTunnels ?? 0),
  }

  new InventoryAclSessionRevocationService(
    appEventBus,
    sessionsRepo as never,
    sshRepo as never,
    runtimeControlBus as never,
    logRepo as never,
    activeTunnelCloser,
  )

  if (!handler) throw new Error('handler not registered')
  return { handler, sessionsRepo, sshRepo, runtimeControlBus, logRepo, activeTunnelCloser }
}

describe('InventoryAclSessionRevocationService', () => {
  it('closes only active sessions that lost effective connect permission', async () => {
    const { handler, sessionsRepo, sshRepo, runtimeControlBus, logRepo, activeTunnelCloser } = createService()

    await handler({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 5,
      hostId: null,
      actorId: 99,
      principalType: 'GROUP',
      principalId: 7,
      action: 'delete',
      changedAt: '2026-07-09T00:00:00.000Z',
    })

    expect(sessionsRepo.findActiveAuthenticatedByInventoryNode).toHaveBeenCalledWith(1, 5)
    expect(sshRepo.findHostIdsWithEffectivePermission).toHaveBeenCalledWith([20, 21], 1, 10, 'connect', 'USER')
    expect(sshRepo.findHostIdsWithEffectivePermission).toHaveBeenCalledWith([22], 1, 1, 'connect', 'ADMIN')
    expect(runtimeControlBus.closeSession).toHaveBeenCalledTimes(1)
    expect(runtimeControlBus.closeSession).toHaveBeenCalledWith(101, undefined, 'acl_revoked')
    expect(activeTunnelCloser.closeRevokedByAclChange).toHaveBeenCalledWith(1)
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVENTORY_ACL_SESSION_REVOKED',
      targetId: 101,
    }))
  })

  it('revalida tuneis ativos mesmo quando nao ha sessoes abertas no inventario', async () => {
    const { handler, sshRepo, runtimeControlBus, activeTunnelCloser } = createService({
      sessions: [],
      closedTunnels: 2,
    })

    await handler({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 5,
      hostId: null,
      actorId: 99,
      principalType: 'USER',
      principalId: 10,
      action: 'delete',
      changedAt: '2026-07-09T00:00:00.000Z',
    })

    expect(sshRepo.findHostIdsWithEffectivePermission).not.toHaveBeenCalled()
    expect(runtimeControlBus.closeSession).not.toHaveBeenCalled()
    expect(activeTunnelCloser.closeRevokedByAclChange).toHaveBeenCalledWith(1)
  })

  it('closes active user sessions that lost connect after group membership changes', async () => {
    const { handler, sessionsRepo, sshRepo, runtimeControlBus, logRepo, activeTunnelCloser } = createService()

    await handler({
      type: 'user_acl_membership_changed',
      tenantId: 1,
      userId: 10,
      actorId: 99,
      previousGroupIds: [7],
      nextGroupIds: [],
      changedAt: '2026-07-09T00:00:00.000Z',
    })

    expect(sessionsRepo.findActiveAuthenticatedByUser).toHaveBeenCalledWith(1, 10)
    expect(sshRepo.findHostIdsWithEffectivePermission).toHaveBeenCalledWith([20, 21], 1, 10, 'connect', 'USER')
    expect(runtimeControlBus.closeSession).toHaveBeenCalledTimes(1)
    expect(runtimeControlBus.closeSession).toHaveBeenCalledWith(101, undefined, 'acl_revoked')
    expect(activeTunnelCloser.closeRevokedByAclChange).toHaveBeenCalledWith(1)
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'USER_ACL_MEMBERSHIP_SESSION_REVOKED',
      targetId: 101,
    }))
  })
})
