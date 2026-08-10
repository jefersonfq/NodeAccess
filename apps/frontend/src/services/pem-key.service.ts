import api from './api'
import type { PemKeyPublic, CreatePemKeyDto, UpdatePemKeyPassphraseDto } from '@nodeaccess/shared'
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
  updatePassphrase: async (id: number, dto: UpdatePemKeyPassphraseDto) => {
    const res = await api.patch<PemKeyPublic>(`/pem-keys/${id}/passphrase`, dto)
    await pemKeyListCache.update((current) => current
      ? { data: current.data.map((item) => item.id === id ? res.data : item) }
      : current)
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
