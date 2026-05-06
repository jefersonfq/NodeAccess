import { Prisma, type PrismaClient } from '@prisma/client'
import { endStaleActiveSessions } from './session-liveness.js'

export interface SessionFilters {
  search?: string
  active?: boolean
  connectionMethod?: string
  hostState?: 'active' | 'deleted'
  hostId?: number
  periodDays?: number
  dateFrom?: Date
  dateTo?: Date
  hasError?: boolean
  originIp?: string
  page?:   number
  limit?:  number
}

export interface SessionRow {
  id: number
  userId: number
  hostId: number
  startedAt: Date
  endedAt: Date | null
  lastSeenAt: Date
  active: boolean
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
  user: { id: number; name: string; email: string }
  host: { id: number; name: string; ip: string; deleted: boolean; deletedAt: Date | null }
}

export class SessionsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(
    tenantId: number,
    filters: SessionFilters,
  ): Promise<{ sessions: SessionRow[]; total: number }> {
    const { search, active, connectionMethod, hostState, hostId, periodDays, dateFrom, dateTo, hasError, originIp, page = 1, limit = 20 } = filters
    const skip = (page - 1) * limit

    const whereParts: Prisma.Sql[] = [Prisma.sql`u.tenant_id = ${tenantId}`]
    if (active !== undefined) whereParts.push(Prisma.sql`s.active = ${active}`)
    if (connectionMethod) whereParts.push(Prisma.sql`s.connection_method = ${connectionMethod}`)
    if (hostState === 'active') whereParts.push(Prisma.sql`h.deleted_at IS NULL`)
    if (hostState === 'deleted') whereParts.push(Prisma.sql`h.deleted_at IS NOT NULL`)
    if (hostId) whereParts.push(Prisma.sql`s.host_id = ${hostId}`)
    if (hasError !== undefined) {
      whereParts.push(hasError
        ? Prisma.sql`(s.error_code IS NOT NULL OR s.ended_reason = 'error')`
        : Prisma.sql`(s.error_code IS NULL AND (s.ended_reason IS NULL OR s.ended_reason <> 'error'))`)
    }
    if (originIp) whereParts.push(Prisma.sql`(s.client_ip = ${originIp} OR s.agent_remote_ip = ${originIp})`)
    if (dateFrom) whereParts.push(Prisma.sql`s.started_at >= ${dateFrom}`)
    if (dateTo) whereParts.push(Prisma.sql`s.started_at < ${dateTo}`)
    if (periodDays) {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      from.setDate(from.getDate() - (periodDays - 1))
      whereParts.push(Prisma.sql`s.started_at >= ${from}`)
    }
    if (search) {
      const term = `%${search}%`
      whereParts.push(Prisma.sql`(u.name LIKE ${term} OR h.name LIKE ${term} OR h.ip LIKE ${term})`)
    }
    const whereSql = Prisma.sql`WHERE ${Prisma.join(whereParts, ' AND ')}`

    const [rows, countRows] = await this.db.$transaction([
      this.db.$queryRaw<Array<{
        id: number
        userId: number
        hostId: number
        startedAt: Date
        endedAt: Date | null
        lastSeenAt: Date
        active: boolean | number
        requestedConnectionMode: string | null
        connectionMethod: string | null
        agentId: number | null
        agentNameSnapshot: string | null
        agentSource: string | null
        clientIp: string | null
        userAgent: string | null
        agentRemoteIp: string | null
        endedReason: string | null
        errorCode: string | null
        errorMessage: string | null
        userName: string
        userEmail: string
        hostName: string
        hostIp: string
        hostDeletedAt: Date | null
      }>>(Prisma.sql`
        SELECT
          s.id,
          s.user_id AS userId,
          s.host_id AS hostId,
          s.started_at AS startedAt,
          s.ended_at AS endedAt,
          s.last_seen_at AS lastSeenAt,
          s.active,
          s.requested_connection_mode AS requestedConnectionMode,
          COALESCE(s.connection_method, 'direct') AS connectionMethod,
          s.agent_id AS agentId,
          s.agent_name_snapshot AS agentNameSnapshot,
          s.agent_source AS agentSource,
          s.client_ip AS clientIp,
          s.user_agent AS userAgent,
          s.agent_remote_ip AS agentRemoteIp,
          s.ended_reason AS endedReason,
          s.error_code AS errorCode,
          s.error_message AS errorMessage,
          u.name AS userName,
          u.email AS userEmail,
          h.name AS hostName,
          h.ip AS hostIp,
          h.deleted_at AS hostDeletedAt
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
        ORDER BY s.started_at DESC
        LIMIT ${limit}
        OFFSET ${skip}
      `),
      this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        ${whereSql}
      `),
    ])

    return {
      sessions: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        hostId: row.hostId,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        lastSeenAt: row.lastSeenAt,
        active: Boolean(row.active),
        requestedConnectionMode: row.requestedConnectionMode,
        connectionMethod: row.connectionMethod ?? 'direct',
        agentId: row.agentId,
        agentNameSnapshot: row.agentNameSnapshot,
        agentSource: row.agentSource,
        clientIp: row.clientIp,
        userAgent: row.userAgent,
        agentRemoteIp: row.agentRemoteIp,
        endedReason: row.endedReason,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        user: { id: row.userId, name: row.userName, email: row.userEmail },
        host: { id: row.hostId, name: row.hostName, ip: row.hostIp, deleted: row.hostDeletedAt !== null, deletedAt: row.hostDeletedAt },
      })),
      total: Number(countRows[0]?.total ?? 0),
    }
  }

  async endStaleActive(staleBefore: Date): Promise<number> {
    return endStaleActiveSessions(this.db, staleBefore)
  }

  /** Encerra TODAS as sessões ativas globalmente (usado no startup do gateway). */
  async endAllActive(): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { active: true },
      data:  { active: false, endedAt: new Date() },
    })
    return result.count
  }

  /** Encerra todas as sessões ativas de um tenant (cleanup manual pelo admin). */
  async endActiveSessions(tenantId: number): Promise<number> {
    const result = await this.db.session.updateMany({
      where: { active: true, user: { tenantId } },
      data:  { active: false, endedAt: new Date() },
    })
    return result.count
  }
}
