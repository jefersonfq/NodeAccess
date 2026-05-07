import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface Features {
  multiConnect: boolean
  maxHosts: number | null
  sessionAuditLicensed: boolean
  sessionAuditAiLicensed: boolean
  agentsLicensed: boolean
  secretsLicensed: boolean
  snippetsLicensed: boolean
  portForwardingLicensed: boolean
  integrationsLicensed: boolean
  feedbackLicensed: boolean
  localAiLicensed: boolean
  mcpLicensed: boolean
  aiSshActionsLicensed: boolean
  integrationProviders: Record<string, boolean>
  sharedSessions: {
    expiryMinutes: number[]
    maxExpiryMinutes: number
  }
}

const cache = createTimedPromiseCache<Features>(cacheTtls.features, { name: 'features' })

export const featuresService = {
  /** Cache curto de features do tenant para reduzir fetch redundante entre telas. */
  get(): Promise<Features> {
    return cache.get(() => api.get<Features>('/features').then((r) => r.data))
  },
  clear() { cache.clear() },
}
