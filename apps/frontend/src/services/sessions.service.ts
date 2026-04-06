import api from './api'
import type { Paginated } from '@nodeaccess/shared'

export interface SessionPublic {
  id:              number
  user:            { id: number; name: string; email: string }
  host:            { id: number; name: string; ip: string }
  startedAt:       string
  endedAt:         string | null
  durationSeconds: number | null
  active:          boolean
}

interface SessionQuery {
  page?:   number
  limit?:  number
  search?: string
  active?: boolean
}

export const sessionsService = {
  list:    (params?: SessionQuery) => api.get<Paginated<SessionPublic>>('/sessions', { params }),
  cleanup: ()                      => api.post<{ cleaned: number }>('/sessions/cleanup'),
}
