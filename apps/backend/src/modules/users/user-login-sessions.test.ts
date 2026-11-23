import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureCurrentSessionReader, configureLoginSessionChecker } from '../auth/current-session.js'
import type { LoginSessionRegistry } from '../auth/login-session.registry.js'
import { userLoginSessionRoutes } from './user-login-sessions.routes.js'
import { UserLoginSessionsService } from './user-login-sessions.service.js'

afterEach(() => { configureCurrentSessionReader(undefined); configureLoginSessionChecker(undefined) })
const sid = '00000000-0000-4000-8000-000000000001', ref = 'a'.repeat(32)
const record = { userId: 20, tenantId: 7, authMethod: 'local', ip: '203.0.113.10', lastIp: '198.51.100.7', userAgent: 'ua', createdAt: 1, lastSeenAt: 2 }
function parts() {
  const users = {
    findByIdInTenant: vi.fn((id: number, tenantId: number) => Promise.resolve(tenantId === 7 && (id === 20 || id === 11) ? { id, deletedAt: null } : null)),
    findSessionVersion: vi.fn().mockResolvedValue(3), incrementSessionVersion: vi.fn().mockResolvedValue(4), logAdminEvent: vi.fn().mockResolvedValue(undefined),
  }
  const registry = {
    online: vi.fn().mockResolvedValue([{ userId: 20, sessions: 2, lastSeenAt: 2 }]),
    list: vi.fn().mockResolvedValue([{ ref, authMethod: 'local', ip: '203.0.113.10', lastIp: null, userAgent: 'ua', createdAt: 1, lastSeenAt: 2, current: false }]),
    revoke: vi.fn().mockResolvedValue({ state: 'revoked', record }),
  }
  const bus = { publish: vi.fn().mockResolvedValue(undefined) }
  return { users, registry, bus, service: new UserLoginSessionsService(users as never, registry as unknown as LoginSessionRegistry, bus as never) }
}
async function appFor(role: 'admin' | 'user' = 'admin') {
  configureCurrentSessionReader(() => Promise.resolve({ tenantId: 7, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true, sessionVersion: 0,
    role: role === 'admin' ? 'ADMIN' : 'USER', isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true }))
  configureLoginSessionChecker(() => Promise.resolve(true))
  const p = parts(), app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({ sub: '11', email: 'admin@example.test', role, isPlatformAdmin: false, tenantId: 7, canManageHosts: true, canViewLiveSessions: true,
      forcePasswordChange: false, sessionVersion: 0, sid, stage: 'authenticated' })
  })
  await app.register(async instance => { await userLoginSessionRoutes(instance, p.service) })
  return { app, ...p }
}

describe('NA-0187 login sessions admin routes', () => {
  it('lists online users and one user\'s sessions inside the admin tenant, marking the admin\'s own session', async () => {
    const { app, registry } = await appFor()
    try {
      expect((await app.inject({ method: 'GET', url: '/online' })).json()).toEqual({ data: [{ userId: 20, sessions: 2, lastSeenAt: 2 }] })
      expect(registry.online).toHaveBeenCalledWith(7)
      const list = await app.inject({ method: 'GET', url: '/20/login-sessions' })
      expect(list.statusCode).toBe(200); expect(list.json<{ data: unknown[] }>().data[0]).toMatchObject({ ref, ip: '203.0.113.10' })
      expect(registry.list).toHaveBeenCalledWith(7, 20, sid)
      expect((await app.inject({ method: 'GET', url: '/99/login-sessions' })).statusCode).toBe(404)
    } finally { await app.close() }
  })
  it('refuses non-admins', async () => {
    const { app, registry } = await appFor('user')
    try {
      for (const req of [{ method: 'GET', url: '/online' }, { method: 'GET', url: '/20/login-sessions' }, { method: 'DELETE', url: `/20/login-sessions/${ref}` },
        { method: 'POST', url: '/20/login-sessions/revoke-all' }] as const) expect((await app.inject(req)).statusCode).toBe(403)
      expect(registry.online).not.toHaveBeenCalled(); expect(registry.revoke).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('disconnects one session with audit (IP, no token), and maps missing/current/malformed references', async () => {
    const { app, registry, users } = await appFor()
    try {
      expect((await app.inject({ method: 'DELETE', url: `/20/login-sessions/${ref}` })).statusCode).toBe(204)
      expect(registry.revoke).toHaveBeenCalledWith(7, 20, ref, sid)
      const audit = users.logAdminEvent.mock.calls[0]![0] as { action: string; details: string }
      expect(audit).toMatchObject({ adminId: 11, action: 'LOGIN_SESSION_REVOKED', targetType: 'User', targetId: 20 })
      expect(JSON.parse(audit.details)).toEqual({ ip: '203.0.113.10', lastIp: '198.51.100.7', authMethod: 'local' })
      registry.revoke.mockResolvedValueOnce({ state: 'missing' })
      expect((await app.inject({ method: 'DELETE', url: `/20/login-sessions/${ref}` })).statusCode).toBe(404)
      registry.revoke.mockResolvedValueOnce({ state: 'current' })
      expect((await app.inject({ method: 'DELETE', url: `/20/login-sessions/${ref}` })).statusCode).toBe(409)
      expect((await app.inject({ method: 'DELETE', url: '/20/login-sessions/not-a-ref' })).statusCode).toBe(400)
      expect((await app.inject({ method: 'DELETE', url: `/99/login-sessions/${ref}` })).statusCode).toBe(404)
      expect(registry.revoke).toHaveBeenCalledTimes(3)
    } finally { await app.close() }
  })
  it('disconnects all sessions of another user through the session version, never the admin\'s own', async () => {
    const { app, users, bus } = await appFor()
    try {
      expect((await app.inject({ method: 'POST', url: '/20/login-sessions/revoke-all' })).statusCode).toBe(204)
      expect(users.incrementSessionVersion).toHaveBeenCalledWith(20, 7, 3)
      expect(bus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_sessions_revoked', tenantId: 7, userId: 20, sessionVersion: 4, reason: 'logout_all' }))
      expect(users.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_SESSIONS_REVOKED_ALL', targetId: 20 }))
      expect((await app.inject({ method: 'POST', url: '/11/login-sessions/revoke-all' })).statusCode).toBe(409)
      users.incrementSessionVersion.mockResolvedValueOnce(null)
      expect((await app.inject({ method: 'POST', url: '/20/login-sessions/revoke-all' })).statusCode).toBe(409)
      users.findSessionVersion.mockResolvedValueOnce(null)
      expect((await app.inject({ method: 'POST', url: '/20/login-sessions/revoke-all' })).statusCode).toBe(404)
      expect((await app.inject({ method: 'POST', url: '/99/login-sessions/revoke-all' })).statusCode).toBe(404)
    } finally { await app.close() }
  })
  it('a disconnected admin session is refused before reaching the service', async () => {
    const { app, registry } = await appFor()
    configureLoginSessionChecker(() => Promise.resolve(false))
    try {
      expect((await app.inject({ method: 'GET', url: '/online' })).statusCode).toBe(401)
      expect(registry.online).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
