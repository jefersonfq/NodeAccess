import { describe, expect, it, vi } from 'vitest'
import type { User } from '@prisma/client'

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY = process.env.PEM_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV = process.env.NODE_ENV || 'test'
})

import { AuthService } from './auth.service.js'
import type { IdentityProvider, IdentityProviderAuthenticateResult } from './identity-provider.js'
import { UnauthorizedError } from '../../shared/errors.js'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    tenantId: 1,
    name: 'LDAP User',
    email: 'ldap.user@example.test',
    passwordHash: null,
    role: 'USER',
    active: true,
    mfaEnabled: false,
    mfaSecret: null,
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

function makeProvider(type: IdentityProvider['type'], result: IdentityProviderAuthenticateResult): IdentityProvider {
  return {
    type,
    providerKey: type,
    authenticate: vi.fn().mockResolvedValue(result),
  }
}

function makeHarness(options: {
  localResult: IdentityProviderAuthenticateResult
  ldapResult?: IdentityProviderAuthenticateResult
}) {
  const tenant = {
    id: 1,
    name: 'Default',
    slug: 'default',
    active: true,
  }

  const userRepo = {
    findTenantBySlug: vi.fn().mockResolvedValue(tenant),
    resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
    incrementFailedAttempts: vi.fn().mockResolvedValue(1),
    lockAccount: vi.fn().mockResolvedValue(undefined),
    logAuthEvent: vi.fn().mockResolvedValue(undefined),
  }
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  }
  const localProvider = makeProvider('local', options.localResult)
  const ldapProvider = options.ldapResult
    ? makeProvider('ldap', options.ldapResult)
    : undefined

  const service = new AuthService(
    userRepo as never,
    {} as never,
    redis as never,
    undefined,
    undefined,
    undefined,
    localProvider,
    ldapProvider,
  )

  return {
    service,
    userRepo,
    localProvider,
    ldapProvider,
  }
}

describe('AuthService LDAP authentication orchestration', () => {
  it('keeps local break-glass login independent from LDAP', async () => {
    const localUser = makeUser({ email: 'admin@example.test', passwordHash: 'hash', role: 'ADMIN' })
    const ldapUser = makeUser({ email: 'admin@example.test' })
    const { service, userRepo, ldapProvider } = makeHarness({
      localResult: { user: localUser, passwordValid: true },
      ldapResult: { user: ldapUser, passwordValid: true },
    })

    const result = await service.login('admin@example.test', 'local-password', 'default', {})

    expect(result.tempToken).toEqual(expect.any(String))
    expect(result.requiresMfaSetup).toBe(true)
    expect(ldapProvider?.authenticate).not.toHaveBeenCalled()
    expect(userRepo.resetFailedAttempts).toHaveBeenCalledWith(localUser.id)
  })

  it('authenticates with LDAP when local password is invalid and LDAP validates the user', async () => {
    const ldapUser = makeUser({ email: 'ldap.user@example.test', passwordHash: null })
    const { service, userRepo, localProvider, ldapProvider } = makeHarness({
      localResult: { user: ldapUser, passwordValid: false },
      ldapResult: { user: ldapUser, passwordValid: true },
    })

    const result = await service.login('ldap.user@example.test', 'corporate-password', 'default', {})

    expect(result.tempToken).toEqual(expect.any(String))
    expect(result.requiresMfaSetup).toBe(true)
    expect(localProvider.authenticate).toHaveBeenCalledWith({
      tenantId: 1,
      email: 'ldap.user@example.test',
      password: 'corporate-password',
    })
    expect(ldapProvider?.authenticate).toHaveBeenCalledWith({
      tenantId: 1,
      email: 'ldap.user@example.test',
      password: 'corporate-password',
    })
    expect(userRepo.resetFailedAttempts).toHaveBeenCalledWith(ldapUser.id)
  })

  it('fails closed for a provisioned LDAP user when LDAP is disabled or unreachable and no local password is valid', async () => {
    const provisionedUser = makeUser({ email: 'ldap.user@example.test', passwordHash: null })
    const { service, userRepo, ldapProvider } = makeHarness({
      localResult: { user: provisionedUser, passwordValid: false },
      ldapResult: { user: provisionedUser, passwordValid: false },
    })

    await expect(service.login('ldap.user@example.test', 'corporate-password', 'default', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)

    expect(ldapProvider?.authenticate).toHaveBeenCalled()
    expect(userRepo.incrementFailedAttempts).toHaveBeenCalledWith(provisionedUser.id)
    expect(userRepo.resetFailedAttempts).not.toHaveBeenCalled()
  })

  it('does not create a positive login on transient LDAP failure for an unknown local user', async () => {
    const { service, userRepo, ldapProvider } = makeHarness({
      localResult: { user: null, passwordValid: false },
      ldapResult: { user: null, passwordValid: false },
    })

    await expect(service.login('new.ldap@example.test', 'corporate-password', 'default', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)

    expect(ldapProvider?.authenticate).toHaveBeenCalled()
    expect(userRepo.incrementFailedAttempts).not.toHaveBeenCalled()
    expect(userRepo.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'LOGIN_FAILED',
      success: false,
    }))
  })
})
