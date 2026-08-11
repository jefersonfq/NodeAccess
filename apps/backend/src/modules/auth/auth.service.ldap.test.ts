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
import { AccountLockedError, UnauthorizedError } from '../../shared/errors.js'

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
  passwordLoginMode?: 'standard' | 'break_glass' | 'ldap_only' | 'blocked'
  discoverableTenantIds?: number[]
  failedAttempts?: number
  lockoutPolicy?: { maxAttempts: number; durationMinutes: number }
}) {
  const tenant = {
    id: 1,
    name: 'Default',
    slug: 'default',
    active: true,
  }

  const userRepo = {
    findTenantBySlug: vi.fn().mockResolvedValue(tenant),
    findTenantsByEmail: vi.fn().mockResolvedValue([
      { id: 1, name: 'Default', slug: 'default' },
      { id: 2, name: 'Private', slug: 'private' },
    ]),
    resetFailedAttempts: vi.fn().mockResolvedValue(undefined),
    incrementFailedAttempts: vi.fn().mockResolvedValue(options.failedAttempts ?? 1),
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
  const authPolicy = {
    getPasswordLoginMode: vi.fn().mockResolvedValue(options.passwordLoginMode ?? 'standard'),
    isEmailTenantDiscoveryEnabled: vi.fn().mockImplementation(async (tenantId: number) => (
      (options.discoverableTenantIds ?? [1, 2]).includes(tenantId)
    )),
    getPasswordLockoutPolicy: vi.fn().mockResolvedValue(
      options.lockoutPolicy ?? { maxAttempts: 5, durationMinutes: 15 },
    ),
  }

  const service = new AuthService(
    userRepo as never,
    {} as never,
    redis as never,
    undefined,
    undefined,
    undefined,
    localProvider,
    ldapProvider,
    authPolicy,
  )

  return {
    service,
    userRepo,
    localProvider,
    ldapProvider,
    authPolicy,
  }
}

describe('AuthService LDAP authentication orchestration', () => {
  it('returns only tenants that allow email discovery', async () => {
    const { service, userRepo, authPolicy } = makeHarness({
      localResult: { user: null, passwordValid: false },
      discoverableTenantIds: [1],
    })

    await expect(service.lookupTenantsByEmail('user@example.test')).resolves.toEqual([
      { name: 'Default', slug: 'default' },
    ])
    expect(userRepo.findTenantsByEmail).toHaveBeenCalledWith('user@example.test')
    expect(authPolicy.isEmailTenantDiscoveryEnabled).toHaveBeenCalledTimes(2)
  })

  it('hides a tenant when its discovery policy cannot be evaluated', async () => {
    const { service, authPolicy } = makeHarness({ localResult: { user: null, passwordValid: false } })
    authPolicy.isEmailTenantDiscoveryEnabled.mockRejectedValueOnce(new Error('policy unavailable'))

    await expect(service.lookupTenantsByEmail('user@example.test')).resolves.toEqual([
      { name: 'Private', slug: 'private' },
    ])
  })

  it('fails closed when the requested tenant slug does not exist', async () => {
    const localUser = makeUser({ email: 'admin@example.test', passwordHash: 'hash', role: 'ADMIN' })
    const { service, userRepo, localProvider } = makeHarness({
      localResult: { user: localUser, passwordValid: true },
    })
    userRepo.findTenantBySlug.mockResolvedValueOnce(null)

    await expect(service.login('admin@example.test', 'password', 'unknown-tenant', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)

    expect(userRepo.findTenantBySlug).toHaveBeenCalledTimes(1)
    expect(userRepo.findTenantBySlug).toHaveBeenCalledWith('unknown-tenant')
    expect(localProvider.authenticate).not.toHaveBeenCalled()
  })

  it('keeps local break-glass login independent from LDAP', async () => {
    const localUser = makeUser({ email: 'admin@example.test', passwordHash: 'hash', role: 'ADMIN' })
    const ldapUser = makeUser({ email: 'admin@example.test' })
    const { service, userRepo, ldapProvider } = makeHarness({
      localResult: { user: localUser, passwordValid: true },
      ldapResult: { user: ldapUser, passwordValid: true },
      passwordLoginMode: 'break_glass',
    })

    const result = await service.login('admin@example.test', 'local-password', 'default', {})

    expect(result.tempToken).toEqual(expect.any(String))
    expect(result.requiresMfaSetup).toBe(true)
    expect(ldapProvider?.authenticate).not.toHaveBeenCalled()
    expect(userRepo.resetFailedAttempts).toHaveBeenCalledWith(localUser.id)
  })

  it('blocks password and LDAP login when the tenant requires SSO', async () => {
    const ldapUser = makeUser()
    const { service, localProvider, ldapProvider, userRepo } = makeHarness({
      localResult: { user: ldapUser, passwordValid: false },
      ldapResult: { user: ldapUser, passwordValid: true },
      passwordLoginMode: 'blocked',
    })

    await expect(service.login('ldap.user@example.test', 'password', 'default', {}))
      .rejects.toThrow('Não foi possível entrar')
    expect(localProvider.authenticate).not.toHaveBeenCalled()
    expect(ldapProvider?.authenticate).not.toHaveBeenCalled()
    expect(userRepo.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN_FAILED' }))
  })

  it('does not let LDAP authenticate the break-glass account after a wrong local password', async () => {
    const admin = makeUser({ email: 'rescue@example.test', role: 'ADMIN', passwordHash: 'hash' })
    const { service, ldapProvider } = makeHarness({
      localResult: { user: admin, passwordValid: false },
      ldapResult: { user: admin, passwordValid: true },
      passwordLoginMode: 'break_glass',
    })

    await expect(service.login('rescue@example.test', 'wrong-password', 'default', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)
    expect(ldapProvider?.authenticate).not.toHaveBeenCalled()
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

  it('uses only LDAP when local login is disabled', async () => {
    const ldapUser = makeUser({ passwordHash: null })
    const { service, localProvider, ldapProvider } = makeHarness({
      localResult: { user: makeUser({ passwordHash: 'local-hash' }), passwordValid: true },
      ldapResult: { user: ldapUser, passwordValid: true },
      passwordLoginMode: 'ldap_only',
    })

    await expect(service.login('ldap.user@example.test', 'corporate-password', 'default', {}))
      .resolves.toMatchObject({ tempToken: expect.any(String) })
    expect(localProvider.authenticate).not.toHaveBeenCalled()
    expect(ldapProvider?.authenticate).toHaveBeenCalledTimes(1)
  })

  it('fails closed without consulting local credentials when local login is disabled and LDAP is unavailable', async () => {
    const { service, localProvider, userRepo } = makeHarness({
      localResult: { user: makeUser({ passwordHash: 'local-hash' }), passwordValid: true },
      passwordLoginMode: 'ldap_only',
    })

    await expect(service.login('ldap.user@example.test', 'local-password', 'default', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)
    expect(localProvider.authenticate).not.toHaveBeenCalled()
    expect(userRepo.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN_FAILED' }))
  })

  it('rejects an identity provider result from another tenant', async () => {
    const { service, userRepo } = makeHarness({
      localResult: { user: makeUser({ tenantId: 99, passwordHash: 'hash' }), passwordValid: true },
    })

    await expect(service.login('ldap.user@example.test', 'password', 'default', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)
    expect(userRepo.resetFailedAttempts).not.toHaveBeenCalled()
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

  it('uses the effective tenant threshold and duration when locking a failed password', async () => {
    const before = Date.now()
    const user = makeUser({ passwordHash: 'hash' })
    const { service, userRepo, authPolicy } = makeHarness({
      localResult: { user, passwordValid: false },
      failedAttempts: 3,
      lockoutPolicy: { maxAttempts: 3, durationMinutes: 30 },
    })

    await expect(service.login(user.email, 'wrong-password', 'default', {}))
      .rejects.toBeInstanceOf(UnauthorizedError)
    expect(authPolicy.getPasswordLockoutPolicy).toHaveBeenCalledWith(1)
    const lockedUntil = userRepo.lockAccount.mock.calls[0]?.[1] as Date
    expect(lockedUntil.getTime()).toBeGreaterThanOrEqual(before + (30 * 60_000))
    expect(lockedUntil.getTime()).toBeLessThanOrEqual(Date.now() + (30 * 60_000))
  })

  it('does not reveal an existing lock to an invalid password', async () => {
    const user = makeUser({ passwordHash: 'hash', lockedUntil: new Date(Date.now() + 60_000) })
    const { service } = makeHarness({ localResult: { user, passwordValid: false } })

    await expect(service.login(user.email, 'wrong-password', 'default', {}))
      .rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: expect.stringContaining('Não foi possível entrar'),
      })
  })

  it('informs a legitimate user about the lock only after correct credentials', async () => {
    const user = makeUser({ passwordHash: 'hash', lockedUntil: new Date(Date.now() + 60_000) })
    const { service } = makeHarness({ localResult: { user, passwordValid: true } })

    await expect(service.login(user.email, 'correct-password', 'default', {}))
      .rejects.toBeInstanceOf(AccountLockedError)
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
