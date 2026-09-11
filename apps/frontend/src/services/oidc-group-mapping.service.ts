import type { CreateOidcGroupMappingDto, OidcGroupMappingPublic } from '@nodeaccess/shared'
import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

const mappingCache = createTimedPromiseCache<{ data: OidcGroupMappingPublic[] }>(cacheTtls.oidcGroupMappings, { name: 'integrations:oidc-group-mappings' })

export const oidcGroupMappingService = {
  list: () => mappingCache.get(() => api.get<OidcGroupMappingPublic[]>('/integrations/oidc/group-mappings')),
  create: (dto: CreateOidcGroupMappingDto) => api.post<OidcGroupMappingPublic>('/integrations/oidc/group-mappings', dto).then((response) => {
    mappingCache.clear('oidc-group-mapping:create')
    return response
  }),
  delete: (id: number) => api.delete(`/integrations/oidc/group-mappings/${id}`).then((response) => {
    mappingCache.clear('oidc-group-mapping:delete')
    return response
  }),
}
