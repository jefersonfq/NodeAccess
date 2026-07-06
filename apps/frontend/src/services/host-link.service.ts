import api from './api'
import type { CreateHostLinkDto, HostLinkCreated, HostLinkPublicInfo, HostLinkPublicResolved, HostLinkResolved } from '@nodeaccess/shared'

export interface HostLinkOptions {
  jitAccess: {
    enabled: boolean
    expiryMinutes: number[]
    maxExpiryMinutes: number
    pinRequired: boolean
  }
}

export interface HostLinkListItem {
  id: number
  hostId: number
  hostName?: string
  hostIp?: string
  type: 'authenticated' | 'public_once'
  expiresAt: string
  lastOpenedAt: string | null
  revokedAt: string | null
  createdAt: string
  createdBy: { id: number; name: string; email: string }
  activeSessions: number
  status: 'active' | 'used' | 'expired' | 'revoked'
  pinRequired: boolean
  pin: string | null
  url: string | null
}

export const hostLinkService = {
  options: () =>
    api.get<HostLinkOptions>('/host-links/options'),

  list: (hostId: number) =>
    api.get<HostLinkListItem[]>('/host-links', { params: { hostId } }),

  listTemporary: () =>
    api.get<HostLinkListItem[]>('/host-links'),

  create: (dto: CreateHostLinkDto) =>
    api.post<HostLinkCreated>('/host-links', dto),

  resolve: (token: string) =>
    api.get<HostLinkResolved>(`/host-links/${token}/resolve`),

  publicInfo: (token: string) =>
    api.get<HostLinkPublicInfo>(`/host-links/${token}/public-info`),

  resolvePublic: (token: string, guestName: string, pin?: string) =>
    api.post<HostLinkPublicResolved>(`/host-links/${token}/public-resolve`, { guestName, pin }),

  revoke: (id: number) =>
    api.delete(`/host-links/${id}`),
}
