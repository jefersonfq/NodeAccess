import { createHash } from 'node:crypto'
import { denied, type VaultIdentity } from './vault-domain.js'
import type { ProviderMethod, ProviderProofInput, ProviderStart, ProviderStepUp } from './vault-ports.js'

/** Provider re-authentication must be recent; clocks may drift by a minute. */
const MAX_AGE_MS = 5 * 60_000
const SKEW_MS = 60_000

export interface OidcStepUpFlow {
  beginStepUp(tenantId: number, redirectUri: string, binding: string): Promise<{ authorizationUrl: string }>
  completeStepUp(state: string, code: string, binding: string): Promise<{
    tenantId: number; issuer: string
    identity: { subject: string; claims: Record<string, unknown> }
    mfaAssurance: { satisfied: boolean }
  }>
}
export interface OidcIdentityLinks {
  findUser(tenantId: number, issuer: string, subject: string): Promise<{ id: number } | null>
  isRevoked(tenantId: number, issuer: string, subject: string): Promise<boolean>
}
export interface GoogleStepUp {
  config(tenantId: number): Promise<{ clientId: string; domain?: string } | null>
  verify(idToken: string, clientId: string, tenantId: number): Promise<{ sub: string; hd?: string; nonce?: string; iat?: string | number }>
  userIdByGoogleId(sub: string, tenantId: number): Promise<number | null>
}

/** Nonce sent to Google, derived from the secret challenge binding; never stored. */
export function googleStepUpNonce(binding: string): string {
  return createHash('sha256').update(`nodeaccess-vault-google-step-up:${binding}`).digest('base64url')
}

function recent(epochSeconds: unknown, now: number): boolean {
  const value = typeof epochSeconds === 'string' && /^\d{1,12}$/.test(epochSeconds) ? Number(epochSeconds) : epochSeconds
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false
  const at = value * 1000
  return at <= now + SKEW_MS && now - at <= MAX_AGE_MS
}

/**
 * Proves a fresh provider login by the same linked identity. OIDC forces prompt=login/max_age=0 and checks
 * auth_time; Google proves a new ID token bound to the challenge (TOTP is always required for Google).
 */
export class VaultProviderStepUp implements ProviderStepUp {
  constructor(private readonly oidc: OidcStepUpFlow, private readonly links: OidcIdentityLinks,
    private readonly google: GoogleStepUp, private readonly redirectUri: () => string, private readonly now = Date.now) {}

  async begin(identity: VaultIdentity, method: ProviderMethod, binding: string): Promise<ProviderStart> {
    if (method === 'oidc') {
      const { authorizationUrl } = await this.oidc.beginStepUp(identity.tenantId, this.redirectUri(), binding)
      return { kind: 'redirect', authorizationUrl }
    }
    const config = await this.google.config(identity.tenantId)
    if (!config?.clientId) denied()
    return { kind: 'google', clientId: config.clientId, nonce: googleStepUpNonce(binding) }
  }

  async complete(identity: VaultIdentity, method: ProviderMethod, binding: string, input: ProviderProofInput): Promise<{ mfa: boolean }> {
    if (method === 'oidc') {
      if (!input.state || !input.code) denied()
      const result = await this.oidc.completeStepUp(input.state, input.code, binding)
      if (result.tenantId !== identity.tenantId || !recent(result.identity.claims.auth_time, this.now())) denied()
      if (await this.links.isRevoked(identity.tenantId, result.issuer, result.identity.subject)) denied()
      const user = await this.links.findUser(identity.tenantId, result.issuer, result.identity.subject)
      if (user?.id !== identity.userId) denied()
      return { mfa: result.mfaAssurance.satisfied }
    }
    if (!input.idToken) denied()
    const config = await this.google.config(identity.tenantId)
    if (!config?.clientId) denied()
    const info = await this.google.verify(input.idToken, config.clientId, identity.tenantId)
    if ((config.domain && info.hd !== config.domain) || info.nonce !== googleStepUpNonce(binding) || !recent(info.iat, this.now())) denied()
    if (await this.google.userIdByGoogleId(info.sub, identity.tenantId) !== identity.userId) denied()
    return { mfa: false }
  }
}
