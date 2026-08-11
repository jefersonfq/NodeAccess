import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnauthorizedError } from '../../shared/errors.js'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.APP_FRONTEND_URL = 'https://nodeaccess.example.test'
  process.env.NODE_ENV = 'test'
})

import { OidcAuthService } from './oidc-auth.service.js'

function harness() {
  const users = {
    findTenantBySlug: vi.fn(),
    logAuthEvent: vi.fn().mockResolvedValue(undefined),
  }
  const configs = { getPublic: vi.fn() }
  const flow = { begin: vi.fn(), complete: vi.fn() }
  const identities = { resolveOidcUser: vi.fn() }
  const auth = { issueTokensForUser: vi.fn() }
  return {
    users,
    configs,
    flow,
    identities,
    auth,
    service: new OidcAuthService(users as never, configs as never, flow as never, identities as never, auth as never),
  }
}

describe('OidcAuthService', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([null, { id: 7, active: false }])('does not expose OIDC for an unknown or inactive tenant', async (tenant) => {
    const { service, users, configs } = harness()
    users.findTenantBySlug.mockResolvedValue(tenant)

    await expect(service.getPublicConfig('acme')).resolves.toEqual({ enabled: false, name: null })
    expect(configs.getPublic).not.toHaveBeenCalled()
  })

  it('starts OIDC only for the exact active tenant and fixed callback', async () => {
    const { service, users, flow } = harness()
    users.findTenantBySlug.mockResolvedValue({ id: 7, active: true })
    flow.begin.mockResolvedValue({ authorizationUrl: 'https://idp.example.test/authorize' })

    await expect(service.begin('acme')).resolves.toEqual({
      authorizationUrl: 'https://idp.example.test/authorize',
    })
    expect(users.findTenantBySlug).toHaveBeenCalledWith('acme')
    expect(flow.begin).toHaveBeenCalledWith(7, 'https://nodeaccess.example.test/auth/oidc/callback')
  })

  it('rejects starting OIDC for an inactive tenant', async () => {
    const { service, users, flow } = harness()
    users.findTenantBySlug.mockResolvedValue({ id: 7, active: false })

    await expect(service.begin('acme')).rejects.toThrow('Não foi possível concluir o login corporativo')
    expect(flow.begin).not.toHaveBeenCalled()
  })

  it('resolves the external identity, audits login and issues tenant-scoped tokens', async () => {
    const { service, users, flow, identities, auth } = harness()
    const user = { id: 20, tenantId: 7, active: true, email: 'user@example.test' }
    flow.complete.mockResolvedValue({
      tenantId: 7,
      identity: {
        subject: 'subject-1',
        email: 'user@example.test',
        emailVerified: true,
        name: 'External User',
        claims: { iss: 'https://idp.example.test' },
      },
    })
    identities.resolveOidcUser.mockResolvedValue(user)
    auth.issueTokensForUser.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' })

    await expect(service.complete('state', 'code')).resolves.toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
    })
    expect(identities.resolveOidcUser).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 7,
      issuer: 'https://idp.example.test',
      subject: 'subject-1',
      emailVerified: true,
    }))
    expect(users.logAuthEvent).toHaveBeenCalledWith({ userId: 20, eventType: 'SSO_LOGIN', success: true })
    expect(auth.issueTokensForUser).toHaveBeenCalledWith(user, 7, 'oidc')
  })

  it('rejects an identity without issuer before linking an account', async () => {
    const { service, flow, identities, auth } = harness()
    flow.complete.mockResolvedValue({
      tenantId: 7,
      identity: { subject: 'subject-1', email: null, emailVerified: false, name: null, claims: {} },
    })

    await expect(service.complete('state', 'code')).rejects.toThrow('Não foi possível concluir o login corporativo')
    expect(identities.resolveOidcUser).not.toHaveBeenCalled()
    expect(auth.issueTokensForUser).not.toHaveBeenCalled()
  })

  it('does not expose identity policy details returned by account resolution', async () => {
    const { service, flow, identities } = harness()
    flow.complete.mockResolvedValue({
      tenantId: 7,
      identity: {
        subject: 'subject-1', email: 'user@example.test', emailVerified: true,
        name: 'External User', claims: { iss: 'https://idp.example.test' },
      },
    })
    identities.resolveOidcUser.mockRejectedValue(new UnauthorizedError('Vínculo de identidade revogado'))

    await expect(service.complete('state', 'code')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Não foi possível concluir o login corporativo. Tente novamente ou contate o administrador.',
    })
  })
})
