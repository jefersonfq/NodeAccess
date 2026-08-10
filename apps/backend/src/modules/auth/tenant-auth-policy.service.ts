import bcrypt from 'bcrypt'
import type { BreakGlassStatus, TenantAuthPolicyDto, TenantAuthPolicyPublic } from '@nodeaccess/shared'
import type { LogRepository } from '../logs/log.repository.js'
import {
  DEFAULT_INSTALLATION_AUTH_POLICY,
  DEFAULT_TENANT_AUTH_POLICY,
  resolveTenantAuthPolicy,
} from './auth-policy.js'
import type { TenantAuthPolicyRepository } from './tenant-auth-policy.repository.js'
import type { EffectiveTenantAuthPolicy } from './auth-policy.js'
import type { TenantAuthPolicyRequest } from './auth-policy.js'
import { env } from '../../config/env.js'
import { BadRequestError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { AuthMethod } from '../../shared/guards.js'

export class TenantAuthPolicyService {
  constructor(
    private readonly repository: TenantAuthPolicyRepository,
    private readonly logs: LogRepository,
    private readonly users: UserRepository,
  ) {}

  async get(tenantId: number): Promise<TenantAuthPolicyPublic> {
    const requested = await this.repository.find(tenantId) ?? DEFAULT_TENANT_AUTH_POLICY
    return this.toPublic(requested)
  }

  async getEffective(tenantId: number): Promise<EffectiveTenantAuthPolicy> {
    return (await this.get(tenantId)).effective
  }

  async isEmailTenantDiscoveryEnabled(tenantId: number): Promise<boolean> {
    return (await this.getEffective(tenantId)).emailTenantDiscoveryEnabled
  }

  async getPasswordLockoutPolicy(tenantId: number): Promise<{
    maxAttempts: number
    durationMinutes: number
  }> {
    const effective = await this.getEffective(tenantId)
    return {
      maxAttempts: effective.lockoutMaxAttempts,
      durationMinutes: effective.lockoutDurationMinutes,
    }
  }

  async getTokenLifetimePolicy(tenantId: number): Promise<{
    accessTokenSeconds: number
    refreshTokenSeconds: number
  }> {
    const effective = await this.getEffective(tenantId)
    return {
      accessTokenSeconds: Math.min(
        effective.accessTokenMinutes * 60,
        durationSeconds(env.JWT_EXPIRES_IN, 15 * 60),
      ),
      refreshTokenSeconds: Math.min(
        effective.refreshTokenDays * 24 * 60 * 60,
        durationSeconds(env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60),
      ),
    }
  }

  async canRefreshSession(tenantId: number, email: string, authMethod?: AuthMethod): Promise<boolean> {
    const mode = await this.getPasswordLoginMode(tenantId, email)
    if (authMethod === 'oidc' || authMethod === 'google') return true
    if (authMethod === 'break_glass') return mode === 'break_glass'
    if (authMethod === 'ldap') return mode === 'standard' || mode === 'ldap_only'
    if (authMethod === 'local') return mode === 'standard'
    return mode === 'standard'
  }

  async getPasswordLoginMode(tenantId: number, email: string): Promise<'standard' | 'break_glass' | 'ldap_only' | 'blocked'> {
    const requested = await this.repository.find(tenantId) ?? DEFAULT_TENANT_AUTH_POLICY
    const effective = this.toPublic(requested).effective
    if (effective.localLoginEnabled) return 'standard'
    const breakGlass = await this.repository.getBreakGlass(tenantId)
    if (breakGlass?.email.toLowerCase() === email.trim().toLowerCase()) return 'break_glass'
    return effective.ssoRequired ? 'blocked' : 'ldap_only'
  }

  async update(tenantId: number, adminId: number, dto: TenantAuthPolicyDto): Promise<TenantAuthPolicyPublic> {
    if (dto.ssoRequired || !dto.localLoginEnabled) {
      const breakGlass = await this.repository.getBreakGlass(tenantId)
      if (!breakGlass) {
        throw new BadRequestError('Restringir o login local exige uma conta break-glass validada')
      }
    }
    const requested = await this.repository.upsert(tenantId, toPolicyRequest(dto))
    const result = this.toPublic(requested)
    await this.logs.logAdminEvent({
      adminId,
      action: 'UPDATE_TENANT_AUTH_POLICY',
      targetType: 'TenantAuthPolicy',
      targetId: tenantId,
      details: JSON.stringify({ requested: result.requested, effective: result.effective }),
    }).catch(() => {})
    return result
  }

  async getBreakGlass(tenantId: number): Promise<BreakGlassStatus> {
    const account = await this.repository.getBreakGlass(tenantId)
    return account
      ? { configured: true, ...account }
      : { configured: false, userId: null, email: null, validatedAt: null }
  }

  async validateBreakGlass(tenantId: number, adminId: number, email: string, password: string): Promise<BreakGlassStatus> {
    const user = await this.users.findByEmail(email.trim().toLowerCase(), tenantId)
    const valid = Boolean(user?.active && !user.deletedAt && user.role === 'ADMIN' && user.passwordHash
      && !user.forcePasswordChange && (!user.lockedUntil || user.lockedUntil <= new Date())
      && await bcrypt.compare(password, user.passwordHash))
    if (!user || !valid) throw new BadRequestError('Conta local administrativa inválida para break-glass')
    const validatedAt = new Date()
    await this.repository.setBreakGlass(tenantId, user.id, validatedAt)
    await this.logs.logAdminEvent({
      adminId,
      action: 'VALIDATE_BREAK_GLASS_ACCOUNT',
      targetType: 'User',
      targetId: user.id,
      details: JSON.stringify({ tenantId }),
    })
    return { configured: true, userId: user.id, email: user.email, validatedAt }
  }

  private toPublic(requested: TenantAuthPolicyDto): TenantAuthPolicyPublic {
    const normalized = toPolicyRequest(requested)
    return {
      requested: normalized,
      effective: resolveTenantAuthPolicy({
        ...DEFAULT_INSTALLATION_AUTH_POLICY,
        allowJitProvisioning: env.AUTH_OIDC_ALLOW_JIT,
        allowAutomaticAccountLinking: env.AUTH_OIDC_ALLOW_AUTOMATIC_LINKING,
        allowEmailTenantDiscovery: env.AUTH_ALLOW_EMAIL_TENANT_DISCOVERY,
      }, normalized),
      enforcementEnabled: false,
      ssoRequiredEnforced: true,
      localLoginEnforced: true,
      emailTenantDiscoveryEnforced: true,
      lockoutPolicyEnforced: true,
      tokenLifetimeEnforced: true,
    }
  }
}

function durationSeconds(value: string, fallback: number): number {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/)
  if (!match) return fallback
  const amount = Number(match[1])
  const unit = match[2]
  const multiplier = unit === 'ms' ? 0.001
    : unit === 's' ? 1
      : unit === 'm' ? 60
        : unit === 'h' ? 3_600
          : 86_400
  return Math.max(1, Math.floor(amount * multiplier))
}

function toPolicyRequest(dto: TenantAuthPolicyDto): TenantAuthPolicyRequest {
  return {
    localLoginEnabled: dto.localLoginEnabled,
    ssoRequired: dto.ssoRequired,
    mfaRequired: dto.mfaRequired,
    jitProvisioningEnabled: dto.jitProvisioningEnabled,
    automaticAccountLinkingEnabled: dto.automaticAccountLinkingEnabled,
    emailTenantDiscoveryEnabled: dto.emailTenantDiscoveryEnabled,
    ...(dto.lockoutMaxAttempts !== undefined && { lockoutMaxAttempts: dto.lockoutMaxAttempts }),
    ...(dto.lockoutDurationMinutes !== undefined && { lockoutDurationMinutes: dto.lockoutDurationMinutes }),
    ...(dto.accessTokenMinutes !== undefined && { accessTokenMinutes: dto.accessTokenMinutes }),
    ...(dto.refreshTokenDays !== undefined && { refreshTokenDays: dto.refreshTokenDays }),
  }
}
