import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface SettingsData {
  tenant: {
    id:   number
    name: string
    slug: string
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
  }
}

export interface UpdateLicenseSettingsPayload {
  maxHosts: number | null
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
}

const cache = createTimedPromiseCache<{ data: SettingsData }>(cacheTtls.settings, { name: 'settings' })

export const settingsService = {
  get:                  () => cache.get(() => api.get<SettingsData>('/settings')),
  updateLicense:        (p: UpdateLicenseSettingsPayload)   => api.patch<SettingsData>('/settings/license', p),
  updateSessionLimits:  (p: UpdateSessionLimitsPayload)     => api.patch<SettingsData>('/settings/session-limits', p),
  updatePasswordPolicy: (p: UpdatePasswordPolicyPayload)    => api.patch<SettingsData>('/settings/password-policy', p),
  updateTenantSettings: (p: UpdateTenantSettingsPayload)    => api.patch<SettingsData>('/settings/tenant-settings', p),
  clear: () => cache.clear(),
}
