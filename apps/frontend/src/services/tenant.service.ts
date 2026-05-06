import type { CreateTenantDto, CreateTenantResult, TenantPublic, UpdateTenantDto } from '@nodeaccess/shared'
import api from './api'

export const tenantService = {
  list: () => api.get<TenantPublic[]>('/platform/tenants'),
  create: (payload: CreateTenantDto) => api.post<CreateTenantResult>('/platform/tenants', payload),
  update: (id: number, payload: UpdateTenantDto) => api.patch<TenantPublic>(`/platform/tenants/${id}`, payload),
}
