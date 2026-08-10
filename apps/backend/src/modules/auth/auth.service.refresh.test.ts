import jwt from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'
import type { User } from '@prisma/client'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})

import { env } from '../../config/env.js'
import { UnauthorizedError } from '../../shared/errors.js'
import { AuthService } from './auth.service.js'
import type { AuthMethod } from '../../shared/guards.js'

const refreshKey = 'refresh:refresh-jti'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    tenantId: 7,
    name: 'Refresh User',
    email: 'refresh@example.test',
    passwordHash: 'hash',
    role: 'USER',
    active: true,
    mfaEnabled: true,
    mfaSecret: 'secret',
    failedLoginAttempts: 0,
    lockedUntil: null,
    canManageHosts: false,
    forcePasswordChange: false,
    preferencesJson: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as User
}

function makeHarness(options: {
  storedTenantId?: string
  tenantActive?: boolean
  user?: User | null
  subject?: string
  authMethod?: AuthMethod
  canRefresh?: boolean
} = {}) {
  const user = options.user === undefined ? makeUser() : options.user
  const userRepo = {
    findTenantById: vi.fn().mockResolvedValue({ id: 7, active: options.tenantActive ?? true }),
    findByIdInTenant: vi.fn().mockResolvedValue(user),
    isPlatformAdmin: vi.fn().mockResolvedValue(false),
    canViewLiveSessions: vi.fn().mockResolvedValue(false),
    findAvatarMetadata: vi.fn().mockResolvedValue(null),
  }
  const redis = {
    get: vi.fn().mockResolvedValue(options.storedTenantId ?? '7'),
    del: vi.fn().mockResolvedValue(1),
  }
  const policy = options.canRefresh === undefined ? undefined : {
    getPasswordLoginMode: vi.fn(),
    canRefreshSession: vi.fn().mockResolvedValue(options.canRefresh),
  }
  const service = new AuthService(
    userRepo as never,
    {} as never,
    redis as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    policy,
  )
  const refreshToken = jwt.sign(
    {
      sub: options.subject ?? '42',
      jti: 'refresh-jti',
      ...(options.authMethod && { authMethod: options.authMethod }),
      stage: 'refresh',
    },
    env.JWT_SECRET,
    { expiresIn: '5m' },
  )
  return { service, userRepo, redis, policy, refreshToken }
}

describe('AuthService refresh token tenant isolation', () => {
  it('renews an active user only inside the tenant stored with the refresh token', async () => {
    const { service, userRepo, redis, refreshToken } = makeHarness()

    const result = await service.refresh(refreshToken)
    const access = jwt.verify(result.accessToken, env.JWT_SECRET) as { sub: string; tenantId: number }

    expect(access).toMatchObject({ sub: '42', tenantId: 7 })
    expect(userRepo.findTenantById).toHaveBeenCalledWith(7)
    expect(userRepo.findByIdInTenant).toHaveBeenCalledWith(42, 7)
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('revokes refresh when the tenant is inactive', async () => {
    const { service, userRepo, redis, refreshToken } = makeHarness({ tenantActive: false })

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(userRepo.findByIdInTenant).not.toHaveBeenCalled()
    expect(redis.del).toHaveBeenCalledWith(refreshKey)
  })

  it.each([
    { label: 'missing from the tenant', user: null },
    { label: 'inactive', user: makeUser({ active: false }) },
  ])('revokes refresh when the user is $label', async ({ user }) => {
    const { service, redis, refreshToken } = makeHarness({ user })

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(redis.del).toHaveBeenCalledWith(refreshKey)
  })

  it('revokes refresh with an invalid stored tenant identifier', async () => {
    const { service, userRepo, redis, refreshToken } = makeHarness({ storedTenantId: 'invalid' })

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(userRepo.findTenantById).not.toHaveBeenCalled()
    expect(redis.del).toHaveBeenCalledWith(refreshKey)
  })

  it('revokes refresh with an invalid user identifier before repository access', async () => {
    const { service, userRepo, redis, refreshToken } = makeHarness({ subject: 'invalid' })

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(userRepo.findTenantById).not.toHaveBeenCalled()
    expect(userRepo.findByIdInTenant).not.toHaveBeenCalled()
    expect(redis.del).toHaveBeenCalledWith(refreshKey)
  })

  it('revokes an existing local session when the current policy no longer permits it', async () => {
    const { service, redis, policy, refreshToken } = makeHarness({
      authMethod: 'local',
      canRefresh: false,
    })

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(policy?.canRefreshSession).toHaveBeenCalledWith(7, 'refresh@example.test', 'local')
    expect(redis.del).toHaveBeenCalledWith(refreshKey)
  })

  it('keeps an OIDC session renewable when the current policy permits it', async () => {
    const { service, redis, policy, refreshToken } = makeHarness({
      authMethod: 'oidc',
      canRefresh: true,
    })

    await expect(service.refresh(refreshToken)).resolves.toMatchObject({ accessToken: expect.any(String) })
    expect(policy?.canRefreshSession).toHaveBeenCalledWith(7, 'refresh@example.test', 'oidc')
    expect(redis.del).not.toHaveBeenCalled()
  })
})
