import { describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { OidcService, type OidcDiscoveryDocument } from './oidc.service.js'

const service = new OidcService()
const clientId = 'nodeaccess-compatibility'

const profiles = [
  {
    provider: 'microsoft-entra-id',
    issuer: 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0',
    claims: { email: 'user@contoso.test', email_verified: true, name: 'Entra User', groups: ['entra-operators'], amr: ['pwd', 'mfa'] },
  },
  {
    provider: 'okta',
    issuer: 'https://dev-00000000.okta.com/oauth2/default',
    claims: { email: 'user@example.test', email_verified: true, name: 'Okta User', groups: ['okta-operators'], amr: ['pwd', 'otp'], acr: 'urn:okta:loa:2fa:any' },
  },
] as const

function discovery(issuer: string): OidcDiscoveryDocument {
  return {
    issuer,
    authorization_endpoint: `${issuer}/v1/authorize`,
    token_endpoint: `${issuer}/v1/token`,
    jwks_uri: `${issuer}/v1/keys`,
    end_session_endpoint: `${issuer}/v1/logout`,
    id_token_signing_alg_values_supported: ['RS256'],
  }
}

describe('OIDC provider compatibility matrix (simulated)', () => {
  it.each(profiles)('normalizes $provider claims with RS256', async ({ issuer, claims }) => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const token = await new SignJWT({ nonce: 'compat-nonce', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'profile-key' })
      .setIssuer(issuer).setAudience(clientId).setSubject('external-subject').setIssuedAt().setExpirationTime('5m')
      .sign(privateKey)

    await expect(service.verifyIdToken({
      idToken: token,
      discovery: discovery(issuer),
      clientId,
      nonce: 'compat-nonce',
      keyResolver: createLocalJWKSet({ keys: [{ ...jwk, kid: 'profile-key', alg: 'RS256' }] }),
    })).resolves.toMatchObject({ email: claims.email, emailVerified: true, groups: [claims.groups[0]] })
  })

  it('accepts JWKS rotation and rejects a token signed by a removed key', async () => {
    const oldPair = await generateKeyPair('RS256')
    const newPair = await generateKeyPair('RS256')
    const oldJwk = await exportJWK(oldPair.publicKey)
    const newJwk = await exportJWK(newPair.publicKey)
    const doc = discovery(profiles[1].issuer)
    const sign = (kid: string, key: typeof oldPair.privateKey) => new SignJWT({ nonce: 'rotation-nonce', email: 'user@example.test', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid }).setIssuer(doc.issuer).setAudience(clientId)
      .setSubject('rotating-subject').setIssuedAt().setExpirationTime('5m').sign(key)
    const oldToken = await sign('old-key', oldPair.privateKey)
    const newToken = await sign('new-key', newPair.privateKey)
    const transitionKeys = createLocalJWKSet({ keys: [
      { ...oldJwk, kid: 'old-key', alg: 'RS256' },
      { ...newJwk, kid: 'new-key', alg: 'RS256' },
    ] })

    await expect(service.verifyIdToken({ idToken: oldToken, discovery: doc, clientId, nonce: 'rotation-nonce', keyResolver: transitionKeys })).resolves.toBeDefined()
    await expect(service.verifyIdToken({ idToken: newToken, discovery: doc, clientId, nonce: 'rotation-nonce', keyResolver: transitionKeys })).resolves.toBeDefined()
    await expect(service.verifyIdToken({
      idToken: oldToken, discovery: doc, clientId, nonce: 'rotation-nonce',
      keyResolver: createLocalJWKSet({ keys: [{ ...newJwk, kid: 'new-key', alg: 'RS256' }] }),
    })).rejects.toThrow()
  })

  it('allows at most 60 seconds of clock skew', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const doc = discovery(profiles[0].issuer)
    const keyResolver = createLocalJWKSet({ keys: [{ ...jwk, kid: 'clock-key', alg: 'RS256' }] })
    const token = (expiredSecondsAgo: number) => new SignJWT({ nonce: 'clock-nonce' })
      .setProtectedHeader({ alg: 'RS256', kid: 'clock-key' }).setIssuer(doc.issuer).setAudience(clientId)
      .setSubject('clock-subject').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - expiredSecondsAgo).sign(privateKey)

    await expect(service.verifyIdToken({ idToken: await token(30), discovery: doc, clientId, nonce: 'clock-nonce', keyResolver })).resolves.toBeDefined()
    await expect(service.verifyIdToken({ idToken: await token(90), discovery: doc, clientId, nonce: 'clock-nonce', keyResolver })).rejects.toThrow()
  })
})
