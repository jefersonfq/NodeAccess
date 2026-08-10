import type { BreakGlassStatus, TenantAuthPolicyDto, TenantAuthPolicyPublic, ValidateBreakGlassDto } from '@nodeaccess/shared'
import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

const cache = createTimedPromiseCache<{ data: TenantAuthPolicyPublic }>(cacheTtls.tenantAuthPolicy, { name: 'tenant:auth-policy' })

export const tenantAuthPolicyService = {
  get: () => cache.get(() => api.get<TenantAuthPolicyPublic>('/tenant-auth-policy')),
  update: (dto: TenantAuthPolicyDto) => api.put<TenantAuthPolicyPublic>('/tenant-auth-policy', dto).then((response) => {
    cache.clear()
    return response
  }),
  getBreakGlass: () => api.get<BreakGlassStatus>('/tenant-auth-policy/break-glass'),
  validateBreakGlass: (dto: ValidateBreakGlassDto) => api.post<BreakGlassStatus>('/tenant-auth-policy/break-glass/validate', dto),
  clear: () => cache.clear(),
}
