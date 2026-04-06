import api from './api'
import type { CreateHostLinkDto, HostLinkCreated, HostLinkResolved } from '@nodeaccess/shared'

export const hostLinkService = {
  create: (dto: CreateHostLinkDto) =>
    api.post<HostLinkCreated>('/host-links', dto),

  resolve: (token: string) =>
    api.get<HostLinkResolved>(`/host-links/${token}/resolve`),

  revoke: (id: number) =>
    api.delete(`/host-links/${id}`),
}
