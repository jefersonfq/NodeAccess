import api from './api'

export interface PlatformAdminPublic {
  id: number
  tenantId: number
  tenantName: string
  tenantSlug: string
  name: string
  email: string
  active: boolean
  forcePasswordChange: boolean
  createdAt: string
  updatedAt: string
}

export interface CreatePlatformAdminPayload {
  name?: string
  email: string
  tenantId?: number
  tenantSlug?: string
  tenantName?: string
  resetPassword?: boolean
}

export interface PlatformAdminResult {
  admin: PlatformAdminPublic
  temporaryPassword?: string
}

export const platformAdminService = {
  list: () => api.get<PlatformAdminPublic[]>('/platform/superadmins'),
  create: (payload: CreatePlatformAdminPayload) => api.post<PlatformAdminResult>('/platform/superadmins', payload),
  promoteUser: (id: number, payload?: { resetPassword?: boolean }) =>
    api.post<PlatformAdminResult>(`/platform/superadmins/users/${id}/promote`, payload ?? {}),
  resetPassword: (id: number) => api.post<PlatformAdminResult>(`/platform/superadmins/${id}/reset-password`),
  revoke: (id: number) => api.delete(`/platform/superadmins/${id}`),
}
