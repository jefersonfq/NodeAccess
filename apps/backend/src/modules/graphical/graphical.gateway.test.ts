import { EventEmitter } from 'node:events'
import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureCurrentSessionReader } from '../auth/current-session.js'
import type { WebSocket } from 'ws'
import type { GraphicalSessionAdapterResult, GraphicalSessionTransport } from './graphical-session.adapter.js'
import { GraphicalSessionRuntimeRegistry } from './graphical-session-runtime.registry.js'

vi.mock('../../config/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret',
    FEATURE_SESSION_AUDIT: true,
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { GraphicalGateway } from './graphical.gateway.js'

beforeEach(() => {
  configureCurrentSessionReader((userId, tenantId) => Promise.resolve(userId === 10 && tenantId === 1 ? {
    tenantId: 1, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true,
    sessionVersion: 0, role: 'USER', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false,
  } : null))
})
afterEach(() => {
  configureCurrentSessionReader(undefined)
  vi.useRealTimers()
})

function token() {
  return jwt.sign({
    stage: 'authenticated',
    sub: '10',
    email: 'admin@example.com',
    role: 'user',
    isPlatformAdmin: false,
    tenantId: 1,
    canManageHosts: false,
    canViewLiveSessions: false,
    sessionVersion: 0,
    forcePasswordChange: false,
  }, 'test-secret')
}

function createWs() {
  const sent: unknown[] = []
  const emitter = new EventEmitter()
  const ws = Object.assign(emitter, {
    OPEN: 1,
    readyState: 1,
    send: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw))
    }),
    close: vi.fn(function close(this: { readyState: number }) {
      this.readyState = 3
      emitter.emit('close')
    }),
  }) as unknown as WebSocket & EventEmitter & { readyState: number }

  return {
    sent,
    ws,
  }
}

function createGateway(
  hostAccessProtocol: 'RDP' | 'VNC' | 'SSH' = 'RDP',
  adapterOpen: () => Promise<GraphicalSessionAdapterResult> = () => Promise.resolve({
    status: 'pending' as const,
    code: 'GRAPHICAL_GATEWAY_PENDING' as const,
    message: 'Gateway gráfico em preparação',
  }),
  hostOverrides: Record<string, unknown> = {},
  runtimeRegistry?: GraphicalSessionRuntimeRegistry,
) {
  const repo = {
    findHostWithCredentials: vi.fn(() => Promise.resolve({
      id: 20,
      name: 'srv-rdp',
      ip: '10.0.0.20',
      port: hostAccessProtocol === 'RDP' ? 3389 : 22,
      accessProtocol: hostAccessProtocol,
      scope: 'GLOBAL',
      ownerId: null,
      groupId: null,
      tenantId: 1,
      sshUser: hostAccessProtocol === 'RDP' ? 'rdp-user' : 'ssh-user',
      passwordEncrypted: hostAccessProtocol === 'RDP' ? 'encrypted-password' : null,
      ...hostOverrides,
    })),
    hasEffectiveHostPermission: vi.fn(() => Promise.resolve(true)),
    getUserGroupIds: vi.fn(() => Promise.resolve([2])),
    startSession: vi.fn(() => Promise.resolve(123)),
    findUserSnapshot: vi.fn(() => Promise.resolve({ name: 'Admin', email: 'admin@example.com' })),
    endSession: vi.fn(() => Promise.resolve(undefined)),
    touchSession: vi.fn(() => Promise.resolve(undefined)),
  }
  const publisher = {
    publish: vi.fn(() => Promise.resolve(undefined)),
    clearSession: vi.fn(),
  }
  const policy = {
    shouldAuditSession: vi.fn(() => Promise.resolve(true)),
  }
  const adapter = {
    open: vi.fn(adapterOpen),
  }

  return {
    gateway: new GraphicalGateway(repo as never, publisher as never, policy as never, adapter, runtimeRegistry),
    repo,
    publisher,
    policy,
    adapter,
  }
}

describe('GraphicalGateway', () => {
  it('rejects a graphical session without effective connect permission', async () => {
    const { gateway, repo, adapter } = createGateway()
    repo.hasEffectiveHostPermission.mockResolvedValue(false)
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20)

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'error',
      message: 'Sem permissão para conectar a este host',
    }))
    expect(adapter.open).not.toHaveBeenCalled()
    expect(repo.startSession).not.toHaveBeenCalled()
  })

  it('reserves and audits a pending graphical RDP session', async () => {
    const { gateway, repo, publisher, policy, adapter } = createGateway()
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20, {
      clientIp: '127.0.0.1',
      userAgent: 'vitest',
      initialWidth: 1440,
      initialHeight: 900,
      initialDpi: 144,
    })

    expect(repo.startSession).toHaveBeenCalledWith(10, 20, expect.objectContaining({
      clientIp: '127.0.0.1',
      userAgent: 'vitest',
      connectionMethod: 'rdp_gateway_pending',
    }))
    expect(policy.shouldAuditSession).toHaveBeenCalledWith(1, 10, [2])
    expect(publisher.publish).toHaveBeenCalledWith('session_started', expect.objectContaining({
      sessionId: 123,
      tenantId: 1,
      userId: 10,
      hostId: 20,
    }), expect.objectContaining({
      connectionMethod: 'rdp_gateway_pending',
      accessProtocol: 'rdp',
      gatewayStatus: 'pending',
    }))
    expect(repo.endSession).toHaveBeenCalledWith(123, { endedReason: 'graphical_gateway_pending' })
    expect(adapter.open).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 123,
      tenantId: 1,
      userId: 10,
      protocol: 'rdp',
      connectionMethod: 'rdp_gateway_pending',
      initialWidth: 1440,
      initialHeight: 900,
      initialDpi: 144,
    }))
    expect(publisher.publish).toHaveBeenCalledWith('session_ended', expect.any(Object), expect.objectContaining({
      reason: 'graphical_gateway_pending',
    }))
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'graphical_gateway_pending',
      sessionId: 123,
      connectionMethod: 'rdp_gateway_pending',
      protocol: 'rdp',
      hostId: 20,
    }))
  })

  it('bridges a connected graphical transport without ending the session immediately', async () => {
    vi.useFakeTimers()
    class FakeTransport extends EventEmitter implements GraphicalSessionTransport {
      writes: string[] = []
      closed = false

      write(data: string): void {
        this.writes.push(data)
      }

      close(): void {
        this.closed = true
      }

      onData(handler: (data: Buffer) => void): void {
        this.on('data', handler)
      }

      onClose(handler: () => void): void {
        this.once('close', handler)
      }

      onError(handler: (err: Error) => void): void {
        this.once('error', handler)
      }
    }

    const transport = new FakeTransport()
    const { gateway, repo, publisher } = createGateway('RDP', () => Promise.resolve({
      status: 'connected',
      code: 'GRAPHICAL_GATEWAY_CONNECTED',
      message: 'Gateway gráfico conectado',
      transport,
    }))
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20)

    expect(sent).toContainEqual(expect.objectContaining({
      type: 'graphical_gateway_connected',
      code: 'GRAPHICAL_GATEWAY_CONNECTED',
      sessionId: 123,
    }))
    expect(repo.endSession).not.toHaveBeenCalled()
    expect(repo.touchSession).toHaveBeenCalledWith(123)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(repo.touchSession).toHaveBeenCalledTimes(2)

    transport.emit('data', Buffer.from('4.sync,1.1;'))
    expect(sent).toContainEqual({
      type: 'guacd',
      data: '4.sync,1.1;',
    })

    ws.emit('message', JSON.stringify({ type: 'guacd', data: '5.mouse,1.0,1.0,1.0;' }))
    expect(transport.writes).toContain('5.mouse,1.0,1.0,1.0;')
    expect(sent).toContainEqual({
      type: 'graphical_gateway_input_forwarded',
      count: 1,
      lastOpcode: 'mouse',
    })

    const keyMessage = Buffer.from(JSON.stringify({ type: 'guacd', data: '3.key,5.65293,1.1;' }))
    ws.emit('message', keyMessage.buffer.slice(keyMessage.byteOffset, keyMessage.byteOffset + keyMessage.byteLength))
    expect(transport.writes).toContain('3.key,5.65293,1.1;')
    expect(sent).toContainEqual({
      type: 'graphical_gateway_input_forwarded',
      count: 2,
      lastOpcode: 'key',
    })

    ws.emit('message', JSON.stringify({ type: 'guacd', data: '4.sync,1.1;' }))
    expect(transport.writes).toContain('4.sync,1.1;')
    expect(sent).not.toContainEqual({
      type: 'graphical_gateway_input_forwarded',
      count: 3,
      lastOpcode: 'sync',
    })

    ws.emit('message', JSON.stringify({ type: 'graphical_disconnect' }))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(transport.closed).toBe(true)
    expect(repo.endSession).toHaveBeenCalledWith(123, { endedReason: 'user_closed' })
    expect(publisher.publish).toHaveBeenCalledWith('session_ended', expect.any(Object), expect.objectContaining({
      reason: 'user_closed',
      gatewayStatus: 'closed',
    }))

    const touchCountAfterClose = repo.touchSession.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(repo.touchSession).toHaveBeenCalledTimes(touchCountAfterClose)

    ws.emit('close')
    await Promise.resolve()
    expect(transport.closed).toBe(true)
    vi.useRealTimers()
  })

  it.each([
    ['RDP', 'admin_closed'], ['RDP', 'acl_revoked'], ['VNC', 'acl_revoked'],
    ['RDP', 'session_revoked'], ['VNC', 'session_revoked'],
  ] as const)('closes %s through runtime registry with reason %s', async (protocol, reason) => {
    class FakeTransport extends EventEmitter implements GraphicalSessionTransport {
      closed = false

      write(): void {}

      close(): void {
        this.closed = true
      }

      onData(handler: (data: Buffer) => void): void {
        this.on('data', handler)
      }

      onClose(handler: () => void): void {
        this.once('close', handler)
      }

      onError(handler: (err: Error) => void): void {
        this.once('error', handler)
      }
    }

    const transport = new FakeTransport()
    const runtimeRegistry = new GraphicalSessionRuntimeRegistry()
    const { gateway, repo, publisher } = createGateway(protocol, () => Promise.resolve({
      status: 'connected',
      code: 'GRAPHICAL_GATEWAY_CONNECTED',
      message: 'Gateway gráfico conectado',
      transport,
    }), {}, runtimeRegistry)
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20)

    expect(runtimeRegistry.has(123)).toBe(true)
    expect(runtimeRegistry.close(123, reason)).toBe(true)
    await vi.waitFor(() => {
      expect(publisher.publish).toHaveBeenCalledWith('session_ended', expect.any(Object), expect.objectContaining({
        reason,
        gatewayStatus: 'closed',
      }))
    })

    expect(transport.closed).toBe(true)
    expect(repo.endSession).toHaveBeenCalledWith(123, { endedReason: reason })
    expect(repo.endSession).toHaveBeenCalledTimes(1)
    expect(runtimeRegistry.close(123, reason)).toBe(false)
    expect(sent).toContainEqual({
      type: 'closed',
      reason,
    })
    expect(runtimeRegistry.has(123)).toBe(false)
  })

  it.each(['identity', 'acl'] as const)('closes transport if %s is revoked during graphical adapter connection', async trigger => {
    let reads = 0
    configureCurrentSessionReader(() => Promise.resolve(++reads === 1 || trigger === 'acl' ? {
      tenantId: 1, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true,
      sessionVersion: 0, role: 'USER', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false,
    } : null))
    const transport = {
      write: vi.fn(), close: vi.fn(), onData: vi.fn(), onClose: vi.fn(), onError: vi.fn(),
    } satisfies GraphicalSessionTransport
    const registry = new GraphicalSessionRuntimeRegistry()
    const { gateway, repo } = createGateway('RDP', () => Promise.resolve({
      status: 'connected', code: 'GRAPHICAL_GATEWAY_CONNECTED', message: 'fixture', transport,
    }), {}, registry)
    if (trigger === 'acl') repo.hasEffectiveHostPermission.mockResolvedValueOnce(true).mockResolvedValue(false)
    const { ws, sent } = createWs()
    await gateway.handleConnection(ws, token(), 20)
    expect(reads).toBe(2)
    expect(transport.close).toHaveBeenCalledTimes(1)
    expect(transport.write).not.toHaveBeenCalled()
    expect(transport.onData).not.toHaveBeenCalled()
    expect(repo.endSession).toHaveBeenCalledWith(123, { endedReason: trigger === 'identity' ? 'session_revoked' : 'acl_revoked' })
    expect(registry.has(123)).toBe(false)
    expect(sent).not.toContainEqual(expect.objectContaining({ type: 'graphical_gateway_connected' }))
  })

  it('does not reserve a graphical session for text terminal protocols', async () => {
    const { gateway, repo } = createGateway('SSH')
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20)

    expect(repo.startSession).not.toHaveBeenCalled()
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'TEXT_TERMINAL_PROTOCOL',
    }))
  })

  it('opens RDP graphical sessions without saved credentials so the remote login screen can handle auth', async () => {
    const { gateway, repo, adapter } = createGateway('RDP', undefined, {
      sshUser: '',
      passwordEncrypted: null,
    })
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20)

    expect(repo.startSession).toHaveBeenCalled()
    expect(adapter.open).toHaveBeenCalledWith(expect.not.objectContaining({
      rdpCredentials: expect.anything() as unknown,
    }))
    expect(sent).not.toContainEqual(expect.objectContaining({
      type: 'graphical_credentials_required',
    }))
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'graphical_gateway_pending',
    }))
  })

  it('can request session-only RDP credentials when remote login does not produce video', async () => {
    const { gateway, repo, adapter } = createGateway('RDP', undefined, {
      sshUser: '',
      passwordEncrypted: null,
    })
    const { ws, sent } = createWs()

    const connection = gateway.handleConnection(ws, token(), 20, {
      rdpCredentialMode: 'session',
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'graphical_credentials_required',
      code: 'RDP_CREDENTIALS_REQUIRED',
    }))

    ws.emit('message', JSON.stringify({
      type: 'graphical_credentials',
      username: 'session-user',
      password: 'session-password',
      domain: 'ACME',
    }))
    await connection

    expect(repo.startSession).toHaveBeenCalled()
    expect(adapter.open).toHaveBeenCalledWith(expect.objectContaining({
      rdpCredentials: {
        username: 'session-user',
        password: 'session-password',
        domain: 'ACME',
      },
    }))
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'graphical_gateway_pending',
    }))
  })

  it('ends the reserved session when the graphical adapter fails', async () => {
    const { gateway, repo, publisher } = createGateway('RDP', () => Promise.reject(new Error('guacd unavailable')))
    const { ws, sent } = createWs()

    await gateway.handleConnection(ws, token(), 20)

    expect(repo.startSession).toHaveBeenCalled()
    expect(repo.endSession).toHaveBeenCalledWith(123, { endedReason: 'graphical_gateway_pending' })
    expect(publisher.publish).toHaveBeenCalledWith('session_ended', expect.any(Object), expect.objectContaining({
      reason: 'graphical_gateway_adapter_failed',
      gatewayStatus: 'failed',
      errorMessage: 'guacd unavailable',
    }))
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'GRAPHICAL_GATEWAY_CONNECT_FAILED',
    }))
  })
})
