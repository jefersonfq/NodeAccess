import api from './api'
import type { BastionPublic, CreateBastionDto, UpdateBastionDto } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

const bastionListCache = createTimedPromiseCache<{ data: BastionPublic[] }>(cacheTtls.bastionsList, { name: 'bastions:list' })

export const bastionService = {
  list:   ()                            => bastionListCache.get(() => api.get<BastionPublic[]>('/bastions')),
  get:    (id: number)                  => api.get<BastionPublic>(`/bastions/${id}`),
  create: async (dto: CreateBastionDto) => {
    const res = await api.post<BastionPublic>('/bastions', dto)
    await bastionListCache.update((current) => current
      ? { data: [...current.data, res.data].sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  update: async (id: number, dto: UpdateBastionDto) => {
    const res = await api.patch<BastionPublic>(`/bastions/${id}`, dto)
    await bastionListCache.update((current) => current
      ? { data: current.data.map((item) => item.id === id ? res.data : item).sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  delete: async (id: number) => {
    const res = await api.delete(`/bastions/${id}`)
    await bastionListCache.update((current) => current
      ? { data: current.data.filter((item) => item.id !== id) }
      : current)
    return res
  },
  clear: () => bastionListCache.clear(),
}
