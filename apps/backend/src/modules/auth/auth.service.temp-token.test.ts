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

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    tenantId: 7,
    name: 'MFA User',
    email: 'mfa@example.test',
    passwordHash: 'hash',
    role: 'USER',
    active: true,
    mfaEnabled: true,
    mfaSecret: 'mfa-secret',
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

function token(stage: 'mfa_setup' | 'mfa_pending', overrides: { sub?: string; tenantId?: number } = {}) {
  return jwt.sign(
    { sub: overrides.sub ?? '42', tenantId: overrides.tenantId ?? 7, stage },
    env.JWT_SECRET,
    { expiresIn: '5m' },
  )
}

function makeHarness(options: { tenantActive?: boolean; user?: User | null } = {}) {
  const userRepo = {
    findTenantById: vi.fn().mockResolvedValue({ id: 7, active: options.tenantActive ?? true }),
    findByIdInTenant: vi.fn().mockResolvedValue(options.user === undefined ? makeUser() : options.user),
    saveMfaSecret: vi.fn().mockResolvedValue(undefined),
    logAuthEvent: vi.fn().mockResolvedValue(undefined),
    isPlatformAdmin: vi.fn().mockResolvedValue(false),
    canViewLiveSessions: vi.fn().mockResolvedValue(false),
    findAvatarMetadata: vi.fn().mockResolvedValue(null),
    findSessionVersion: vi.fn().mockResolvedValue(0),
  }
  const totp = {
    generateSetup: vi.fn().mockReturnValue({ secret: 'new-secret', qrCode: 'otpauth://test' }),
    toQrDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,test'),
    verify: vi.fn().mockReturnValue(true),
  }
  const redis = { set: vi.fn().mockResolvedValue('OK') }
  return {
    service: new AuthService(userRepo as never, totp as never, redis as never),
    userRepo,
    totp,
  }
}

describe('AuthService temporary token tenant isolation', () => {
  it('configures TOTP only for an active user in the token tenant', async () => {
    const { service, userRepo, totp } = makeHarness()

    await expect(service.setupTotp(token('mfa_setup'))).resolves.toEqual({ qrCode: 'data:image/png;base64,test' })
    expect(userRepo.findTenantById).toHaveBeenCalledWith(7)
    expect(userRepo.findByIdInTenant).toHaveBeenCalledWith(42, 7)
    expect(totp.generateSetup).toHaveBeenCalledWith('mfa@example.test')
  })

  it('rejects the temporary token when its tenant is inactive', async () => {
    const { service, userRepo, totp } = makeHarness({ tenantActive: false })

    await expect(service.setupTotp(token('mfa_setup'))).rejects.toBeInstanceOf(UnauthorizedError)
    expect(userRepo.findByIdInTenant).not.toHaveBeenCalled()
    expect(totp.generateSetup).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'missing from the tenant', user: null },
    { label: 'inactive', user: makeUser({ active: false }) },
  ])('rejects a user that is $label', async ({ user }) => {
    const { service, totp } = makeHarness({ user })

    await expect(service.setupTotp(token('mfa_setup'))).rejects.toBeInstanceOf(UnauthorizedError)
    expect(totp.generateSetup).not.toHaveBeenCalled()
  })

  it('rejects malformed tenant or user identifiers before repository access', async () => {
    const { service, userRepo } = makeHarness()

    await expect(service.setupTotp(token('mfa_setup', { sub: 'invalid' })))
      .rejects.toBeInstanceOf(UnauthorizedError)
    expect(userRepo.findTenantById).not.toHaveBeenCalled()
    expect(userRepo.findByIdInTenant).not.toHaveBeenCalled()
  })

  it('verifies TOTP and issues tenant-scoped tokens after the isolation checks', async () => {
    const { service, userRepo, totp } = makeHarness()

    const result = await service.verifyTotp('123456', token('mfa_pending'), {})
    const access = jwt.verify(result.accessToken, env.JWT_SECRET) as { sub: string; tenantId: number }

    expect(access).toMatchObject({ sub: '42', tenantId: 7 })
    expect(totp.verify).toHaveBeenCalledWith('mfa-secret', '123456')
    expect(userRepo.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN' }))
  })
})
