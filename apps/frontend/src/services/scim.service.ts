import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface ScimConfigPublic {
  enabled: boolean
  tokenConfigured: boolean
  tokenPrefix: string | null
  rotatedAt: string | null
}

const scimConfigCache = createTimedPromiseCache<{ data: ScimConfigPublic }>(cacheTtls.scimConfig, { name: 'integrations:scim' })

export const scimService = {
  getConfig: () => scimConfigCache.get(() => api.get<ScimConfigPublic>('/integrations/scim/config')),
  setEnabled: (enabled: boolean) => api.put<ScimConfigPublic>('/integrations/scim/config', { enabled }).then((response) => {
    scimConfigCache.set(response, 'scim:update')
    return response
  }),
  rotateToken: () => api.post<{ token: string; enabled: false; tokenPrefix: string; rotatedAt: string }>('/integrations/scim/config/rotate-token').then((response) => {
    scimConfigCache.clear('scim:token-rotation')
    return response
  }),
}
