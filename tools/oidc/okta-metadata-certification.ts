import { OidcService } from '../../apps/backend/src/modules/auth/oidc.service.js'

async function main(): Promise<void> {
  const issuerInput = process.env.OKTA_ISSUER?.trim()
  if (!issuerInput) {
    throw new Error('Informe OKTA_ISSUER com o issuer de uma organização Okta controlada')
  }
  const oidc = new OidcService()
  const issuer = oidc.normalizeIssuer(issuerInput)
  const discovery = await oidc.discover(issuer)
  const keysResponse = await fetch(discovery.jwks_uri, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!keysResponse.ok) throw new Error('Não foi possível carregar o JWKS do Okta')
  const jwks = await keysResponse.json() as { keys?: Array<{ kid?: string; kty?: string; use?: string }> }
  const signingKeys = (jwks.keys ?? []).filter((key) => key.kid && key.kty === 'RSA' && key.use === 'sig')
  if (signingKeys.length === 0) throw new Error('Okta não publicou chaves RSA de assinatura')
  if (!discovery.id_token_signing_alg_values_supported?.includes('RS256')) {
    throw new Error('Okta não anunciou RS256 para ID tokens')
  }

  const request = oidc.createAuthorizationRequest({
    discovery,
    clientId: process.env.OKTA_CLIENT_ID?.trim() || 'nodeaccess-metadata-preflight',
    redirectUri: 'https://nodeaccess.example.test/auth/oidc/callback',
    scopes: ['openid', 'profile', 'email', 'groups'],
  })
  const authorizationUrl = new URL(request.url)
  const pkceReady = authorizationUrl.searchParams.get('response_type') === 'code'
    && authorizationUrl.searchParams.get('code_challenge_method') === 'S256'
    && Boolean(authorizationUrl.searchParams.get('code_challenge'))
    && authorizationUrl.searchParams.get('scope')?.split(' ').includes('groups') === true
  if (!pkceReady) throw new Error('Authorization request Okta não preservou Code + PKCE e scopes')

  process.stdout.write(JSON.stringify({
    provider: 'okta',
    exactIssuer: discovery.issuer === issuer,
    discovery: true,
    httpsEndpoints: [
      discovery.authorization_endpoint,
      discovery.token_endpoint,
      discovery.jwks_uri,
    ].every((endpoint) => endpoint.startsWith('https://')),
    rs256: true,
    signingKeysAvailable: signingKeys.length > 0,
    authorizationCodePkcePrepared: true,
    interactiveLoginCertified: false,
    groupsClaimCertified: false,
    delegatedMfaCertified: false,
    sensitiveTokensPrinted: false,
  }, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
