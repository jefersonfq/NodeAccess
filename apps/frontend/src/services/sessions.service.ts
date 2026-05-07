import api from './api'
import type { Paginated } from '@nodeaccess/shared'
import { createTimedPromiseCache } from './service-cache'

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
  accessType: string
  jitLinkId: number | null
  jitGuestName: string | null
  agentRemoteIp: string | null
  endedReason: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface AccessMapSession {
  id: number
  user: { id: number; name: string; email: string }
  startedAt: string
  lastSeenAt: string
  durationSeconds: number
  connectionMethod: string
  accessType: string
  clientIp: string | null
  agentRemoteIp: string | null
  agentNameSnapshot: string | null
}

export interface AccessMapHost {
  host: {
    id: number
    name: string
    ip: string
    port: number
    accessProtocol: string
    scope: string
    groupName: string | null
  }
  activeSessions: number
  uniqueUsers: number
  oldestStartedAt: string
  lastStartedAt: string
  lastSeenAt: string
  sessions: AccessMapSession[]
}

export interface AccessMapOverview {
  generatedAt: string
  refreshAfterSeconds: number
  totals: {
    activeSessions: number
    activeHosts: number
    uniqueUsers: number
    concurrentHosts: number
  }
  hosts: AccessMapHost[]
}

const accessMapCache = createTimedPromiseCache<{ data: AccessMapOverview }>(1000, { name: 'sessions:access-map' })

export interface CloseSessionResult {
  closed: boolean
  reason: 'closed' | 'not_found' | 'not_active' | 'not_in_runtime'
  connectionMethod: string | null
}

interface SessionQuery {
  page?:   number
  limit?:  number
  search?: string
  active?: boolean
  connectionMethod?: string
  accessType?: 'authenticated' | 'jit_public_link'
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
  accessMap: ()                    => accessMapCache.get(() => api.get<AccessMapOverview>('/sessions/access-map')),
  clearAccessMapCache: (reason?: string) => accessMapCache.clear(reason),
  close: async (sessionId: number) => {
    const result = await api.post<CloseSessionResult>(`/sessions/${sessionId}/close`)
    accessMapCache.clear('session-close')
    return result
  },
}
