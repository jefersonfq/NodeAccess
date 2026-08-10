import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INSTALLATION_AUTH_POLICY,
  DEFAULT_TENANT_AUTH_POLICY,
  resolveTenantAuthPolicy,
} from './auth-policy.js'

describe('resolveTenantAuthPolicy', () => {
  it('preserves the current secure defaults', () => {
    expect(resolveTenantAuthPolicy(
      DEFAULT_INSTALLATION_AUTH_POLICY,
      DEFAULT_TENANT_AUTH_POLICY,
    )).toEqual({
      localLoginEnabled: true,
      ssoRequired: false,
      mfaRequired: true,
      jitProvisioningEnabled: false,
      automaticAccountLinkingEnabled: false,
      emailTenantDiscoveryEnabled: true,
      lockoutMaxAttempts: 5,
      lockoutDurationMinutes: 15,
      accessTokenMinutes: 15,
      refreshTokenDays: 7,
    })
  })

  it('does not let a tenant weaken installation requirements', () => {
    const effective = resolveTenantAuthPolicy(
      DEFAULT_INSTALLATION_AUTH_POLICY,
      {
        ...DEFAULT_TENANT_AUTH_POLICY,
        mfaRequired: false,
        jitProvisioningEnabled: true,
        automaticAccountLinkingEnabled: true,
      },
    )

    expect(effective.mfaRequired).toBe(true)
    expect(effective.jitProvisioningEnabled).toBe(false)
    expect(effective.automaticAccountLinkingEnabled).toBe(false)
  })

  it('clamps tenant values to installation floors and ceilings', () => {
    const effective = resolveTenantAuthPolicy(
      DEFAULT_INSTALLATION_AUTH_POLICY,
      {
        ...DEFAULT_TENANT_AUTH_POLICY,
        lockoutMaxAttempts: 50,
        lockoutDurationMinutes: 1,
        accessTokenMinutes: 120,
        refreshTokenDays: 0,
      },
    )

    expect(effective.lockoutMaxAttempts).toBe(10)
    expect(effective.lockoutDurationMinutes).toBe(5)
    expect(effective.accessTokenMinutes).toBe(60)
    expect(effective.refreshTokenDays).toBe(1)
  })

  it('disables local login when SSO is required', () => {
    const effective = resolveTenantAuthPolicy(
      DEFAULT_INSTALLATION_AUTH_POLICY,
      { ...DEFAULT_TENANT_AUTH_POLICY, ssoRequired: true },
    )

    expect(effective.ssoRequired).toBe(true)
    expect(effective.localLoginEnabled).toBe(false)
  })

  it('lets the installation disable public tenant discovery', () => {
    const effective = resolveTenantAuthPolicy(
      { ...DEFAULT_INSTALLATION_AUTH_POLICY, allowEmailTenantDiscovery: false },
      DEFAULT_TENANT_AUTH_POLICY,
    )

    expect(effective.emailTenantDiscoveryEnabled).toBe(false)
  })
})
