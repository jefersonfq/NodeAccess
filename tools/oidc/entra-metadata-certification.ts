import { OidcService } from '../../apps/backend/src/modules/auth/oidc.service.js'

const defaultTenantId = '72f988bf-86f1-41af-91ab-2d7cd011db47'
const tenantId = (process.env.ENTRA_TENANT_ID ?? defaultTenantId).trim()
const tenantGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function main(): Promise<void> {
  if (!tenantGuid.test(tenantId)) throw new Error('ENTRA_TENANT_ID deve ser um GUID válido')
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
  const oidc = new OidcService()
  const discovery = await oidc.discover(issuer)
  const keysResponse = await fetch(discovery.jwks_uri, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!keysResponse.ok) throw new Error('Não foi possível carregar o JWKS do Microsoft Entra ID')
  const jwks = await keysResponse.json() as { keys?: Array<{ kid?: string; kty?: string; use?: string }> }
  const signingKeys = (jwks.keys ?? []).filter((key) => key.kid && key.kty === 'RSA' && key.use === 'sig')
  if (signingKeys.length === 0) throw new Error('Microsoft Entra ID não publicou chaves RSA de assinatura')
  if (!discovery.id_token_signing_alg_values_supported?.includes('RS256')) {
    throw new Error('Microsoft Entra ID não anunciou RS256 para ID tokens')
  }

  process.stdout.write(JSON.stringify({
    provider: 'microsoft-entra-id',
    tenantSpecificIssuer: discovery.issuer === issuer,
    discovery: true,
    httpsEndpoints: [
      discovery.authorization_endpoint,
      discovery.token_endpoint,
      discovery.jwks_uri,
    ].every((endpoint) => endpoint.startsWith('https://')),
    rs256: true,
    signingKeysAvailable: signingKeys.length > 0,
    interactiveLoginCertified: false,
    sensitiveTokensPrinted: false,
  }, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
