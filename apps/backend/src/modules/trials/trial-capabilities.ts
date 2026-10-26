import type { TrialProfile } from './trial-contract.js'

export const trialFeatureKeys = ['agents', 'secrets', 'snippets', 'portForwarding', 'integrations', 'feedback', 'localAi', 'terminalAutocomplete', 'terminalAi', 'mcp', 'aiSshActions', 'sessionAuditAiAutoSummary'] as const
export const trialIntegrationKeys = ['jira', 'google', 'ldap', 'onepassword', 'oidc', 'scim'] as const

/** Missing experience always preserves the restricted legacy profile. */
export function isFullTrialProfile(profile: unknown): boolean {
  return !!profile && typeof profile === 'object' && (profile as { experience?: unknown }).experience === 'full'
}
export function trialLicenseData(profile: TrialProfile): {
  multiConnect: boolean; sessionAuditEnabled: boolean; sessionAuditAiEnabled: boolean;
  featureEntitlementsJson: Record<string, boolean>; integrationEntitlementsJson: Record<string, boolean>
} {
  const full = isFullTrialProfile(profile)
  const features: Record<string, boolean> = full
    ? Object.fromEntries(trialFeatureKeys.map(key => [key, profile.features?.[key] !== false]))
    : { snippets: true }
  features.sharedSessions = profile.resources.includes('sharing')
  features.sessionAuditAiAutoSummary = full && profile.resources.includes('audit') && features.sessionAuditAiAutoSummary === true
  return {
    multiConnect: full, sessionAuditEnabled: profile.resources.includes('audit'),
    sessionAuditAiEnabled: full && profile.resources.includes('audit') && features.localAi === true,
    featureEntitlementsJson: features,
    integrationEntitlementsJson: full ? Object.fromEntries(trialIntegrationKeys.map(key => [key, features.integrations === true && profile.integrations?.[key] !== false])) : {},
  }
}
