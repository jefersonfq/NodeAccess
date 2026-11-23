import jwt from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'
import type { User } from '@prisma/client'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '00'.repeat(32)
  process.env.NODE_ENV ||= 'test'
})

import { env } from '../../config/env.js'
import { AuthService } from './auth.service.js'
import type { LoginSessionRegistry } from './login-session.registry.js'

const user = { id: 42, tenantId: 7, email: 'sessions@example.test', role: 'USER', active: true, deletedAt: null, canManageHosts: false,
  forcePasswordChange: false, sessionVersion: 0 } as unknown as User
function harness(recordFails = false) {
  const userRepo = {
    isPlatformAdmin: vi.fn().mockResolvedValue(false), canViewLiveSessions: vi.fn().mockResolvedValue(false),
    findAvatarMetadata: vi.fn().mockResolvedValue(null), findSessionVersion: vi.fn().mockResolvedValue(0),
    findTenantById: vi.fn().mockResolvedValue({ id: 7, active: true }), findByIdInTenant: vi.fn().mockResolvedValue(user),
  }
  const redis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue('7'), del: vi.fn().mockResolvedValue(1) }
  const registry = {
    record: vi.fn(() => (recordFails ? Promise.reject(new Error('redis down')) : Promise.resolve())),
    touch: vi.fn().mockResolvedValue(undefined), forget: vi.fn().mockResolvedValue(undefined),
  }
  const service = new AuthService(userRepo as never, {} as never, redis as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    registry as unknown as LoginSessionRegistry)
  return { service, redis, registry }
}
const meta = { ip: '203.0.113.10', userAgent: 'synthetic-browser' }

describe('NA-0187 login sessions in AuthService', () => {
  it('binds the access token to its refresh token (sid) and records IP, browser and method', async () => {
    const { service, registry } = harness()
    const tokens = await service.issueTokensForUser(user, 7, 'oidc', meta)
    const access = jwt.verify(tokens.accessToken, env.JWT_SECRET) as { sid: string }
    const refresh = jwt.verify(tokens.refreshToken, env.JWT_SECRET) as { jti: string }
    expect(access.sid).toBe(refresh.jti)
    expect(registry.record).toHaveBeenCalledWith(refresh.jti, { userId: 42, tenantId: 7, authMethod: 'oidc' }, meta, expect.any(Number))
  })
  it('never blocks the login when the record cannot be written', async () => {
    const { service } = harness(true)
    await expect(service.issueTokensForUser(user, 7, 'local', meta)).resolves.toHaveProperty('accessToken')
  })
  it('refresh keeps the same sid and updates last use; logout forgets the record', async () => {
    const { service, registry, redis } = harness()
    const refreshToken = jwt.sign({ sub: '42', jti: '00000000-0000-4000-8000-000000000001', authMethod: 'ldap', sessionVersion: 0, stage: 'refresh' }, env.JWT_SECRET, { expiresIn: '5m' })
    const { accessToken } = await service.refresh(refreshToken, meta)
    expect((jwt.verify(accessToken, env.JWT_SECRET) as { sid: string }).sid).toBe('00000000-0000-4000-8000-000000000001')
    expect(registry.touch).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', { userId: 42, tenantId: 7, authMethod: 'ldap' }, meta)
    await service.logout(refreshToken)
    expect(redis.del).toHaveBeenCalledWith('refresh:00000000-0000-4000-8000-000000000001')
    expect(registry.forget).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001')
  })
})
