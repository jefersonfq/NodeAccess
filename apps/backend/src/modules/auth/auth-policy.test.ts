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

describe('authentication policy boundaries', () => {
  it('keeps tenant defaults restrictive even when installation capabilities are enabled', () => {
    expect(DEFAULT_TENANT_AUTH_POLICY).toEqual({
      localLoginEnabled: true, ssoRequired: false, mfaRequired: true,
      jitProvisioningEnabled: false, automaticAccountLinkingEnabled: false, emailTenantDiscoveryEnabled: true,
    })
    const effective = resolveTenantAuthPolicy({
      ...DEFAULT_INSTALLATION_AUTH_POLICY,
      requireMfa: false, allowJitProvisioning: true, allowAutomaticAccountLinking: true,
    }, DEFAULT_TENANT_AUTH_POLICY)
    expect(effective.mfaRequired).toBe(true)
    expect(effective.jitProvisioningEnabled).toBe(false)
    expect(effective.automaticAccountLinkingEnabled).toBe(false)
  })

  it.each([false, true])('requires tenant consent for installation capability %s', (allowed) => {
    for (const requested of [false, true]) {
      const result = resolveTenantAuthPolicy({
        ...DEFAULT_INSTALLATION_AUTH_POLICY, requireMfa: allowed,
        allowJitProvisioning: allowed, allowAutomaticAccountLinking: allowed, allowEmailTenantDiscovery: allowed,
      }, {
        ...DEFAULT_TENANT_AUTH_POLICY, mfaRequired: requested,
        jitProvisioningEnabled: requested, automaticAccountLinkingEnabled: requested, emailTenantDiscoveryEnabled: requested,
      })
      expect(result.mfaRequired).toBe(allowed || requested)
      expect(result.jitProvisioningEnabled).toBe(allowed && requested)
      expect(result.automaticAccountLinkingEnabled).toBe(allowed && requested)
      expect(result.emailTenantDiscoveryEnabled).toBe(allowed && requested)
    }
  })

  it.each([NaN, Infinity, -Infinity])('falls back to installation defaults for non-finite limits %s', (value) => {
    const result = resolveTenantAuthPolicy(DEFAULT_INSTALLATION_AUTH_POLICY, {
      ...DEFAULT_TENANT_AUTH_POLICY, lockoutMaxAttempts: value, lockoutDurationMinutes: value,
      accessTokenMinutes: value, refreshTokenDays: value,
    })
    expect(result.lockoutMaxAttempts).toBe(5)
    expect(result.lockoutDurationMinutes).toBe(15)
    expect(result.accessTokenMinutes).toBe(15)
    expect(result.refreshTokenDays).toBe(7)
  })

  it('uses integer tenant limits and preserves explicit local-login denial', () => {
    const result = resolveTenantAuthPolicy(DEFAULT_INSTALLATION_AUTH_POLICY, {
      ...DEFAULT_TENANT_AUTH_POLICY, localLoginEnabled: false, ssoRequired: false,
      lockoutMaxAttempts: 6.9, lockoutDurationMinutes: 16.9, accessTokenMinutes: 17.9, refreshTokenDays: 8.9,
    })
    expect(result.localLoginEnabled).toBe(false)
    expect(result.ssoRequired).toBe(false)
    expect(result.lockoutMaxAttempts).toBe(6)
    expect(result.lockoutDurationMinutes).toBe(16)
    expect(result.accessTokenMinutes).toBe(17)
    expect(result.refreshTokenDays).toBe(8)
  })
})
