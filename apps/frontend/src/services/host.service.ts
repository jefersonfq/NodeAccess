import api from './api'
import type { HostPublic, CreateHostDto, HostKeyTrustEvent, TestConnectionDto, TestConnectionResult, TrustHostKeyDto } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'

interface HostQuery { page?: number; limit?: number; search?: string; scope?: string }
type UpdateHostDto = Omit<Partial<CreateHostDto>, 'folderId' | 'bastionId' | 'pemKeyId' | 'onePasswordRef'> & {
  folderId?: number | null
  bastionId?: number | null
  pemKeyId?: number | null
  onePasswordRef?: string | null
}

export const hostService = {
  list:           (params?: HostQuery) => api.get<Paginated<HostPublic>>('/hosts', { params }),
  get:            (id: number)         => api.get<HostPublic>(`/hosts/${id}`),
  create:         (dto: CreateHostDto) => api.post<HostPublic>('/hosts', dto),
  update:         (id: number, dto: UpdateHostDto) => api.patch<HostPublic>(`/hosts/${id}`, dto),
  delete:         (id: number)         => api.delete(`/hosts/${id}`),
  testConnection: (dto: TestConnectionDto) => api.post<TestConnectionResult>('/hosts/test-connection', dto),
  trustHostKey:   (id: number, dto: TrustHostKeyDto) => api.post<HostPublic>(`/hosts/${id}/trust-host-key`, dto),
  listHostKeyHistory: (id: number) => api.get<HostKeyTrustEvent[]>(`/hosts/${id}/host-key-history`),
}
