import api from './api'
import type { PemKeyPublic, CreatePemKeyDto } from '@nodeaccess/shared'
import { cacheTtls } from './cache-ttl.service'
import { createTimedPromiseCache } from './service-cache'

const pemKeyListCache = createTimedPromiseCache<{ data: PemKeyPublic[] }>(cacheTtls.pemKeysList, { name: 'pem-keys:list' })

export const pemKeyService = {
  list:   ()                      => pemKeyListCache.get(() => api.get<PemKeyPublic[]>('/pem-keys')),
  create: async (dto: CreatePemKeyDto) => {
    const res = await api.post<PemKeyPublic>('/pem-keys', dto)
    await pemKeyListCache.update((current) => current
      ? { data: [...current.data, res.data].sort((a, b) => a.name.localeCompare(b.name)) }
      : { data: [res.data] })
    return res
  },
  delete: async (id: number) => {
    const res = await api.delete(`/pem-keys/${id}`)
    await pemKeyListCache.update((current) => current
      ? { data: current.data.filter((item) => item.id !== id) }
      : current)
    return res
  },
  clear: () => pemKeyListCache.clear(),
}
