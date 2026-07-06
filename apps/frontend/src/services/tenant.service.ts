import type { CreateTenantAdminResult, CreateTenantDto, TenantAdminBootstrapDto, CreateTenantResult, TenantDashboardSummary, TenantPublic, UpdateTenantDto } from '@nodeaccess/shared'
import api from './api'

export const tenantService = {
  list: () => api.get<TenantPublic[]>('/platform/tenants'),
  dashboard: () => api.get<TenantDashboardSummary>('/platform/tenants/dashboard'),
  create: (payload: CreateTenantDto) => api.post<CreateTenantResult>('/platform/tenants', payload),
  createAdmin: (tenantId: number, payload: TenantAdminBootstrapDto) =>
    api.post<CreateTenantAdminResult>(`/platform/tenants/${tenantId}/admins`, payload),
  update: (id: number, payload: UpdateTenantDto) => api.patch<TenantPublic>(`/platform/tenants/${id}`, payload),
  delete: (id: number) => api.delete(`/platform/tenants/${id}`),
}
