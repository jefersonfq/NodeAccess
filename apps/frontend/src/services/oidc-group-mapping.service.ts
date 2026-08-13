import type { CreateOidcGroupMappingDto, OidcGroupMappingPublic } from '@nodeaccess/shared'
import api from './api'

export const oidcGroupMappingService = {
  list: () => api.get<OidcGroupMappingPublic[]>('/integrations/oidc/group-mappings'),
  create: (dto: CreateOidcGroupMappingDto) => api.post<OidcGroupMappingPublic>('/integrations/oidc/group-mappings', dto),
  delete: (id: number) => api.delete(`/integrations/oidc/group-mappings/${id}`),
}
