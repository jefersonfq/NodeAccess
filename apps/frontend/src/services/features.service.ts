import api from './api'
import { createTimedPromiseCache } from './service-cache'

export interface Features {
  multiConnect: boolean
  sessionAuditLicensed: boolean
  sessionAuditAiLicensed: boolean
}

const cache = createTimedPromiseCache<Features>(30_000)

export const featuresService = {
  /** Cache curto de features do tenant para reduzir fetch redundante entre telas. */
  get(): Promise<Features> {
    return cache.get(() => api.get<Features>('/features').then((r) => r.data))
  },
  clear() { cache.clear() },
}
