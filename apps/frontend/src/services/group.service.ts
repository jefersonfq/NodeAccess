import api from './api'
import type { GroupPublic, CreateGroupDto, UpdateGroupDto, Paginated } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

interface GroupQuery {
  page?: number
  limit?: number
  search?: string
}

const groupListCache = createTimedPromiseCache<{ data: GroupPublic[] }>(cacheTtls.groupsList, { name: 'groups:list' })

export const groupService = {
  list:   ()                          => groupListCache.get(() => api.get<GroupPublic[]>('/groups')),
  listPaginated: (params?: GroupQuery) => api.get<Paginated<GroupPublic>>('/groups/paginated', { params }),
  get:    (id: number)                => api.get<GroupPublic>(`/groups/${id}`),
  create: async (dto: CreateGroupDto) => {
    const res = await api.post<GroupPublic>('/groups', dto)
    await groupListCache.update((current) => current
      ? { data: [...current.data, res.data].sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  update: async (id: number, dto: UpdateGroupDto) => {
    const res = await api.patch<GroupPublic>(`/groups/${id}`, dto)
    await groupListCache.update((current) => current
      ? { data: current.data.map((item) => item.id === id ? res.data : item).sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  delete: async (id: number) => {
    const res = await api.delete(`/groups/${id}`)
    await groupListCache.update((current) => current
      ? { data: current.data.filter((item) => item.id !== id) }
      : current)
    return res
  },
  clear: () => groupListCache.clear(),
}
