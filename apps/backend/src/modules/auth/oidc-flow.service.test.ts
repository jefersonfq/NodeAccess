import { describe, expect, it, vi } from 'vitest'
import { OidcFlowService } from './oidc-flow.service.js'

const config = {
  name: 'Corporate',
  issuer: 'https://idp.example.test',
  clientId: 'nodeaccess',
  scopes: [],
  allowedDomains: [],
  autoProvision: false,
  requireMfaClaim: false,
  acceptedAmrValues: ['mfa'],
  acceptedAcrValues: [],
  clientSecretEncrypted: 'encrypted',
  clientSecretIv: 'iv',
}

describe('OidcFlowService', () => {
  it('stores a short-lived, single-use authorization transaction', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK') }
    const configs = { getEnabled: vi.fn().mockResolvedValue(config) }
    const oidc = {
      discover: vi.fn().mockResolvedValue({
        issuer: config.issuer,
        authorization_endpoint: `${config.issuer}/authorize`,
      }),
      createAuthorizationRequest: vi.fn().mockReturnValue({
        url: `${config.issuer}/authorize?state=random-state`,
        state: 'random-state',
        nonce: 'random-nonce',
        codeVerifier: 'random-verifier',
      }),
    }
    const service = new OidcFlowService(redis as never, configs as never, oidc as never)

    const result = await service.begin(7, 'https://nodeaccess.example.test/callback')

    expect(result.authorizationUrl).toContain('random-state')
    expect(redis.set).toHaveBeenCalledWith(
      'nodeaccess:oidc:flow:random-state',
      expect.stringContaining('random-nonce'),
      'EX',
      300,
      'NX',
    )
  })

  it('consumes state atomically and rejects replay', async () => {
    const flow = JSON.stringify({
      tenantId: 7,
      nonce: 'nonce',
      codeVerifier: 'verifier',
      redirectUri: 'https://nodeaccess.example.test/callback',
      issuer: config.issuer,
    })
    const redis = { call: vi.fn().mockResolvedValueOnce(flow).mockResolvedValueOnce(null) }
    const configs = { getEnabled: vi.fn().mockResolvedValue({ ...config, issuer: 'https://changed.example.test' }) }
    const service = new OidcFlowService(redis as never, configs as never, {} as never)

    await expect(service.complete('state', 'code')).rejects.toThrow('Configuração OIDC mudou')
    await expect(service.complete('state', 'code')).rejects.toThrow('expirada ou já utilizada')
    expect(redis.call).toHaveBeenNthCalledWith(1, 'GETDEL', 'nodeaccess:oidc:flow:state')
    expect(redis.call).toHaveBeenNthCalledWith(2, 'GETDEL', 'nodeaccess:oidc:flow:state')
  })

  it('exchanges the code with PKCE and validates the original nonce', async () => {
    const flow = JSON.stringify({
      tenantId: 7,
      nonce: 'original-nonce',
      codeVerifier: 'original-verifier',
      redirectUri: 'https://nodeaccess.example.test/auth/oidc/callback',
      issuer: config.issuer,
    })
    const redis = { call: vi.fn().mockResolvedValue(flow) }
    const configs = {
      getEnabled: vi.fn().mockResolvedValue(config),
      decryptClientSecret: vi.fn().mockReturnValue('client-secret'),
    }
    const identity = {
      subject: 'subject-1',
      email: 'user@example.test',
      emailVerified: true,
      name: 'External User',
      claims: { iss: config.issuer },
    }
    const oidc = {
      discover: vi.fn().mockResolvedValue({ issuer: config.issuer, token_endpoint: `${config.issuer}/token` }),
      verifyIdToken: vi.fn().mockResolvedValue(identity),
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id_token: 'signed-id-token' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const service = new OidcFlowService(redis as never, configs as never, oidc as never)

    await expect(service.complete('single-use-state', 'authorization-code')).resolves.toEqual({
      tenantId: 7,
      identity,
      mfaAssurance: { satisfied: false, source: null },
    })

    const request = fetchMock.mock.calls[0]?.[1]
    const body = request?.body as URLSearchParams
    expect(fetchMock).toHaveBeenCalledWith(`${config.issuer}/token`, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }))
    expect(Object.fromEntries(body.entries())).toMatchObject({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: 'https://nodeaccess.example.test/auth/oidc/callback',
      client_id: 'nodeaccess',
      client_secret: 'client-secret',
      code_verifier: 'original-verifier',
    })
    expect(oidc.verifyIdToken).toHaveBeenCalledWith(expect.objectContaining({
      idToken: 'signed-id-token',
      nonce: 'original-nonce',
    }))
    fetchMock.mockRestore()
  })

  it.each([
    { status: 401, payload: { error: 'invalid_grant' } },
    { status: 200, payload: { access_token: 'without-id-token' } },
  ])('rejects an invalid token response ($status)', async ({ status, payload }) => {
    const flow = JSON.stringify({
      tenantId: 7,
      nonce: 'nonce',
      codeVerifier: 'verifier',
      redirectUri: 'https://nodeaccess.example.test/auth/oidc/callback',
      issuer: config.issuer,
    })
    const redis = { call: vi.fn().mockResolvedValue(flow) }
    const configs = {
      getEnabled: vi.fn().mockResolvedValue(config),
      decryptClientSecret: vi.fn().mockReturnValue('client-secret'),
    }
    const oidc = {
      discover: vi.fn().mockResolvedValue({ issuer: config.issuer, token_endpoint: `${config.issuer}/token` }),
      verifyIdToken: vi.fn(),
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(payload),
      { status, headers: { 'Content-Type': 'application/json' } },
    ))
    const service = new OidcFlowService(redis as never, configs as never, oidc as never)

    await expect(service.complete('state', 'code')).rejects.toThrow('Falha ao trocar código OIDC')
    expect(oidc.verifyIdToken).not.toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it.each([
    { claims: { amr: ['pwd', 'mfa'] }, acceptedAmrValues: ['mfa'], acceptedAcrValues: [] },
    { claims: { acr: 'urn:example:mfa' }, acceptedAmrValues: [], acceptedAcrValues: ['urn:example:mfa'] },
  ])('accepts configured upstream MFA evidence', async ({ claims, acceptedAmrValues, acceptedAcrValues }) => {
    const flow = JSON.stringify({
      tenantId: 7, nonce: 'nonce', codeVerifier: 'verifier',
      redirectUri: 'https://nodeaccess.example.test/auth/oidc/callback', issuer: config.issuer,
    })
    const redis = { call: vi.fn().mockResolvedValue(flow) }
    const configs = {
      getEnabled: vi.fn().mockResolvedValue({
        ...config, requireMfaClaim: true, acceptedAmrValues, acceptedAcrValues,
      }),
      decryptClientSecret: vi.fn().mockReturnValue('client-secret'),
    }
    const identity = { subject: 'subject', email: 'user@example.test', emailVerified: true, name: null, claims }
    const oidc = {
      discover: vi.fn().mockResolvedValue({ issuer: config.issuer, token_endpoint: `${config.issuer}/token` }),
      verifyIdToken: vi.fn().mockResolvedValue(identity),
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id_token: 'signed-id-token' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(new OidcFlowService(redis as never, configs as never, oidc as never).complete('state', 'code'))
      .resolves.toMatchObject({ tenantId: 7 })
    fetchMock.mockRestore()
  })

  it('rejects OIDC login without configured MFA evidence before identity resolution', async () => {
    const flow = JSON.stringify({
      tenantId: 7, nonce: 'nonce', codeVerifier: 'verifier',
      redirectUri: 'https://nodeaccess.example.test/auth/oidc/callback', issuer: config.issuer,
    })
    const redis = { call: vi.fn().mockResolvedValue(flow) }
    const configs = {
      getEnabled: vi.fn().mockResolvedValue({
        ...config, requireMfaClaim: true, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
      }),
      decryptClientSecret: vi.fn().mockReturnValue('client-secret'),
    }
    const oidc = {
      discover: vi.fn().mockResolvedValue({ issuer: config.issuer, token_endpoint: `${config.issuer}/token` }),
      verifyIdToken: vi.fn().mockResolvedValue({
        subject: 'subject', email: 'user@example.test', emailVerified: true, name: null, claims: { amr: ['pwd'] },
      }),
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id_token: 'signed-id-token' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(new OidcFlowService(redis as never, configs as never, oidc as never).complete('state', 'code'))
      .rejects.toThrow('não comprovou MFA')
    fetchMock.mockRestore()
  })
})
