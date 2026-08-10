export interface InstallationAuthPolicy {
  requireMfa: boolean
  allowJitProvisioning: boolean
  allowAutomaticAccountLinking: boolean
  allowEmailTenantDiscovery: boolean
  lockoutAttempts: { min: number; max: number; default: number }
  lockoutDurationMinutes: { min: number; max: number; default: number }
  accessTokenMinutes: { min: number; max: number; default: number }
  refreshTokenDays: { min: number; max: number; default: number }
}

export interface TenantAuthPolicyRequest {
  localLoginEnabled: boolean
  ssoRequired: boolean
  mfaRequired: boolean
  jitProvisioningEnabled: boolean
  automaticAccountLinkingEnabled: boolean
  emailTenantDiscoveryEnabled: boolean
  lockoutMaxAttempts?: number
  lockoutDurationMinutes?: number
  accessTokenMinutes?: number
  refreshTokenDays?: number
}

export interface EffectiveTenantAuthPolicy {
  localLoginEnabled: boolean
  ssoRequired: boolean
  mfaRequired: boolean
  jitProvisioningEnabled: boolean
  automaticAccountLinkingEnabled: boolean
  emailTenantDiscoveryEnabled: boolean
  lockoutMaxAttempts: number
  lockoutDurationMinutes: number
  accessTokenMinutes: number
  refreshTokenDays: number
}

export const DEFAULT_INSTALLATION_AUTH_POLICY: InstallationAuthPolicy = {
  requireMfa: true,
  allowJitProvisioning: false,
  allowAutomaticAccountLinking: false,
  allowEmailTenantDiscovery: true,
  lockoutAttempts: { min: 3, max: 10, default: 5 },
  lockoutDurationMinutes: { min: 5, max: 1_440, default: 15 },
  accessTokenMinutes: { min: 5, max: 60, default: 15 },
  refreshTokenDays: { min: 1, max: 30, default: 7 },
}

export const DEFAULT_TENANT_AUTH_POLICY: TenantAuthPolicyRequest = {
  localLoginEnabled: true,
  ssoRequired: false,
  mfaRequired: true,
  jitProvisioningEnabled: false,
  automaticAccountLinkingEnabled: false,
  emailTenantDiscoveryEnabled: true,
}

/**
 * Resolve a política efetiva sem acessar banco ou ambiente.
 * A instalação define capacidades e limites; o tenant somente restringe ou
 * escolhe valores dentro desses limites.
 */
export function resolveTenantAuthPolicy(
  installation: InstallationAuthPolicy,
  tenant: TenantAuthPolicyRequest,
): EffectiveTenantAuthPolicy {
  return {
    localLoginEnabled: tenant.localLoginEnabled && !tenant.ssoRequired,
    ssoRequired: tenant.ssoRequired,
    mfaRequired: installation.requireMfa || tenant.mfaRequired,
    jitProvisioningEnabled: installation.allowJitProvisioning && tenant.jitProvisioningEnabled,
    automaticAccountLinkingEnabled:
      installation.allowAutomaticAccountLinking && tenant.automaticAccountLinkingEnabled,
    emailTenantDiscoveryEnabled:
      installation.allowEmailTenantDiscovery && tenant.emailTenantDiscoveryEnabled,
    lockoutMaxAttempts: resolveBoundedValue(tenant.lockoutMaxAttempts, installation.lockoutAttempts),
    lockoutDurationMinutes: resolveBoundedValue(
      tenant.lockoutDurationMinutes,
      installation.lockoutDurationMinutes,
    ),
    accessTokenMinutes: resolveBoundedValue(tenant.accessTokenMinutes, installation.accessTokenMinutes),
    refreshTokenDays: resolveBoundedValue(tenant.refreshTokenDays, installation.refreshTokenDays),
  }
}

function resolveBoundedValue(
  requested: number | undefined,
  limits: { min: number; max: number; default: number },
): number {
  const value = requested ?? limits.default
  if (!Number.isFinite(value)) return limits.default
  return Math.min(limits.max, Math.max(limits.min, Math.trunc(value)))
}
