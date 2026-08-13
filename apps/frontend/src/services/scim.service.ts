import api from './api'

export interface ScimConfigPublic {
  enabled: boolean
  tokenConfigured: boolean
  tokenPrefix: string | null
  rotatedAt: string | null
}

export const scimService = {
  getConfig: () => api.get<ScimConfigPublic>('/integrations/scim/config'),
  setEnabled: (enabled: boolean) => api.put<ScimConfigPublic>('/integrations/scim/config', { enabled }),
  rotateToken: () => api.post<{ token: string; enabled: false; tokenPrefix: string; rotatedAt: string }>('/integrations/scim/config/rotate-token'),
}
