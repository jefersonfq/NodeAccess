import { EventEmitter } from 'node:events'
import jwt from 'jsonwebtoken'
import type { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureCurrentSessionReader, type CurrentSessionState } from '../auth/current-session.js'
import { SshSessionRuntimeRegistry } from './ssh-session-runtime.registry.js'
import { SshGateway } from './ssh.gateway.js'
vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../config/env.js', () => ({ env: { JWT_SECRET: 'review-fixture', PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
afterEach(() => configureCurrentSessionReader(undefined))

const identity: CurrentSessionState = { tenantId: 1, active: true, deletedAt: null, tenantActive: true,
  targetTenantActive: true, sessionVersion: 0, role: 'USER', isPlatformAdmin: false,
  canManageHosts: false, canViewLiveSessions: false }

function fixture(protocol: 'SSH' | 'TELNET') {
  const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0,
    send: vi.fn(), close: vi.fn(() => { ws.readyState = 3; ws.emit('close') }) })
  const session = { close: vi.fn(() => Promise.resolve()), write: vi.fn(), resize: vi.fn() }
  const repo = {
    findHostWithCredentials: vi.fn().mockResolvedValue({ id: 20, tenantId: 1, name: 'fixture', ip: '127.0.0.1',
      port: 22, accessProtocol: protocol, deviceProfile: 'server_ssh', connectionMode: 'DIRECT',
      authType: 'PASSWORD', passwordEncrypted: 'fixture-encrypted', sshUser: 'probe', bastion: null }),
    hasEffectiveHostPermission: vi.fn().mockResolvedValue(true), getUserGroupIds: vi.fn().mockResolvedValue([]),
    getSessionLimits: vi.fn().mockResolvedValue({ multiConnect: true, maxPerUser: null, maxPerTenant: null }),
    startSession: vi.fn().mockResolvedValue(123), findUserSnapshot: vi.fn().mockResolvedValue({ name: 'Fixture', email: 'fixture@test.invalid' }),
    updateSessionRoute: vi.fn().mockResolvedValue(undefined), endSession: vi.fn().mockResolvedValue(undefined),
  }
  const broker = { publishDimensions: vi.fn(), registerSessionTransport: vi.fn(), unregisterSessionTransport: vi.fn(),
    publishEnded: vi.fn(), publishOutput: vi.fn(), publishError: vi.fn(), canOwnerSendInput: vi.fn(() => true) }
  const tunnels = { closeForSession: vi.fn().mockResolvedValue(undefined), listForUser: vi.fn(() => []), autoStartForSession: vi.fn().mockResolvedValue({ ok: [], errors: [] }) }
  const registry = new SshSessionRuntimeRegistry()
  const publisher = { publish: vi.fn().mockResolvedValue(undefined), clearSession: vi.fn() }
  const gateway = new SshGateway(repo as never, {} as never, tunnels as never, publisher as never,
    { shouldAuditSession: vi.fn().mockResolvedValue(true) } as never, broker as never, {} as never, {} as never,
    { publishEvent: vi.fn().mockResolvedValue(undefined) } as never, { openResolved: vi.fn().mockResolvedValue(session) } as never,
    registry, undefined, undefined, undefined, undefined, undefined, undefined, () => Promise.resolve(session))
  const token = jwt.sign({ sub: '10', tenantId: 1, stage: 'authenticated', role: 'user', sessionVersion: 0,
    isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false }, 'review-fixture')
  return { ws, session, repo, broker, tunnels, registry, publisher, connect: () => gateway.handleConnection(ws as unknown as WebSocket, token, 20) }
}

describe.each(['SSH', 'TELNET'] as const)('%s admission revocation with real gateway and injected transport', protocol => {
  it.each(['runtime', 'socket', 'identity', 'acl'] as const)('cleans up if %s changes before admission completes', async trigger => {
    const f = fixture(protocol)
    let reads = 0
    configureCurrentSessionReader(() => {
      reads++
      if (reads === 2) {
        expect(f.registry.has(123)).toBe(true)
        if (trigger === 'runtime') f.registry.close(123, 'acl_revoked')
        if (trigger === 'socket') f.ws.close()
        if (trigger === 'identity') return Promise.resolve(null)
      }
      return Promise.resolve(identity)
    })
    if (trigger === 'acl') f.repo.hasEffectiveHostPermission.mockResolvedValueOnce(true).mockResolvedValue(false)
    await f.connect()
    const reason = trigger === 'identity' ? 'session_revoked' : trigger === 'socket' ? 'socket_closed' : 'acl_revoked'
    await vi.waitFor(() => expect(f.repo.endSession).toHaveBeenCalledWith(123, expect.objectContaining({ endedReason: reason })))
    expect(f.registry.has(123)).toBe(false)
    expect(f.session.close).toHaveBeenCalledTimes(1)
    expect(f.session.write).not.toHaveBeenCalled()
    expect(f.broker.unregisterSessionTransport).toHaveBeenCalledWith(123)
    expect(f.repo.endSession).toHaveBeenCalledTimes(1)
    expect(f.tunnels.closeForSession).toHaveBeenCalledWith('123')
    expect(f.publisher.publish).toHaveBeenCalledWith('session_ended', expect.any(Object), expect.objectContaining({ reason }))
    expect(f.ws.listenerCount('message')).toBe(0)
  })
})
