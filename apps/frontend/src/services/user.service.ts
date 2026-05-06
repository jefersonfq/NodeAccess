import api from './api'
import type { UserPublic, CreateUserDto, UpdateUserDto, UserPreferences, PatchUserPreferencesDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

interface UserQuery { page?: number; limit?: number; search?: string; role?: string; active?: boolean }

const userPreferencesCache = createTimedPromiseCache<{ data: UserPreferences | null }>(cacheTtls.userPreferences, { name: 'users:me:preferences' })

export const userService = {
  list:           (params?: UserQuery) => api.get<Paginated<UserPublic>>('/users', { params }),
  get:            (id: number)         => api.get<UserPublic>(`/users/${id}`),
  create:         (dto: CreateUserDto) => api.post<UserPublic & { temporaryPassword: string }>('/users', dto),
  update:         (id: number, dto: UpdateUserDto) => api.patch<UserPublic>(`/users/${id}`, dto),
  activate:       (id: number) => api.patch<UserPublic>(`/users/${id}/activate`),
  deactivate:     (id: number) => api.patch<UserPublic>(`/users/${id}/deactivate`),
  resetPassword:  (id: number) => api.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/users/me/change-password', { currentPassword, newPassword }),
  getPreferences: () => userPreferencesCache.get(() => api.get<UserPreferences | null>('/users/me/preferences')),
  updatePreferences: (dto: PatchUserPreferencesDto) => api.patch<UserPreferences>('/users/me/preferences', dto).then((res) => {
    userPreferencesCache.set({ data: res.data })
    return res
  }),
}
