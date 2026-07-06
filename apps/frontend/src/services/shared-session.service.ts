import api from './api'
import type {
  CreateSharedSessionDto,
  DenySharedSessionControlDto,
  GrantSharedSessionControlDto,
  RequestSharedSessionControlDto,
  RevokeSharedSessionControlDto,
  SharedSessionControlActionResult,
  SharedSessionCreated,
  SharedSessionPublic,
  SharedSessionResolved,
} from '@nodeaccess/shared'

export interface SharedSessionListItem {
  id: number
  hostId: number
  hostName: string
  hostDeleted: boolean
  sessionId: number
  status: 'active' | 'ended' | 'revoked'
  expiresAt: string
  createdAt: string
  owner: {
    userId: number
    name: string
    email: string | null
  }
  activeParticipants: number
  activeControlLease: SharedSessionPublic['activeControlLease'] | null
  url: string | null
}

export const sharedSessionService = {
  list: () =>
    api.get<SharedSessionListItem[]>('/shared-sessions'),

  create: (dto: CreateSharedSessionDto) =>
    api.post<SharedSessionCreated>('/shared-sessions', dto),

  getById: (id: number) =>
    api.get<SharedSessionPublic>(`/shared-sessions/${id}`),

  resolve: (token: string) =>
    api.post<SharedSessionResolved>(`/shared-sessions/${token}/resolve`),

  requestControl: (id: number, dto: RequestSharedSessionControlDto = {}) =>
    api.post<SharedSessionControlActionResult>(`/shared-sessions/${id}/control/request`, dto),

  grantControl: (id: number, userId: number, dto: GrantSharedSessionControlDto) =>
    api.post<SharedSessionControlActionResult>(`/shared-sessions/${id}/control/grant/${userId}`, dto),

  denyControl: (id: number, userId: number, dto: DenySharedSessionControlDto = {}) =>
    api.post<SharedSessionControlActionResult>(`/shared-sessions/${id}/control/deny/${userId}`, dto),

  revokeControl: (id: number, dto: RevokeSharedSessionControlDto = {}) =>
    api.post<SharedSessionControlActionResult>(`/shared-sessions/${id}/control/revoke`, dto),

  revoke: (id: number) =>
    api.delete(`/shared-sessions/${id}`),
}
