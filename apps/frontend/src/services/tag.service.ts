import api from './api'
import type { TagPublic } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

const tagListCache = createTimedPromiseCache<{ data: TagPublic[] }>(cacheTtls.tagsList, { name: 'tags:list' })

export const tagService = {
  list: () => tagListCache.get(() => api.get<TagPublic[]>('/tags')),
  create: async (name: string) => {
    const res = await api.post<TagPublic>('/tags', { name })
    await tagListCache.update((current) => current
      ? { data: [...current.data.filter((item) => item.id !== res.data.id), res.data].sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  delete: async (id: number) => {
    const res = await api.delete(`/tags/${id}`)
    await tagListCache.update((current) => current
      ? { data: current.data.filter((item) => item.id !== id) }
      : current)
    return res
  },
  set: (tags: TagPublic[]) => tagListCache.set({ data: tags }),
  clear: () => tagListCache.clear(),
}
