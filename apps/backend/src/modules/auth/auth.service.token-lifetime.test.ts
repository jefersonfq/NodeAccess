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
import { AuthService } from './auth.service.js'

function makeUser(): User {
  return {
    id: 42,
    tenantId: 7,
    name: 'Token User',
    email: 'token@example.test',
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
  } as User
}

describe('AuthService tenant token lifetimes', () => {
  it('aligns JWT expiration and Redis refresh TTL with the effective tenant policy', async () => {
    const userRepo = {
      isPlatformAdmin: vi.fn().mockResolvedValue(false),
      canViewLiveSessions: vi.fn().mockResolvedValue(false),
      findAvatarMetadata: vi.fn().mockResolvedValue(null),
    }
    const redis = { set: vi.fn().mockResolvedValue('OK') }
    const policy = {
      getPasswordLoginMode: vi.fn(),
      getTokenLifetimePolicy: vi.fn().mockResolvedValue({
        accessTokenSeconds: 5 * 60,
        refreshTokenSeconds: 2 * 24 * 60 * 60,
      }),
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

    const result = await service.issueTokensForUser(makeUser(), 7, 'oidc')
    const access = jwt.verify(result.accessToken, env.JWT_SECRET) as { iat: number; exp: number }
    const refresh = jwt.verify(result.refreshToken, env.JWT_SECRET) as {
      iat: number
      exp: number
      jti: string
      authMethod: string
    }

    expect(access.exp - access.iat).toBe(5 * 60)
    expect(refresh.exp - refresh.iat).toBe(2 * 24 * 60 * 60)
    expect(refresh.authMethod).toBe('oidc')
    expect(redis.set).toHaveBeenCalledWith(
      `refresh:${refresh.jti}`,
      '7',
      'EX',
      2 * 24 * 60 * 60,
    )
  })
})
