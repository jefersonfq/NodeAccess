import type { User } from '@prisma/client'
import { UnauthorizedError } from '../../shared/errors.js'
import type { ExternalIdentityRepository } from './external-identity.repository.js'
import type { OidcConfigService } from './oidc-config.service.js'
import type { EffectiveTenantAuthPolicy } from './auth-policy.js'
import type { OidcGroupMappingRepository } from './oidc-group-mapping.repository.js'

export interface ExternalIdentityPolicyProvider {
  getEffective(tenantId: number): Promise<EffectiveTenantAuthPolicy>
}

export class ExternalIdentityService {
  constructor(
    private readonly repository: ExternalIdentityRepository,
    private readonly configs: OidcConfigService,
    private readonly policies: ExternalIdentityPolicyProvider,
    private readonly groupMappings?: OidcGroupMappingRepository,
  ) {}

  async resolveOidcUser(input: {
    tenantId: number
    issuer: string
    subject: string
    email: string | null
    emailVerified: boolean
    name: string | null
    groups?: string[]
  }): Promise<User> {
    const linked = await this.repository.findLinked(input.tenantId, input.issuer, input.subject)
    if (linked) {
      if (!linked.user.active) throw new UnauthorizedError('Conta desativada')
      await this.syncGroups(input, linked.identityId, linked.user.id)
      return linked.user
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
        await this.repository.requestLink({
          tenantId: input.tenantId,
          userId: existing.id,
          providerKey: 'oidc',
          issuer: input.issuer,
          subject: input.subject,
          email,
          privileged: existing.role === 'ADMIN' || existing.isPlatformAdmin,
        })
        throw new UnauthorizedError('Vínculo de identidade requer aprovação administrativa')
      }
      const resolved = await this.repository.link({
        tenantId: input.tenantId,
        userId: existing.id,
        providerKey: 'oidc',
        issuer: input.issuer,
        subject: input.subject,
        email,
      })
      await this.syncGroups(input, resolved.identityId, resolved.user.id)
      return resolved.user
    }

    if (!policy.jitProvisioningEnabled || !config.autoProvision) {
      throw new UnauthorizedError('Usuário não provisionado para este tenant')
    }
    const resolved = await this.repository.createJit({
      tenantId: input.tenantId,
      providerKey: 'oidc',
      issuer: input.issuer,
      subject: input.subject,
      email,
      name: input.name?.trim() || email,
    })
    await this.syncGroups(input, resolved.identityId, resolved.user.id)
    return resolved.user
  }

  private async syncGroups(input: { tenantId: number; groups?: string[] }, identityId: number, userId: number): Promise<void> {
    await this.groupMappings?.sync({ tenantId: input.tenantId, identityId, userId, externalGroups: input.groups ?? [] })
  }
}

function domainAllowed(email: string, allowedDomains: string[]): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain || allowedDomains.length === 0) return false
  return allowedDomains.some((allowed) => allowed.toLowerCase() === domain)
}
