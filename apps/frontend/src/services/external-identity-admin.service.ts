import api from './api'

export interface ExternalIdentityAdminItem {
  id: number
  user: { id: number; name: string; email: string }
  providerKey: string
  issuer: string
  emailAtLink: string | null
  active: boolean
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export const externalIdentityAdminService = {
  list: () => api.get<ExternalIdentityAdminItem[]>('/integrations/oidc/identities'),
  revoke: (id: number) => api.post<{ changed: boolean }>(`/integrations/oidc/identities/${id}/revoke`),
}
