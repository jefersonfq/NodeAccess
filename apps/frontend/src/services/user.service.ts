import api from './api'
import type { UserPublic, CreateUserDto, UpdateUserDto, UserPreferences, PatchUserPreferencesDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

interface UserQuery { page?: number; limit?: number; search?: string; role?: string; active?: boolean; includeDeleted?: boolean }

export interface UserInventoryAccessEntry {
  aclEntryId: number
  inventoryNodeId: number
  inventoryNodeName: string
  inventoryNodeType: 'ROOT' | 'FOLDER' | 'HOST'
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: number
  principalName: string
  permissions: {
    view: boolean
    connect: boolean
    edit: boolean
    admin: boolean
  }
  inheritToChildren: boolean
  hostCount: number
  updatedAt: string
}

const userPreferencesCache = createTimedPromiseCache<{ data: UserPreferences | null }>(cacheTtls.userPreferences, { name: 'users:me:preferences' })

export const userService = {
  list:           (params?: UserQuery) => api.get<Paginated<UserPublic>>('/users', { params }),
  get:            (id: number)         => api.get<UserPublic>(`/users/${id}`),
  listInventoryAccess: (id: number)    => api.get<UserInventoryAccessEntry[]>(`/users/${id}/inventory-access`),
  create:         (dto: CreateUserDto) => api.post<UserPublic & { temporaryPassword?: string }>('/users', dto),
  update:         (id: number, dto: UpdateUserDto) => api.patch<UserPublic>(`/users/${id}`, dto),
  activate:       (id: number) => api.patch<UserPublic>(`/users/${id}/activate`),
  deactivate:     (id: number) => api.patch<UserPublic>(`/users/${id}/deactivate`),
  delete:         (id: number) => api.delete(`/users/${id}`),
  restore:        (id: number) => api.post<UserPublic>(`/users/${id}/restore`),
  resetPassword:  (id: number) => api.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
  resetMfa:       (id: number) => api.post<UserPublic>(`/users/${id}/reset-mfa`, {}),
  changePassword: (newPassword: string, currentPassword?: string) =>
    api.post('/users/me/change-password', {
      ...(currentPassword ? { currentPassword } : {}),
      newPassword,
    }),
  updateOwnAvatar: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<UserPublic>('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  removeOwnAvatar: () => api.delete<UserPublic>('/users/me/avatar'),
  getPreferences: () => userPreferencesCache.get(() => api.get<UserPreferences | null>('/users/me/preferences')),
  updatePreferences: (dto: PatchUserPreferencesDto) => api.patch<UserPreferences>('/users/me/preferences', dto).then((res) => {
    userPreferencesCache.set({ data: res.data })
    return res
  }),
}
