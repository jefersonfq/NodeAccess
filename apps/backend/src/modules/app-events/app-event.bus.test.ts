import { beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'

const JWT_SECRET = 'test-secret-with-at-least-thirty-two-chars'

function makeRedis() {
  return {
    publish: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn(),
  }
}

function makeWs() {
  return {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    once: vi.fn(),
  }
}

function tokenFor(userId: number, tenantId = 1) {
  return jwt.sign({
    sub: String(userId),
    tenantId,
    stage: 'authenticated', role: 'user', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, sessionVersion: 0,
  }, JWT_SECRET)
}

describe('AppEventBus websocket delivery', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:pass@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
    const { configureCurrentSessionReader } = await import('../auth/current-session.js')
    configureCurrentSessionReader( (_userId, tenantId) => Promise.resolve(({ tenantId, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true, sessionVersion: 0, role: 'USER', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false })))
  })

  it('envia mudanca direta de ACL para todos os clientes do tenant', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const first = makeWs()
    const second = makeWs()
    const otherTenant = makeWs()

    await bus.subscribe(first as never, tokenFor(10, 1))
    await bus.subscribe(second as never, tokenFor(11, 1))
    await bus.subscribe(otherTenant as never, tokenFor(12, 2))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 30,
      hostId: null,
      actorId: 1,
      principalType: 'GROUP',
      principalId: 7,
      action: 'upsert',
      changedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(first.send).toHaveBeenCalledTimes(2)
    expect(second.send).toHaveBeenCalledTimes(2)
    expect(otherTenant.send).toHaveBeenCalledTimes(1)
  })

  it('aceita evento de reparo de inventário como mudança de ACL', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const ws = makeWs()
    const handler = vi.fn()

    bus.onEvent(handler)
    await bus.subscribe(ws as never, tokenFor(10, 1))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 1,
      hostId: null,
      actorId: 10,
      principalType: 'ROLE',
      principalId: 1,
      action: 'repair',
      changedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(ws.send).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      action: 'repair',
    }))
  })

  it('envia mudanca de grupos somente para o usuario afetado', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const affected = makeWs()
    const otherUser = makeWs()

    await bus.subscribe(affected as never, tokenFor(10, 1))
    await bus.subscribe(otherUser as never, tokenFor(11, 1))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'user_acl_membership_changed',
      tenantId: 1,
      userId: 10,
      actorId: 11,
      previousGroupIds: [7],
      nextGroupIds: [],
      changedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(affected.send).toHaveBeenCalledTimes(2)
    expect(otherUser.send).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale identity snapshot when revocation precedes socket registration', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const { configureCurrentSessionReader } = await import('../auth/current-session.js')
    const state = { tenantId: 1, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true,
      sessionVersion: 0, role: 'USER' as const, isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false }
    let release!: (value: typeof state) => void
    const initialRead = new Promise<typeof state>(resolve => { release = resolve })
    let calls = 0
    configureCurrentSessionReader( () => Promise.resolve(++calls === 1 ? initialRead : { ...state, sessionVersion: 1 }))
    const bus = new AppEventBus(makeRedis() as never), ws = makeWs()
    const pending = bus.subscribe(ws as never, tokenFor(10, 1))
    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'user_sessions_revoked', tenantId: 1, userId: 10, sessionVersion: 1,
      reason: 'logout_all', changedAt: '2026-01-01T00:00:00.000Z',
    }))
    release(state)
    await pending
    expect(ws.close).toHaveBeenCalledWith(1008, 'Sessão revogada')
    expect(ws.send).not.toHaveBeenCalled()
  })

  it('closes only older sockets of the revoked principal, including delegated tenants', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const { configureCurrentSessionReader } = await import('../auth/current-session.js')
    let version = 0
    configureCurrentSessionReader( (id) => Promise.resolve(({ tenantId: 1, active: true, deletedAt: null,
      tenantActive: true, targetTenantActive: true, sessionVersion: version, role: 'USER',
      isPlatformAdmin: id === 10, canManageHosts: false, canViewLiveSessions: false })))
    const bus = new AppEventBus(makeRedis() as never)
    const old = makeWs(), current = makeWs(), other = makeWs()
    const delegated = (sessionVersion: number) => jwt.sign({ sub: '10', tenantId: 2, platformTenantId: 1,
      actingTenantId: 2, impersonatedByUserId: 10, role: 'admin', isPlatformAdmin: true,
      canManageHosts: true, canViewLiveSessions: true, stage: 'authenticated', sessionVersion }, JWT_SECRET)
    await bus.subscribe(old as never, delegated(0))
    await bus.subscribe(other as never, tokenFor(11, 1))
    version = 1
    await bus.subscribe(current as never, delegated(1))
    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'user_sessions_revoked', tenantId: 1, userId: 10, sessionVersion: 1,
      reason: 'logout_all', changedAt: '2026-01-01T00:00:00.000Z',
    }))
    expect(old.close).toHaveBeenCalledWith(1008, 'Sessão revogada')
    expect(current.close).not.toHaveBeenCalled()
    expect(other.close).not.toHaveBeenCalled()
  })

  it('envia mudanca de presenca de sessao para clientes do tenant', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const first = makeWs()
    const second = makeWs()
    const otherTenant = makeWs()
    const handler = vi.fn()

    bus.onEvent(handler)
    await bus.subscribe(first as never, tokenFor(10, 1))
    await bus.subscribe(second as never, tokenFor(11, 1))
    await bus.subscribe(otherTenant as never, tokenFor(12, 2))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'session_presence_changed',
      tenantId: 1,
      hostId: 20,
      sessionId: 99,
      userId: 10,
      action: 'started',
      changedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(first.send).toHaveBeenCalledTimes(2)
    expect(second.send).toHaveBeenCalledTimes(2)
    expect(otherTenant.send).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session_presence_changed',
      hostId: 20,
      action: 'started',
    }))
  })

  it('isola falha de envio de um websocket e continua processando o evento', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const broken = makeWs()
    const healthy = makeWs()
    const handler = vi.fn()

    broken.send
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('socket write failed')
      })
    bus.onEvent(handler)
    await bus.subscribe(broken as never, tokenFor(10, 1))
    await bus.subscribe(healthy as never, tokenFor(11, 1))

    const event = {
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 30,
      hostId: null,
      actorId: 1,
      principalType: 'GROUP',
      principalId: 7,
      action: 'delete',
      changedAt: '2026-01-01T00:00:00.000Z',
    }
    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify(event))

    expect(broken.send).toHaveBeenCalledTimes(2)
    expect(healthy.send).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 30,
    }))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      ...event,
      inventoryNodeId: 31,
    }))

    expect(broken.send).toHaveBeenCalledTimes(2)
    expect(healthy.send).toHaveBeenCalledTimes(3)
  })

  it('descarta evento ACL incompleto antes de enviar para clientes ou handlers', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const ws = makeWs()
    const handler = vi.fn()

    bus.onEvent(handler)
    await bus.subscribe(ws as never, tokenFor(10, 1))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 30,
      hostId: null,
      actorId: 1,
      principalType: 'GROUP',
      principalId: 7,
      changedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('descarta evento de grupos com arrays invalidos', async () => {
    const { AppEventBus } = await import('./app-event.bus.js')
    const bus = new AppEventBus(makeRedis() as never)
    const ws = makeWs()
    const handler = vi.fn()

    bus.onEvent(handler)
    await bus.subscribe(ws as never, tokenFor(10, 1))

    ;(bus as unknown as { handleMessage(raw: string): void }).handleMessage(JSON.stringify({
      type: 'user_acl_membership_changed',
      tenantId: 1,
      userId: 10,
      actorId: 11,
      previousGroupIds: [7],
      nextGroupIds: ['not-a-number'],
      changedAt: '2026-01-01T00:00:00.000Z',
    }))

    expect(ws.send).toHaveBeenCalledTimes(1)
    expect(handler).not.toHaveBeenCalled()
  })
})
