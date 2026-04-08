import api from './api'
import type { CreateSecretDto, RotateSecretDto, SecretPublic, UpdateSecretDto } from '@nodeaccess/shared'

export const secretService = {
  list: (includeRevoked = false) =>
    api.get<SecretPublic[]>('/secrets', { params: { includeRevoked: includeRevoked ? 'true' : 'false' } }),
  create: (dto: CreateSecretDto) =>
    api.post<SecretPublic>('/secrets', dto),
  update: (id: number, dto: UpdateSecretDto) =>
    api.patch<SecretPublic>(`/secrets/${id}`, dto),
  rotate: (id: number, dto: RotateSecretDto) =>
    api.post<SecretPublic>(`/secrets/${id}/rotate`, dto),
  revoke: (id: number) =>
    api.post<SecretPublic>(`/secrets/${id}/revoke`),
  remove: (id: number) =>
    api.delete(`/secrets/${id}`),
}
