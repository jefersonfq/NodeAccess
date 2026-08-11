import type { Redis } from 'ioredis'
import type { OidcConfigService } from './oidc-config.service.js'
import type { OidcService, VerifiedOidcIdentity } from './oidc.service.js'
import { oidcObservability, type OidcObservability } from './oidc-observability.js'

const FLOW_TTL_SECONDS = 5 * 60
const FLOW_KEY_PREFIX = 'nodeaccess:oidc:flow:'

interface StoredOidcFlow {
  tenantId: number
  nonce: string
  codeVerifier: string
  redirectUri: string
  issuer: string
}

export class OidcFlowService {
  constructor(
    private readonly redis: Redis,
    private readonly configs: OidcConfigService,
    private readonly oidc: OidcService,
    private readonly observability: OidcObservability = oidcObservability,
  ) {}

  async begin(tenantId: number, redirectUri: string): Promise<{ authorizationUrl: string }> {
    const config = await this.configs.getEnabled(tenantId)
    if (!config) throw new Error('Provedor OIDC não habilitado para este tenant')
    const discovery = await this.oidc.discover(config.issuer)
    const request = this.oidc.createAuthorizationRequest({
      discovery,
      clientId: config.clientId,
      redirectUri,
      scopes: config.scopes,
    })
    const flow: StoredOidcFlow = {
      tenantId,
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
      redirectUri,
      issuer: discovery.issuer,
    }
    const stored = await this.redis.set(
      `${FLOW_KEY_PREFIX}${request.state}`,
      JSON.stringify(flow),
      'EX',
      FLOW_TTL_SECONDS,
      'NX',
    )
    if (stored !== 'OK') throw new Error('Não foi possível iniciar a transação OIDC')
    return { authorizationUrl: request.url }
  }

  async complete(state: string, code: string): Promise<{
    tenantId: number
    identity: VerifiedOidcIdentity
    mfaAssurance: OidcMfaAssurance
  }> {
    const raw = await this.redis.call('GETDEL', `${FLOW_KEY_PREFIX}${state}`) as string | null
    if (!raw) throw new Error('Transação OIDC inválida, expirada ou já utilizada')
    const flow = JSON.parse(raw) as StoredOidcFlow
    const config = await this.configs.getEnabled(flow.tenantId)
    if (!config || config.issuer !== flow.issuer) throw new Error('Configuração OIDC mudou durante o login')
    const discovery = await this.oidc.discover(config.issuer)
    const exchangeStartedAt = Date.now()
    let tokens: { id_token?: string }
    try {
      const response = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: flow.redirectUri,
          client_id: config.clientId,
          client_secret: this.configs.decryptClientSecret(config),
          code_verifier: flow.codeVerifier,
        }),
      })
      tokens = await response.json() as { id_token?: string }
      if (!response.ok || !tokens.id_token) throw new Error('Falha ao trocar código OIDC')
      this.observability.operation('token_exchange', 'success', Date.now() - exchangeStartedAt)
    } catch (error) {
      this.observability.operation('token_exchange', 'failure', Date.now() - exchangeStartedAt)
      throw error
    }
    const identity = await this.oidc.verifyIdToken({
      idToken: tokens.id_token,
      discovery,
      clientId: config.clientId,
      nonce: flow.nonce,
    })
    const mfaAssurance = evaluateMfaAssurance(identity, config)
    if (config.requireMfaClaim && !mfaAssurance.satisfied) {
      throw new Error('O provedor OIDC não comprovou MFA conforme a configuração do tenant')
    }
    return { tenantId: flow.tenantId, identity, mfaAssurance }
  }
}

export interface OidcMfaAssurance {
  satisfied: boolean
  source: 'amr' | 'acr' | null
}

export function evaluateMfaAssurance(
  identity: VerifiedOidcIdentity,
  config: { requireMfaClaim?: boolean; acceptedAmrValues?: string[]; acceptedAcrValues?: string[] },
): OidcMfaAssurance {
  const acceptedAmr = new Set((config.acceptedAmrValues ?? ['mfa']).map((value) => value.toLowerCase()))
  const acceptedAcr = new Set(config.acceptedAcrValues ?? [])
  const claimAmr = Array.isArray(identity.claims.amr)
    ? identity.claims.amr.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
    : []
  const claimAcr = typeof identity.claims.acr === 'string' ? identity.claims.acr : null
  if (claimAmr.some((value) => acceptedAmr.has(value))) return { satisfied: true, source: 'amr' }
  if (claimAcr && acceptedAcr.has(claimAcr)) return { satisfied: true, source: 'acr' }
  return { satisfied: false, source: null }
}
