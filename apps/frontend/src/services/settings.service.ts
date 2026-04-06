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
    activeUsers:  number
    hasKey:       boolean
    multiConnect: boolean
    sessionAuditEnabled: boolean
    sessionAuditAiEnabled: boolean
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

const cache = createTimedPromiseCache<{ data: SettingsData }>(30_000)

export const settingsService = {
  get: () => cache.get(() => api.get<SettingsData>('/settings')),
  clear: () => cache.clear(),
}
