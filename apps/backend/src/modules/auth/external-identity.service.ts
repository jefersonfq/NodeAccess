import type { User } from '@prisma/client'
import { UnauthorizedError } from '../../shared/errors.js'
import type { ExternalIdentityRepository } from './external-identity.repository.js'
import type { OidcConfigService } from './oidc-config.service.js'
import type { EffectiveTenantAuthPolicy } from './auth-policy.js'

export interface ExternalIdentityPolicyProvider {
  getEffective(tenantId: number): Promise<EffectiveTenantAuthPolicy>
}

export class ExternalIdentityService {
  constructor(
    private readonly repository: ExternalIdentityRepository,
    private readonly configs: OidcConfigService,
    private readonly policies: ExternalIdentityPolicyProvider,
  ) {}

  async resolveOidcUser(input: {
    tenantId: number
    issuer: string
    subject: string
    email: string | null
    emailVerified: boolean
    name: string | null
  }): Promise<User> {
    const linked = await this.repository.findUser(input.tenantId, input.issuer, input.subject)
    if (linked) {
      if (!linked.active) throw new UnauthorizedError('Conta desativada')
      return linked
    }
    if (await this.repository.isRevoked(input.tenantId, input.issuer, input.subject)) {
      throw new UnauthorizedError('Vínculo de identidade revogado')
    }

    if (!input.email || !input.emailVerified) {
      throw new UnauthorizedError('O provedor não forneceu um e-mail verificado')
    }
    const email = input.email.trim().toLowerCase()
    const [policy, config] = await Promise.all([
      this.policies.getEffective(input.tenantId),
      this.configs.getEnabled(input.tenantId),
    ])
    if (!config || config.issuer !== input.issuer) throw new UnauthorizedError('Provedor OIDC inválido')
    if (!domainAllowed(email, config.allowedDomains)) {
      throw new UnauthorizedError('Domínio de e-mail não autorizado')
    }

    const existing = await this.repository.findUserByEmail(input.tenantId, email)
    if (existing) {
      if (!existing.active) throw new UnauthorizedError('Conta desativada')
      if (!policy.automaticAccountLinkingEnabled || existing.role === 'ADMIN' || existing.isPlatformAdmin) {
        throw new UnauthorizedError('Vínculo de identidade requer aprovação administrativa')
      }
      return this.repository.link({
        tenantId: input.tenantId,
        userId: existing.id,
        providerKey: 'oidc',
        issuer: input.issuer,
        subject: input.subject,
        email,
      })
    }

    if (!policy.jitProvisioningEnabled || !config.autoProvision) {
      throw new UnauthorizedError('Usuário não provisionado para este tenant')
    }
    return this.repository.createJit({
      tenantId: input.tenantId,
      providerKey: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      email,
      name: input.name?.trim() || email,
    })
  }
}

function domainAllowed(email: string, allowedDomains: string[]): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain || allowedDomains.length === 0) return false
  return allowedDomains.some((allowed) => allowed.toLowerCase() === domain)
}
