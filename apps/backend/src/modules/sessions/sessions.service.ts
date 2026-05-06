import type { Paginated } from '@nodeaccess/shared'
import type { SessionsRepository, SessionFilters } from './sessions.repository.js'
import { getSessionStaleBefore } from './session-liveness.js'

export interface SessionPublic {
  id:              number
  user:            { id: number; name: string; email: string }
  host:            { id: number; name: string; ip: string; deleted: boolean; deletedAt: Date | null }
  startedAt:       Date
  endedAt:         Date | null
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

function toPublic(row: Awaited<ReturnType<SessionsRepository['findAll']>>['sessions'][number]): SessionPublic {
  const durationSeconds =
    row.endedAt
      ? Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)
      : null

  return {
    id:              row.id,
    user:            row.user,
    host:            row.host,
    startedAt:       row.startedAt,
    endedAt:         row.endedAt,
    durationSeconds,
    active:          row.active,
    requestedConnectionMode: row.requestedConnectionMode,
    connectionMethod: row.connectionMethod,
    agentId: row.agentId,
    agentNameSnapshot: row.agentNameSnapshot,
    agentSource: row.agentSource,
    clientIp: row.clientIp,
    userAgent: row.userAgent,
    agentRemoteIp: row.agentRemoteIp,
    endedReason: row.endedReason,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  }
}

export class SessionsService {
  constructor(private readonly repo: SessionsRepository) {}

  async list(tenantId: number, filters: SessionFilters): Promise<Paginated<SessionPublic>> {
    await this.cleanupStaleActive()
    const page  = filters.page  ?? 1
    const limit = filters.limit ?? 20
    const { sessions, total } = await this.repo.findAll(tenantId, filters)
    return { data: sessions.map(toPublic), total, page, limit }
  }

  /** Encerra todas as sessões ativas globalmente (startup do gateway). */
  async cleanupAllGhosts(): Promise<number> {
    return this.repo.endAllActive()
  }

  async cleanupStaleActive(): Promise<number> {
    return this.repo.endStaleActive(getSessionStaleBefore())
  }

  /** Encerra todas as sessões ativas do tenant (cleanup manual via API). */
  async cleanupGhosts(tenantId: number): Promise<{ cleaned: number }> {
    const cleaned = await this.repo.endActiveSessions(tenantId)
    return { cleaned }
  }
}
