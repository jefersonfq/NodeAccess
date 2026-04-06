import api from './api'
import type { PemKeyPublic, CreatePemKeyDto } from '@nodeaccess/shared'

export const pemKeyService = {
  list:   ()                      => api.get<PemKeyPublic[]>('/pem-keys'),
  create: (dto: CreatePemKeyDto)  => api.post<PemKeyPublic>('/pem-keys', dto),
  delete: (id: number)            => api.delete(`/pem-keys/${id}`),
}
