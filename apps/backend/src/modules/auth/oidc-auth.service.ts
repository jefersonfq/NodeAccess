import { env } from '../../config/env.js'
import { ForbiddenError, UnauthorizedError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { AuthService, AuthTokens, LoginResult } from './auth.service.js'
import type { ExternalIdentityService } from './external-identity.service.js'
import type { OidcConfigService } from './oidc-config.service.js'
import type { OidcFlowService } from './oidc-flow.service.js'
import { SSO_REJECTED_MESSAGE } from './auth-public-errors.js'

export interface OidcAuthPolicyProvider {
  getEffective(tenantId: number): Promise<{ mfaRequired: boolean }>
}

export class OidcAuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly configs: OidcConfigService,
    private readonly flow: OidcFlowService,
    private readonly identities: ExternalIdentityService,
    private readonly auth: AuthService,
    private readonly policies: OidcAuthPolicyProvider,
  ) {}

  async getPublicConfig(tenantSlug: string): Promise<{ enabled: boolean; name: string | null }> {
    const tenant = await this.users.findTenantBySlug(tenantSlug)
    if (!tenant?.active) return { enabled: false, name: null }
    const config = await this.configs.getPublic(tenant.id)
    return { enabled: config.enabled, name: config.name }
  }

  async begin(tenantSlug: string): Promise<{ authorizationUrl: string }> {
    const tenant = await this.users.findTenantBySlug(tenantSlug)
    if (!tenant?.active) throw new UnauthorizedError(SSO_REJECTED_MESSAGE)
    return this.flow.begin(tenant.id, callbackUrl())
  }

  async complete(state: string, code: string): Promise<AuthTokens | LoginResult> {
    try {
      const completed = await this.flow.complete(state, code)
      const identity = completed.identity
      const issuer = typeof identity.claims.iss === 'string' ? identity.claims.iss : ''
      if (!issuer) throw new UnauthorizedError()
      const user = await this.identities.resolveOidcUser({
        tenantId: completed.tenantId,
        issuer,
        subject: identity.subject,
        email: identity.email,
        emailVerified: identity.emailVerified,
        name: identity.name,
      })
      await this.users.logAuthEvent({ userId: user.id, eventType: 'SSO_LOGIN', success: true }).catch(() => {})
      const policy = await this.policies.getEffective(completed.tenantId)
      if (policy.mfaRequired && !completed.mfaAssurance.satisfied) {
        return this.auth.beginMfaForUser(user, completed.tenantId, 'oidc')
      }
      return this.auth.issueTokensForUser(user, completed.tenantId, 'oidc')
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
        throw new UnauthorizedError(SSO_REJECTED_MESSAGE)
      }
      throw error
    }
  }
}

function callbackUrl(): string {
  if (!env.APP_FRONTEND_URL) throw new Error('APP_FRONTEND_URL obrigatório para OIDC')
  const url = new URL('/auth/oidc/callback', env.APP_FRONTEND_URL)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('APP_FRONTEND_URL deve usar HTTPS em produção')
  }
  return url.toString()
}
