import api from './api'
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
}

export interface UpdateLicenseSettingsPayload {
  maxHosts: number | null
  featureEntitlements: Record<string, boolean>
  integrationEntitlements: Record<string, boolean>
}

const cache = createTimedPromiseCache<{ data: SettingsData }>(30_000)

export const settingsService = {
  get: () => cache.get(() => api.get<SettingsData>('/settings')),
  updateLicense: (payload: UpdateLicenseSettingsPayload) => api.patch<SettingsData>('/settings/license', payload),
  clear: () => cache.clear(),
}
