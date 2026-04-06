import api from './api'
import type { AuthLogPublic, AdminLogPublic, ClientUxEvent } from '@nodeaccess/shared'
import type { Paginated } from '@nodeaccess/shared'

export const logsService = {
  listAuth(params: { eventType?: string; success?: boolean; search?: string; page?: number; limit?: number }) {
    return api.get<Paginated<AuthLogPublic>>('/logs/auth', { params })
  },
  listAdmin(params: { search?: string; targetType?: string; page?: number; limit?: number }) {
    return api.get<Paginated<AdminLogPublic>>('/logs/admin', { params })
  },
  recordClientUx(events: ClientUxEvent[]) {
    return api.post('/logs/client-ux', { events })
  },
}
