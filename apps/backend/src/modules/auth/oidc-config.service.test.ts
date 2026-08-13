import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})

import { OidcConfigService } from './oidc-config.service.js'

const licensed = {
  isIntegrationProviderEnabled: vi.fn().mockResolvedValue(true),
  requireIntegrationProvider: vi.fn().mockResolvedValue(undefined),
}

describe('OidcConfigService', () => {
  it('rotates only the encrypted client secret and emits a dedicated audit event', async () => {
    const existing = {
      name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'client',
      clientSecretEncrypted: 'old-ciphertext', clientSecretIv: 'old-iv',
      scopes: ['openid'], allowedDomains: ['example.test'], autoProvision: false,
      requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
    }
    let persisted = ''
    const repository = {
      findByProvider: vi.fn()
        .mockResolvedValueOnce({ enabled: true, config: JSON.stringify(existing), updatedAt: new Date() })
        .mockImplementation(() => Promise.resolve({ enabled: true, config: persisted, updatedAt: new Date() })),
      upsert: vi.fn().mockImplementation((_tenant: number, _provider: string, _enabled: boolean, config: string) => {
        persisted = config
        return Promise.resolve()
      }),
    }
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new OidcConfigService(repository as never, {} as never, logs as never, licensed as never)

    const result = await service.rotateClientSecret(7, 11, 'new-client-secret')

    expect(persisted).not.toContain('new-client-secret')
    expect(JSON.parse(persisted)).toMatchObject({
      name: existing.name, issuer: existing.issuer, clientId: existing.clientId,
      scopes: existing.scopes, allowedDomains: existing.allowedDomains,
    })
    expect(JSON.parse(persisted).clientSecretEncrypted).not.toBe('old-ciphertext')
    expect(result.hasClientSecret).toBe(true)
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROTATE_OIDC_CLIENT_SECRET', details: JSON.stringify({ provider: 'oidc' }),
    }))
  })

  it('encrypts the client secret and never exposes it publicly', async () => {
    let storedConfig = ''
    const repository = {
      findByProvider: vi.fn()
        .mockResolvedValueOnce(null)
        .mockImplementation(() => Promise.resolve({
          enabled: true,
          config: storedConfig,
          updatedAt: new Date('2026-08-10T12:00:00.000Z'),
        })),
      upsert: vi.fn().mockImplementation((_tenantId: number, _provider: string, _enabled: boolean, config: string) => {
        storedConfig = config
        return Promise.resolve()
      }),
    }
    const oidc = {
      normalizeIssuer: vi.fn(() => 'https://idp.example.test'),
      discover: vi.fn().mockResolvedValue({ issuer: 'https://idp.example.test' }),
    }
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new OidcConfigService(repository as never, oidc as never, logs as never, licensed as never)

    const result = await service.upsert(7, 11, {
      enabled: true,
      name: 'Corporate',
      issuer: 'https://idp.example.test',
      clientId: 'nodeaccess',
      clientSecret: 'super-secret-value',
      scopes: ['groups', 'groups'],
      allowedDomains: ['EXAMPLE.TEST'],
      autoProvision: false,
      requireMfaClaim: true,
      acceptedAmrValues: ['MFA', 'mfa'],
      acceptedAcrValues: ['urn:example:mfa'],
    })

    expect(storedConfig).not.toContain('super-secret-value')
    expect(result.hasClientSecret).toBe(true)
    expect(result).not.toHaveProperty('clientSecret')
    expect(result.allowedDomains).toEqual(['example.test'])
    expect(result.acceptedAmrValues).toEqual(['mfa'])
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE_OIDC_CONFIG',
    }))
  })

  it('requires a secret before enabling a new provider', async () => {
    const repository = { findByProvider: vi.fn().mockResolvedValue(null) }
    const service = new OidcConfigService(
      repository as never,
      { normalizeIssuer: vi.fn(() => 'https://idp.example.test') } as never,
      { logAdminEvent: vi.fn() } as never,
      licensed as never,
    )

    await expect(service.upsert(7, 11, {
      enabled: true,
      name: 'Corporate',
      issuer: 'https://idp.example.test',
      clientId: 'nodeaccess',
      scopes: [],
      allowedDomains: [],
      autoProvision: false,
      requireMfaClaim: false,
      acceptedAmrValues: ['mfa'],
      acceptedAcrValues: [],
    })).rejects.toThrow('Client secret OIDC obrigatório')
  })

  it('rejects email-based JIT provisioning for Microsoft Entra ID', async () => {
    const repository = { findByProvider: vi.fn().mockResolvedValue(null) }
    const issuer = 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0'
    const service = new OidcConfigService(
      repository as never,
      { normalizeIssuer: vi.fn(() => issuer) } as never,
      { logAdminEvent: vi.fn() } as never,
      licensed as never,
    )

    await expect(service.upsert(7, 11, {
      enabled: false,
      name: 'Microsoft Entra ID',
      issuer,
      clientId: 'nodeaccess',
      scopes: ['openid', 'profile', 'email'],
      allowedDomains: ['example.test'],
      autoProvision: true,
      requireMfaClaim: false,
      acceptedAmrValues: ['mfa'],
      acceptedAcrValues: [],
    })).rejects.toThrow('não permite auto-provisionamento por e-mail verificado')
    expect(repository.findByProvider).toHaveBeenCalledOnce()
  })

  it('preserves the encrypted secret when updating non-sensitive fields', async () => {
    const existing = {
      name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'old-client',
      clientSecretEncrypted: 'existing-ciphertext', clientSecretIv: 'existing-iv',
      scopes: ['openid'], allowedDomains: ['example.test'], autoProvision: false,
      requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
    }
    let persisted = ''
    const repository = {
      findByProvider: vi.fn()
        .mockResolvedValueOnce({ enabled: true, config: JSON.stringify(existing), updatedAt: new Date() })
        .mockImplementation(() => Promise.resolve({ enabled: true, config: persisted, updatedAt: new Date() })),
      upsert: vi.fn().mockImplementation((_tenantId: number, _provider: string, _enabled: boolean, value: string) => {
        persisted = value
        return Promise.resolve()
      }),
    }
    const service = new OidcConfigService(
      repository as never,
      { normalizeIssuer: vi.fn(() => existing.issuer), discover: vi.fn().mockResolvedValue({ issuer: existing.issuer }) } as never,
      { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
      licensed as never,
    )

    await service.upsert(7, 11, {
      enabled: true, name: 'Corporate updated', issuer: existing.issuer, clientId: 'new-client',
      scopes: ['openid'], allowedDomains: ['example.test'], autoProvision: false,
      requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
    })

    expect(JSON.parse(persisted)).toMatchObject({
      clientSecretEncrypted: 'existing-ciphertext',
      clientSecretIv: 'existing-iv',
      clientId: 'new-client',
    })
  })

  it('does not fail the configuration update when best-effort auditing is unavailable', async () => {
    let persisted = ''
    const repository = {
      findByProvider: vi.fn()
        .mockResolvedValueOnce(null)
        .mockImplementation(() => Promise.resolve({ enabled: false, config: persisted, updatedAt: new Date() })),
      upsert: vi.fn().mockImplementation((_tenantId: number, _provider: string, _enabled: boolean, value: string) => {
        persisted = value
        return Promise.resolve()
      }),
    }
    const service = new OidcConfigService(
      repository as never,
      { normalizeIssuer: vi.fn(() => 'https://idp.example.test') } as never,
      { logAdminEvent: vi.fn().mockRejectedValue(new Error('audit unavailable')) } as never,
      licensed as never,
    )

    await expect(service.upsert(7, 11, {
      enabled: false, name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'client',
      scopes: [], allowedDomains: [], autoProvision: false,
      requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
    })).resolves.toMatchObject({ enabled: false, hasClientSecret: false })
  })

  it('validates discovery before enabling and exposes only operational endpoints', async () => {
    const discovery = {
      issuer: 'https://idp.example.test',
      authorization_endpoint: 'https://idp.example.test/authorize',
      token_endpoint: 'https://idp.example.test/token',
      jwks_uri: 'https://idp.example.test/jwks',
    }
    const oidc = { discover: vi.fn().mockResolvedValue(discovery) }
    const service = new OidcConfigService({} as never, oidc as never, {} as never, licensed as never)

    await expect(service.testDiscovery(7, discovery.issuer)).resolves.toMatchObject({
      ok: true,
      issuer: discovery.issuer,
      authorizationEndpoint: discovery.authorization_endpoint,
      tokenEndpoint: discovery.token_endpoint,
      jwksUri: discovery.jwks_uri,
      checkedAt: expect.any(Date),
    })
    expect(oidc.discover).toHaveBeenCalledWith(discovery.issuer)
  })

  it('does not persist an enabled provider when discovery fails', async () => {
    const repository = { findByProvider: vi.fn().mockResolvedValue(null), upsert: vi.fn() }
    const oidc = {
      normalizeIssuer: vi.fn(() => 'https://idp.example.test'),
      discover: vi.fn().mockRejectedValue(new Error('discovery unavailable')),
    }
    const service = new OidcConfigService(repository as never, oidc as never, { logAdminEvent: vi.fn() } as never, licensed as never)

    await expect(service.upsert(7, 11, {
      enabled: true, name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'client',
      clientSecret: 'secret', scopes: [], allowedDomains: [], autoProvision: false,
      requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
    })).rejects.toThrow('discovery unavailable')
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('preserves configuration but disables public use when OIDC is not licensed', async () => {
    const repository = { findByProvider: vi.fn().mockResolvedValue({
      enabled: true,
      config: JSON.stringify({ name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'client' }),
      updatedAt: new Date(),
    }) }
    const unlicensed = {
      isIntegrationProviderEnabled: vi.fn().mockResolvedValue(false),
      requireIntegrationProvider: vi.fn().mockRejectedValue(new Error('not licensed')),
    }
    const service = new OidcConfigService(repository as never, {} as never, {} as never, unlicensed as never)

    await expect(service.getPublic(7)).resolves.toMatchObject({
      licensed: false,
      enabled: false,
      name: 'Corporate',
      issuer: 'https://idp.example.test',
    })
    await expect(service.getEnabled(7)).resolves.toBeNull()
    await expect(service.testDiscovery(7, 'https://idp.example.test')).rejects.toThrow('not licensed')
  })
})
