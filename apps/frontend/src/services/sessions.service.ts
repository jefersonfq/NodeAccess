import api from './api'
import type { Paginated } from '@nodeaccess/shared'

export interface SessionPublic {
  id:              number
  user:            { id: number; name: string; email: string }
  host:            { id: number; name: string; ip: string; deleted: boolean; deletedAt: string | null }
  startedAt:       string
  endedAt:         string | null
  durationSeconds: number | null
  active:          boolean
  requestedConnectionMode: string | null
  connectionMethod: string
  agentId: number | null
  agentNameSnapshot: string | null
  agentSource: string | null
  clientIp: string | null
  userAgent: string | null
  agentRemoteIp: string | null
  endedReason: string | null
  errorCode: string | null
  errorMessage: string | null
}

interface SessionQuery {
  page?:   number
  limit?:  number
  search?: string
  active?: boolean
  connectionMethod?: 'direct' | 'user_agent' | 'tenant_agent'
  hostState?: 'active' | 'deleted'
  hostId?: number
  periodDays?: number
  dateFrom?: string
  dateTo?: string
  hasError?: boolean
  originIp?: string
}

export const sessionsService = {
  list:    (params?: SessionQuery) => api.get<Paginated<SessionPublic>>('/sessions', { params }),
  cleanup: ()                      => api.post<{ cleaned: number }>('/sessions/cleanup'),
}
