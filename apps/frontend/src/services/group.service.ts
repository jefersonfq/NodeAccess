import api from './api'
import type { GroupPublic, CreateGroupDto, UpdateGroupDto } from '@nodeaccess/shared'

export const groupService = {
  list:   ()                          => api.get<GroupPublic[]>('/groups'),
  get:    (id: number)                => api.get<GroupPublic>(`/groups/${id}`),
  create: (dto: CreateGroupDto)       => api.post<GroupPublic>('/groups', dto),
  update: (id: number, dto: UpdateGroupDto) => api.patch<GroupPublic>(`/groups/${id}`, dto),
  delete: (id: number)                => api.delete(`/groups/${id}`),
}
