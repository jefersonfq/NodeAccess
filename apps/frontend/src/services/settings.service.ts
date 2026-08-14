import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface SettingsData {
  tenant: {
    id:   number
    name: string
    slug: string
  }
  environment: {
    features: {
      sessionAudit: boolean
      sessionAuditAiSummary: boolean
      sessionAuditAiAutoSummary: boolean
      localAi: boolean
      nativeSshGateway: boolean
    }
  }
  license: {
    maxUsers:     number
    maxHosts:     number | null
    activeUsers:  number
    registeredHosts: number
    hasKey:       boolean
    multiConnect: boolean
    sessionAuditEnabled: boolean
    sessionAuditAiEnabled: boolean
    sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
    sessionAuditAiAutoSummaryEnabled: boolean
    featureEntitlements: Record<string, boolean>
    integrationEntitlements: Record<string, boolean>
  }
  sessionLimits: {
    activeSessions: number
    maxPerUser: number | null
    maxPerTenant: number | null
  }
  passwordPolicy: {
    minLength:   number
    regex:       string
    description: string
  }
  tenantSettings: {
    totpIssuer: string
    hostsDefaultView: 'home' | 'list'
  }
  jitAccess: {
    enabled: boolean
    expiryMinutes: number[]
    maxExpiryMinutes: number
    pinRequired: boolean
  }
  sharedSessions: {
    expiryMinutes: number[]
    maxExpiryMinutes: number
  }
  sftpPolicy?: {
    blockOnModePreservationFailure: boolean
    blockOnOwnershipPreservationFailure: boolean
    blockOnTimestampPreservationFailure: boolean
    diffMaxBytes: number
    diffMaxLines: number
  }
}

export interface UpdateLicenseSettingsPayload {
  maxUsers: number
  maxHosts: number | null
  multiConnect: boolean
  sessionAuditEnabled: boolean
  sessionAuditAiEnabled: boolean
  sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
  sessionAuditAiAutoSummaryEnabled: boolean
  featureEntitlements: Record<string, boolean>
  integrationEntitlements: Record<string, boolean>
}

export interface UpdateSessionLimitsPayload {
  maxPerUser:   number | null
  maxPerTenant: number | null
}

export interface UpdatePasswordPolicyPayload {
  minLength:   number
  regex:       string
  description: string
}

export interface UpdateTenantSettingsPayload {
  totpIssuer: string
  hostsDefaultView: 'home' | 'list'
}

export interface UpdateJitAccessSettingsPayload {
  enabled: boolean
  expiryMinutes: number[]
  maxExpiryMinutes: number
  pinRequired: boolean
}

export interface UpdateSharedSessionSettingsPayload {
  expiryMinutes: number[]
  maxExpiryMinutes: number
}

export interface UpdateSftpPolicySettingsPayload {
  blockOnModePreservationFailure: boolean
  blockOnOwnershipPreservationFailure: boolean
  blockOnTimestampPreservationFailure: boolean
  diffMaxBytes: number
  diffMaxLines: number
}

const cache = createTimedPromiseCache<{ data: SettingsData }>(cacheTtls.settings, { name: 'settings' })

export const settingsService = {
  get:                  () => cache.get(() => api.get<SettingsData>('/settings')),
  updateLicense:        (p: UpdateLicenseSettingsPayload)   => api.patch<SettingsData>('/settings/license', p),
  getPlatform:          () => api.get<SettingsData['environment']>('/settings/platform'),
  getTenantLicense:     (tenantId: number) => api.get<SettingsData['license']>(`/settings/platform/tenants/${tenantId}/license`),
  updateTenantLicense:  (tenantId: number, p: UpdateLicenseSettingsPayload) => api.patch<SettingsData['license']>(`/settings/platform/tenants/${tenantId}/license`, p),
  updateSessionLimits:  (p: UpdateSessionLimitsPayload)     => api.patch<SettingsData>('/settings/session-limits', p),
  updatePasswordPolicy: (p: UpdatePasswordPolicyPayload)    => api.patch<SettingsData>('/settings/password-policy', p),
  updateTenantSettings: (p: UpdateTenantSettingsPayload)    => api.patch<SettingsData>('/settings/tenant-settings', p),
  updateJitAccess:      (p: UpdateJitAccessSettingsPayload) => api.patch<SettingsData>('/settings/jit-access', p),
  updateSharedSessions: (p: UpdateSharedSessionSettingsPayload) => api.patch<SettingsData>('/settings/shared-sessions', p),
  updateSftpPolicy:     (p: UpdateSftpPolicySettingsPayload) => api.patch<SettingsData>('/settings/sftp-policy', p),
  clear: () => cache.clear(),
}
