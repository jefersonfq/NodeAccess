import type { AxiosResponse } from 'axios'
import api from './api'
import type { UserPublic, UserListItem, CreateUserDto, UpdateUserDto, UserPreferences, PatchUserPreferencesDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

interface UserQuery { page?: number; limit?: number; search?: string; role?: string; active?: boolean; includeDeleted?: boolean; vaultManager?: boolean }

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
  list:           (params?: UserQuery): Promise<AxiosResponse<Paginated<UserListItem>>> => api.get<Paginated<UserListItem>>('/users', { params }),
  get:            (id: number): Promise<AxiosResponse<UserPublic>> => api.get<UserPublic>(`/users/${id}`),
  listInventoryAccess: (id: number): Promise<AxiosResponse<UserInventoryAccessEntry[]>> => api.get<UserInventoryAccessEntry[]>(`/users/${id}/inventory-access`),
  create:         (dto: CreateUserDto): Promise<AxiosResponse<UserPublic & { temporaryPassword?: string }>> => api.post<UserPublic & { temporaryPassword?: string }>('/users', dto),
  update:         (id: number, dto: UpdateUserDto): Promise<AxiosResponse<UserPublic>> => api.patch<UserPublic>(`/users/${id}`, dto),
  activate:       (id: number): Promise<AxiosResponse<UserPublic>> => api.patch<UserPublic>(`/users/${id}/activate`),
  deactivate:     (id: number): Promise<AxiosResponse<UserPublic>> => api.patch<UserPublic>(`/users/${id}/deactivate`),
  delete:         (id: number): Promise<AxiosResponse> => api.delete(`/users/${id}`),
  restore:        (id: number): Promise<AxiosResponse<UserPublic>> => api.post<UserPublic>(`/users/${id}/restore`),
  resetPassword:  (id: number): Promise<AxiosResponse<{ temporaryPassword: string }>> => api.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
  resetMfa:       (id: number): Promise<AxiosResponse<UserPublic>> => api.post<UserPublic>(`/users/${id}/reset-mfa`, {}),
  changePassword: (newPassword: string, currentPassword?: string): Promise<AxiosResponse> =>
    api.post('/users/me/change-password', {
      ...(currentPassword ? { currentPassword } : {}),
      newPassword,
    }),
  updateOwnAvatar: (file: File): Promise<AxiosResponse<UserPublic>> => {
    const form = new FormData()
    form.append('file', file)
    return api.post<UserPublic>('/users/me/avatar', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  removeOwnAvatar: (): Promise<AxiosResponse<UserPublic>> => api.delete<UserPublic>('/users/me/avatar'),
  getPreferences: (): Promise<{ data: UserPreferences | null }> => userPreferencesCache.get(() => api.get<UserPreferences | null>('/users/me/preferences')),
  updatePreferences: (dto: PatchUserPreferencesDto): Promise<AxiosResponse<UserPreferences>> => api.patch<UserPreferences>('/users/me/preferences', dto).then((res) => {
    userPreferencesCache.set({ data: res.data })
    return res
  }),
}
