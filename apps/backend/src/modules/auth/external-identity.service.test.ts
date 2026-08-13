import { describe, expect, it, vi } from 'vitest'
import type { User } from '@prisma/client'
import { ExternalIdentityService } from './external-identity.service.js'
import { UnauthorizedError } from '../../shared/errors.js'

function user(overrides: Partial<User> = {}): User {
  return {
    id: 20,
    tenantId: 7,
    name: 'External User',
    email: 'user@example.test',
    role: 'USER',
    isPlatformAdmin: false,
    active: true,
    deletedAt: null,
    ...overrides,
  } as User
}

const effectivePolicy = {
  localLoginEnabled: true,
  ssoRequired: false,
  mfaRequired: true,
  jitProvisioningEnabled: true,
  automaticAccountLinkingEnabled: true,
  emailTenantDiscoveryEnabled: true,
  lockoutMaxAttempts: 5,
  lockoutDurationMinutes: 15,
  accessTokenMinutes: 15,
  refreshTokenDays: 7,
}

const config = {
  issuer: 'https://idp.example.test',
  clientId: 'nodeaccess',
  name: 'Corporate',
  scopes: [],
  allowedDomains: ['example.test'],
  autoProvision: true,
}

function harness(repositoryOverrides: Record<string, unknown> = {}, policyOverrides = {}) {
  const repository = {
    findLinked: vi.fn().mockResolvedValue(null),
    isRevoked: vi.fn().mockResolvedValue(false),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    link: vi.fn(),
    createJit: vi.fn(),
    ...repositoryOverrides,
  }
  const configs = { getEnabled: vi.fn().mockResolvedValue(config) }
  const policies = { getEffective: vi.fn().mockResolvedValue({ ...effectivePolicy, ...policyOverrides }) }
  return {
    repository,
    service: new ExternalIdentityService(repository as never, configs as never, policies as never),
  }
}

describe('ExternalIdentityService', () => {
  it('uses issuer and subject for an existing link without relying on email', async () => {
    const linked = user()
    const { service, repository } = harness({ findLinked: vi.fn().mockResolvedValue({ identityId: 4, user: linked }) })

    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: null,
      emailVerified: false,
      name: null,
    })).resolves.toBe(linked)
    expect(repository.findUserByEmail).not.toHaveBeenCalled()
  })

  it('rejects linking when the provider email is not verified', async () => {
    const { service } = harness()
    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: 'user@example.test',
      emailVerified: false,
      name: null,
    })).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('rejects an inactive user even when the external identity is already linked', async () => {
    const { service } = harness({ findLinked: vi.fn().mockResolvedValue({ identityId: 4, user: user({ active: false }) }) })
    await expect(service.resolveOidcUser({
      tenantId: 7, issuer: config.issuer, subject: 'subject-1', email: null,
      emailVerified: false, name: null,
    })).rejects.toThrow('Conta desativada')
  })

  it('rejects a revoked identity before automatic linking or JIT can recreate it', async () => {
    const { service, repository } = harness({ isRevoked: vi.fn().mockResolvedValue(true) })
    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'revoked-subject',
      email: 'user@example.test',
      emailVerified: true,
      name: 'External User',
    })).rejects.toThrow('Vínculo de identidade revogado')
    expect(repository.findUserByEmail).not.toHaveBeenCalled()
    expect(repository.link).not.toHaveBeenCalled()
    expect(repository.createJit).not.toHaveBeenCalled()
  })

  it('keeps identity lookup scoped to the requested tenant', async () => {
    const { service, repository } = harness({ findLinked: vi.fn().mockResolvedValue({ identityId: 4, user: user() }) })
    await service.resolveOidcUser({
      tenantId: 19, issuer: config.issuer, subject: 'same-subject', email: null,
      emailVerified: false, name: null,
    })
    expect(repository.findLinked).toHaveBeenCalledWith(19, config.issuer, 'same-subject')
  })

  it('never auto-links an administrative account by email', async () => {
    const admin = user({ role: 'ADMIN' })
    const { service, repository } = harness({ findUserByEmail: vi.fn().mockResolvedValue(admin) })
    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: admin.email,
      emailVerified: true,
      name: admin.name,
    })).rejects.toThrow('aprovação administrativa')
    expect(repository.link).not.toHaveBeenCalled()
  })

  it('never auto-links a platform administrator by email', async () => {
    const admin = user({ isPlatformAdmin: true })
    const { service, repository } = harness({ findUserByEmail: vi.fn().mockResolvedValue(admin) })
    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: admin.email,
      emailVerified: true,
      name: admin.name,
    })).rejects.toThrow('aprovação administrativa')
    expect(repository.link).not.toHaveBeenCalled()
  })

  it('creates a least-privileged JIT user only for an allowed domain', async () => {
    const created = user()
    const { service, repository } = harness({ createJit: vi.fn().mockResolvedValue({ identityId: 5, user: created }) })
    const result = await service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: 'USER@EXAMPLE.TEST',
      emailVerified: true,
      name: 'External User',
    })
    expect(result).toBe(created)
    expect(repository.createJit).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@example.test',
      providerKey: 'oidc',
    }))
  })

  it('rejects JIT when either policy or provider configuration disables it', async () => {
    const { service, repository } = harness({}, { jitProvisioningEnabled: false })
    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: 'user@example.test',
      emailVerified: true,
      name: 'External User',
    })).rejects.toThrow('não provisionado')
    expect(repository.createJit).not.toHaveBeenCalled()
  })

  it('rejects JIT for an email outside the provider allowlist', async () => {
    const { service, repository } = harness()
    await expect(service.resolveOidcUser({
      tenantId: 7,
      issuer: config.issuer,
      subject: 'subject-1',
      email: 'user@outside.example',
      emailVerified: true,
      name: 'External User',
    })).rejects.toThrow('Domínio de e-mail não autorizado')
    expect(repository.createJit).not.toHaveBeenCalled()
  })
})
