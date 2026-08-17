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
  terminalAutocompleteLicensed: boolean
  terminalAiLicensed: boolean
  mcpLicensed: boolean
  mcpEnvironmentEnabled: boolean
  mcpOperational: boolean
  aiSshActionsLicensed: boolean
  integrationProviders: Record<string, boolean>
  sharedSessions: {
    expiryMinutes: number[]
    maxExpiryMinutes: number
  }
}

const cache = createTimedPromiseCache<Features>(cacheTtls.features, { name: 'features' })
export const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'

export const featuresService = {
  /** Cache curto de features do tenant para reduzir fetch redundante entre telas. */
  get(): Promise<Features> {
    return cache.get(() => api.get<Features>('/features').then((r) => r.data))
  },
  clear() { cache.clear() },
  /** Invalida o snapshot e notifica todos os consumidores reativos desta SPA. */
  notifyUpdated() {
    cache.clear()
    window.dispatchEvent(new Event(FEATURES_UPDATED_EVENT))
  },
}
