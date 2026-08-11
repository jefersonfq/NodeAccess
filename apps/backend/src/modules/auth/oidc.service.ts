import { createHash, randomBytes } from 'node:crypto'
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose'

const ALLOWED_ID_TOKEN_ALGORITHMS = ['RS256', 'ES256']

export interface OidcDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  id_token_signing_alg_values_supported?: string[]
}

export interface OidcAuthorizationRequest {
  url: string
  state: string
  nonce: string
  codeVerifier: string
}

export interface VerifiedOidcIdentity {
  subject: string
  email: string | null
  emailVerified: boolean
  name: string | null
  groups: string[]
  claims: JWTPayload
}

export class OidcService {
  normalizeIssuer(value: string): string {
    const url = requireHttpsUrl(value, 'Issuer OIDC', true)
    if (url.search || url.hash) throw new Error('Issuer OIDC não pode conter query ou fragmento')
    assertSupportedMicrosoftEntraIssuer(url)
    return url.toString().replace(/\/$/, '')
  }

  async discover(issuerInput: string): Promise<OidcDiscoveryDocument> {
    const issuer = this.normalizeIssuer(issuerInput)
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Não foi possível carregar o discovery OIDC')

    const document = await response.json() as Partial<OidcDiscoveryDocument>
    if (document.issuer !== issuer) throw new Error('Issuer retornado pelo discovery não corresponde ao configurado')
    if (!document.authorization_endpoint || !document.token_endpoint || !document.jwks_uri) {
      throw new Error('Discovery OIDC não contém endpoints obrigatórios')
    }
    requireHttpsUrl(document.authorization_endpoint, 'Authorization endpoint OIDC', true)
    requireHttpsUrl(document.token_endpoint, 'Token endpoint OIDC', true)
    requireHttpsUrl(document.jwks_uri, 'JWKS URI OIDC', true)

    const supported = document.id_token_signing_alg_values_supported
    if (supported && !supported.some((algorithm) => ALLOWED_ID_TOKEN_ALGORITHMS.includes(algorithm))) {
      throw new Error('Discovery OIDC não oferece algoritmo de assinatura permitido')
    }

    return document as OidcDiscoveryDocument
  }

  createAuthorizationRequest(input: {
    discovery: OidcDiscoveryDocument
    clientId: string
    redirectUri: string
    scopes?: string[]
  }): OidcAuthorizationRequest {
    const redirectUri = requireHttpsUrl(input.redirectUri, 'Redirect URI OIDC', true).toString()
    const state = randomUrlSafeValue()
    const nonce = randomUrlSafeValue()
    const codeVerifier = randomUrlSafeValue(48)
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const url = new URL(input.discovery.authorization_endpoint)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: input.clientId,
      redirect_uri: redirectUri,
      scope: normalizeScopes(input.scopes).join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString()
    return { url: url.toString(), state, nonce, codeVerifier }
  }

  async verifyIdToken(input: {
    idToken: string
    discovery: OidcDiscoveryDocument
    clientId: string
    nonce: string
    keyResolver?: JWTVerifyGetKey
  }): Promise<VerifiedOidcIdentity> {
    const keyResolver = input.keyResolver
      ?? createRemoteJWKSet(new URL(input.discovery.jwks_uri))
    const { payload } = await jwtVerify(input.idToken, keyResolver, {
      issuer: input.discovery.issuer,
      audience: input.clientId,
      algorithms: ALLOWED_ID_TOKEN_ALGORITHMS,
    })
    if (!payload.sub) throw new Error('ID token OIDC não possui subject')
    if (payload.nonce !== input.nonce) throw new Error('Nonce OIDC inválido')

    return {
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === 'string' ? payload.name : null,
      groups: Array.isArray(payload.groups)
        ? payload.groups.filter((group): group is string => typeof group === 'string')
        : [],
      claims: payload,
    }
  }
}

function requireHttpsUrl(value: string, label: string, allowDevelopmentLoopback = false): URL {
  const url = new URL(value.trim())
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(allowDevelopmentLoopback && process.env.NODE_ENV !== 'production' && loopback)) {
    throw new Error(`${label} deve usar HTTPS`)
  }
  if (url.username || url.password) throw new Error(`${label} não pode conter credenciais`)
  return url
}

function assertSupportedMicrosoftEntraIssuer(url: URL): void {
  if (url.hostname.toLowerCase() !== 'login.microsoftonline.com') return
  const segments = url.pathname.split('/').filter(Boolean)
  const tenantId = segments[0] ?? ''
  const tenantGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (segments.length !== 2 || !tenantGuid.test(tenantId) || segments[1]?.toLowerCase() !== 'v2.0') {
    throw new Error('Issuer Microsoft Entra ID deve usar o Tenant ID (GUID) no endpoint v2.0')
  }
}

function randomUrlSafeValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function normalizeScopes(scopes?: string[]): string[] {
  const normalized = new Set(['openid', 'profile', 'email'])
  for (const scope of scopes ?? []) {
    const value = scope.trim()
    if (value && !/\s/.test(value)) normalized.add(value)
  }
  return [...normalized]
}
