import api from './api'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

export interface FolderPublic {
  id:        number
  name:      string
  userId:    number
  tenantId:  number
  createdAt: string
}

const folderListCache = createTimedPromiseCache<{ data: FolderPublic[] }>(cacheTtls.foldersList, { name: 'folders:list' })

export const folderService = {
  list:   ()                         => folderListCache.get(() => api.get<FolderPublic[]>('/folders')),
  create: async (name: string) => {
    const res = await api.post<FolderPublic>('/folders', { name })
    await folderListCache.update((current) => current
      ? { data: [...current.data, res.data].sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  update: async (id: number, name: string) => {
    const res = await api.patch<FolderPublic>(`/folders/${id}`, { name })
    await folderListCache.update((current) => current
      ? { data: current.data.map((item) => item.id === id ? res.data : item).sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  delete: async (id: number) => {
    const res = await api.delete(`/folders/${id}`)
    await folderListCache.update((current) => current
      ? { data: current.data.filter((item) => item.id !== id) }
      : current)
    return res
  },
  clear: () => folderListCache.clear(),
}
