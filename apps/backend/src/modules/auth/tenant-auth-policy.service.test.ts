import { describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcrypt'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})
import { DEFAULT_TENANT_AUTH_POLICY } from './auth-policy.js'
import { TenantAuthPolicyService } from './tenant-auth-policy.service.js'

describe('TenantAuthPolicyService', () => {
  it('returns compatible defaults without creating a database row', async () => {
    const repository = { find: vi.fn().mockResolvedValue(null) }
    const logs = { logAdminEvent: vi.fn() }
    const service = new TenantAuthPolicyService(repository as never, logs as never, {} as never)

    const result = await service.get(7)

    expect(result.requested).toEqual(DEFAULT_TENANT_AUTH_POLICY)
    expect(result.effective.mfaRequired).toBe(true)
    expect(result.enforcementEnabled).toBe(true)
    expect(result.ssoRequiredEnforced).toBe(true)
    expect(result.localLoginEnforced).toBe(true)
    expect(result.emailTenantDiscoveryEnforced).toBe(true)
    expect(result.lockoutPolicyEnforced).toBe(true)
    expect(result.tokenLifetimeEnforced).toBe(true)
    expect(logs.logAdminEvent).not.toHaveBeenCalled()
  })

  it('persists, resolves and audits an administrative update', async () => {
    const requested = {
      ...DEFAULT_TENANT_AUTH_POLICY,
      jitProvisioningEnabled: true,
      lockoutMaxAttempts: 50,
    }
    const repository = {
      find: vi.fn(),
      upsert: vi.fn().mockResolvedValue(requested),
    }
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new TenantAuthPolicyService(repository as never, logs as never, {} as never)

    const result = await service.update(7, 11, requested)

    expect(repository.upsert).toHaveBeenCalledWith(7, requested)
    expect(result.requested).toEqual(requested)
    expect(result.effective.jitProvisioningEnabled).toBe(false)
    expect(result.effective.lockoutMaxAttempts).toBe(10)
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 11,
      action: 'UPDATE_TENANT_AUTH_POLICY',
      targetId: 7,
    }))
  })

  it('blocks mandatory SSO until break-glass validation exists', async () => {
    const repository = { upsert: vi.fn(), getBreakGlass: vi.fn().mockResolvedValue(null) }
    const service = new TenantAuthPolicyService(repository as never, { logAdminEvent: vi.fn() } as never, {} as never)

    await expect(service.update(7, 11, {
      ...DEFAULT_TENANT_AUTH_POLICY,
      ssoRequired: true,
    })).rejects.toThrow('break-glass')
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('allows requesting mandatory SSO after a valid break-glass account exists', async () => {
    const requested = { ...DEFAULT_TENANT_AUTH_POLICY, ssoRequired: true }
    const repository = {
      getBreakGlass: vi.fn().mockResolvedValue({ userId: 20, email: 'rescue@example.test', validatedAt: new Date() }),
      upsert: vi.fn().mockResolvedValue(requested),
    }
    const service = new TenantAuthPolicyService(
      repository as never,
      { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never,
    )

    await expect(service.update(7, 11, requested)).resolves.toMatchObject({
      requested: { ssoRequired: true },
      enforcementEnabled: true,
      ssoRequiredEnforced: true,
      localLoginEnforced: true,
      emailTenantDiscoveryEnforced: true,
      lockoutPolicyEnforced: true,
      tokenLifetimeEnforced: true,
    })
    expect(repository.upsert).toHaveBeenCalledWith(7, requested)
  })

  it('validates and audits an active local administrator as break-glass', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4)
    const repository = { setBreakGlass: vi.fn().mockResolvedValue(undefined) }
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const users = { findByEmail: vi.fn().mockResolvedValue({
      id: 20, email: 'rescue@example.test', active: true, deletedAt: null,
      role: 'ADMIN', passwordHash, forcePasswordChange: false, lockedUntil: null,
    }) }
    const service = new TenantAuthPolicyService(repository as never, logs as never, users as never)

    await expect(service.validateBreakGlass(7, 11, 'RESCUE@EXAMPLE.TEST', 'correct-password'))
      .resolves.toMatchObject({ configured: true, userId: 20, email: 'rescue@example.test' })
    expect(users.findByEmail).toHaveBeenCalledWith('rescue@example.test', 7)
    expect(repository.setBreakGlass).toHaveBeenCalledWith(7, 20, expect.any(Date))
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VALIDATE_BREAK_GLASS_ACCOUNT', targetId: 20,
    }))
  })

  it('rejects an invalid or non-local break-glass account without persisting it', async () => {
    const repository = { setBreakGlass: vi.fn() }
    const users = { findByEmail: vi.fn().mockResolvedValue({
      id: 20, email: 'admin@example.test', active: true, deletedAt: null,
      role: 'ADMIN', passwordHash: null, forcePasswordChange: false, lockedUntil: null,
    }) }
    const service = new TenantAuthPolicyService(repository as never, { logAdminEvent: vi.fn() } as never, users as never)

    await expect(service.validateBreakGlass(7, 11, 'admin@example.test', 'password'))
      .rejects.toThrow('Conta local administrativa inválida')
    expect(repository.setBreakGlass).not.toHaveBeenCalled()
  })

  it.each([
    { email: 'user@example.test', breakGlass: null, expected: 'blocked' },
    { email: 'RESCUE@EXAMPLE.TEST', breakGlass: { email: 'rescue@example.test' }, expected: 'break_glass' },
  ])('resolves password login under mandatory SSO ($expected)', async ({ email, breakGlass, expected }) => {
    const repository = {
      find: vi.fn().mockResolvedValue({ ...DEFAULT_TENANT_AUTH_POLICY, ssoRequired: true }),
      getBreakGlass: vi.fn().mockResolvedValue(breakGlass),
    }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)
    await expect(service.getPasswordLoginMode(7, email)).resolves.toBe(expected)
  })

  it('blocks disabling local login until break-glass validation exists', async () => {
    const repository = { upsert: vi.fn(), getBreakGlass: vi.fn().mockResolvedValue(null) }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)

    await expect(service.update(7, 11, { ...DEFAULT_TENANT_AUTH_POLICY, localLoginEnabled: false }))
      .rejects.toThrow('break-glass')
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it.each([
    { email: 'user@example.test', expected: 'ldap_only' },
    { email: 'RESCUE@EXAMPLE.TEST', expected: 'break_glass' },
  ])('resolves disabled local login as $expected', async ({ email, expected }) => {
    const repository = {
      find: vi.fn().mockResolvedValue({ ...DEFAULT_TENANT_AUTH_POLICY, localLoginEnabled: false }),
      getBreakGlass: vi.fn().mockResolvedValue({ email: 'rescue@example.test' }),
    }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)

    await expect(service.getPasswordLoginMode(7, email)).resolves.toBe(expected)
  })

  it('resolves email tenant discovery from the effective installation and tenant policy', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue({ ...DEFAULT_TENANT_AUTH_POLICY, emailTenantDiscoveryEnabled: false }),
    }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)

    await expect(service.isEmailTenantDiscoveryEnabled(7)).resolves.toBe(false)
  })

  it('returns effective lockout limits clamped by the installation policy', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue({
        ...DEFAULT_TENANT_AUTH_POLICY,
        lockoutMaxAttempts: 50,
        lockoutDurationMinutes: 1,
      }),
    }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)

    await expect(service.getPasswordLockoutPolicy(7)).resolves.toEqual({
      maxAttempts: 10,
      durationMinutes: 5,
    })
  })

  it('returns tenant token lifetimes without exceeding installation JWT limits', async () => {
    const repository = {
      find: vi.fn().mockResolvedValue({
        ...DEFAULT_TENANT_AUTH_POLICY,
        accessTokenMinutes: 5,
        refreshTokenDays: 2,
      }),
    }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)

    await expect(service.getTokenLifetimePolicy(7)).resolves.toEqual({
      accessTokenSeconds: 5 * 60,
      refreshTokenSeconds: 2 * 24 * 60 * 60,
    })
  })

  it.each([
    { method: 'oidc' as const, email: 'user@example.test', expected: true },
    { method: 'local' as const, email: 'user@example.test', expected: false },
    { method: 'break_glass' as const, email: 'rescue@example.test', expected: true },
    { method: undefined, email: 'user@example.test', expected: false },
  ])('revalidates $method sessions under mandatory SSO', async ({ method, email, expected }) => {
    const repository = {
      find: vi.fn().mockResolvedValue({ ...DEFAULT_TENANT_AUTH_POLICY, ssoRequired: true }),
      getBreakGlass: vi.fn().mockResolvedValue({ email: 'rescue@example.test' }),
    }
    const service = new TenantAuthPolicyService(repository as never, {} as never, {} as never)

    await expect(service.canRefreshSession(7, email, method)).resolves.toBe(expected)
  })
})
