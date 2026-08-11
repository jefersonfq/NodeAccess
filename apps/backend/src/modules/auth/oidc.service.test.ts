import { describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { OidcService, type OidcDiscoveryDocument } from './oidc.service.js'

const discovery: OidcDiscoveryDocument = {
  issuer: 'https://idp.example.test',
  authorization_endpoint: 'https://idp.example.test/authorize',
  token_endpoint: 'https://idp.example.test/token',
  jwks_uri: 'https://idp.example.test/jwks',
  id_token_signing_alg_values_supported: ['RS256'],
}

describe('OidcService', () => {
  const service = new OidcService()

  it('allows an HTTP loopback issuer only outside production for local IdP certification', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'test'
    try {
      expect(service.normalizeIssuer('http://127.0.0.1:18080/realms/nodeaccess-cert/'))
        .toBe('http://127.0.0.1:18080/realms/nodeaccess-cert')
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('keeps HTTP loopback issuers blocked in production', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() => service.normalizeIssuer('http://127.0.0.1:18080/realms/nodeaccess-cert'))
        .toThrow('deve usar HTTPS')
    } finally {
      process.env.NODE_ENV = previous
    }
  })
  it('rejects insecure issuer and endpoint URLs', async () => {
    expect(() => service.normalizeIssuer('http://idp.example.test')).toThrow('HTTPS')
    expect(() => service.normalizeIssuer('https://user:pass@idp.example.test')).toThrow('credenciais')
  })

  it('creates authorization code request with PKCE, state and nonce', () => {
    const request = service.createAuthorizationRequest({
      discovery,
      clientId: 'nodeaccess',
      redirectUri: 'https://nodeaccess.example.test/api/v1/auth/oidc/callback',
      scopes: ['groups'],
    })
    const url = new URL(request.url)

    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid profile email groups')
    expect(url.searchParams.get('state')).toBe(request.state)
    expect(url.searchParams.get('nonce')).toBe(request.nonce)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(request.codeVerifier.length).toBeGreaterThan(43)
  })

  it('verifies signature, issuer, audience, nonce and normalized identity claims', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    const keyResolver = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256' }] })
    const idToken = await new SignJWT({
      nonce: 'expected-nonce',
      email: 'user@example.test',
      email_verified: true,
      name: 'Example User',
      groups: ['operators', 123],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(discovery.issuer)
      .setAudience('nodeaccess')
      .setSubject('external-user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    const identity = await service.verifyIdToken({
      idToken,
      discovery,
      clientId: 'nodeaccess',
      nonce: 'expected-nonce',
      keyResolver,
    })

    expect(identity).toEqual(expect.objectContaining({
      subject: 'external-user-1',
      email: 'user@example.test',
      emailVerified: true,
      name: 'Example User',
      groups: ['operators'],
    }))
  })

  it('rejects nonce mismatch', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    const keyResolver = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256' }] })
    const idToken = await new SignJWT({ nonce: 'original-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(discovery.issuer)
      .setAudience('nodeaccess')
      .setSubject('external-user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(service.verifyIdToken({
      idToken,
      discovery,
      clientId: 'nodeaccess',
      nonce: 'wrong-nonce',
      keyResolver,
    })).rejects.toThrow('Nonce OIDC inválido')
  })

  it('rejects audience mismatch', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    const keyResolver = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256' }] })
    const idToken = await new SignJWT({ nonce: 'expected-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(discovery.issuer)
      .setAudience('another-client')
      .setSubject('external-user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

    await expect(service.verifyIdToken({
      idToken,
      discovery,
      clientId: 'nodeaccess',
      nonce: 'expected-nonce',
      keyResolver,
    })).rejects.toThrow()
  })
})
