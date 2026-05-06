import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'

interface SessionAuditStartInput {
  sessionId: number
  tenantId: number
  userId: number
  userNameSnapshot: string
  userEmailSnapshot?: string | null
  hostId: number
  hostNameSnapshot: string
  hostIpSnapshot: string
  connectionMethod: string
  ticketProvider?: string | null
  ticketKey?: string | null
  ticketUrl?: string | null
  startedAt: Date
}

interface SessionAuditEndInput {
  sessionId: number
  status: 'COMPLETED' | 'FAILED'
  endedAt: Date
}

interface SessionAuditChunkInput {
  sessionId: number
  seq: number
  startedAt: Date
  endedAt: Date
  eventCount: number
  storageKey: string
  compression: string
  compressedSize: number
  rawSize: number
  bytesInDelta: number
  bytesOutDelta: number
}

export interface SessionAuditListFilters {
  search?: string
  ticketKey?: string
  status?: string
  aiState?: 'with-ai' | 'without-ai'
  aiRiskLevel?: string
  hostState?: 'active' | 'deleted'
  hostId?: number
  periodDays?: number
  page?: number
  limit?: number
}

export interface SessionAuditRow {
  sessionId: number
  tenantId: number
  userId: number
  userNameSnapshot: string
  userEmailSnapshot: string | null
  hostId: number
  hostNameSnapshot: string
  hostIpSnapshot: string
  hostDeleted: boolean | number
  hostDeletedAt: Date | null
  connectionMethod: string
  clientIp: string | null
  userAgent: string | null
  agentRemoteIp: string | null
  ticketProvider: string | null
  ticketKey: string | null
  ticketUrl: string | null
  startedAt: Date
  endedAt: Date | null
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PURGED'
  chunkCount: number
  bytesIn: bigint | number
  bytesOut: bigint | number
  aiSummaryStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  aiSummaryText: string | null
  aiSummaryJson: string | null
  aiRiskLevel: string | null
}

export interface SessionAuditChunkRow {
  seq: number
  storageKey: string
}

interface SessionAuditLinkTicketInput {
  tenantId: number
  sessionId: number
  ticketProvider: string
  ticketKey: string
  ticketUrl: string | null
}

export class SessionAuditRepository {
  private warnedMissingTable = false

  constructor(private readonly db: PrismaClient) {}

  async start(input: SessionAuditStartInput): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        INSERT INTO session_audits (
          session_id,
          tenant_id,
          user_id,
          user_name_snapshot,
          user_email_snapshot,
          host_id,
          host_name_snapshot,
          host_ip_snapshot,
          connection_method,
          ticket_provider,
          ticket_key,
          ticket_url,
          started_at,
          status,
          audit_enabled,
          storage_driver,
          chunk_count,
          bytes_in,
          bytes_out,
          ai_summary_status,
          created_at,
          updated_at
        ) VALUES (
          ${input.sessionId},
          ${input.tenantId},
          ${input.userId},
          ${input.userNameSnapshot},
          ${input.userEmailSnapshot ?? null},
          ${input.hostId},
          ${input.hostNameSnapshot},
          ${input.hostIpSnapshot},
          ${input.connectionMethod},
          ${input.ticketProvider ?? null},
          ${input.ticketKey ?? null},
          ${input.ticketUrl ?? null},
          ${input.startedAt},
          ${'RUNNING'},
          ${true},
          ${'local'},
          ${0},
          ${0},
          ${0},
          ${'PENDING'},
          NOW(),
          NOW()
        )
        ON DUPLICATE KEY UPDATE
          tenant_id = VALUES(tenant_id),
          user_id = VALUES(user_id),
          user_name_snapshot = VALUES(user_name_snapshot),
          user_email_snapshot = VALUES(user_email_snapshot),
          host_id = VALUES(host_id),
          host_name_snapshot = VALUES(host_name_snapshot),
          host_ip_snapshot = VALUES(host_ip_snapshot),
          connection_method = VALUES(connection_method),
          ticket_provider = VALUES(ticket_provider),
          ticket_key = VALUES(ticket_key),
          ticket_url = VALUES(ticket_url),
          started_at = VALUES(started_at),
          status = VALUES(status),
          updated_at = NOW()
      `)
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit start persist failed')
    }
  }

  async finish(input: SessionAuditEndInput): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE session_audits
        SET
          ended_at = ${input.endedAt},
          status = ${input.status},
          updated_at = NOW()
        WHERE session_id = ${input.sessionId}
      `)
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit end persist failed')
    }
  }

  async repairOrphanedRunningSessions(): Promise<number> {
    try {
      const result = await this.db.$executeRaw(Prisma.sql`
        UPDATE session_audits sa
        INNER JOIN sessions s ON s.id = sa.session_id
        SET
          sa.ended_at = COALESCE(sa.ended_at, s.ended_at, NOW()),
          sa.status = ${'FAILED'},
          sa.updated_at = NOW()
        WHERE sa.status = ${'RUNNING'}
          AND s.active = false
      `)

      return Number(result)
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit orphan repair failed')
      return 0
    }
  }

  async appendChunk(input: SessionAuditChunkInput): Promise<void> {
    try {
      await this.db.$transaction([
        this.db.$executeRaw(Prisma.sql`
          INSERT INTO session_audit_chunks (
            session_audit_id,
            seq,
            started_at,
            ended_at,
            event_count,
            storage_key,
            compression,
            compressed_size,
            raw_size,
            created_at
          )
          SELECT
            sa.id,
            ${input.seq},
            ${input.startedAt},
            ${input.endedAt},
            ${input.eventCount},
            ${input.storageKey},
            ${input.compression},
            ${input.compressedSize},
            ${input.rawSize},
            NOW()
          FROM session_audits sa
          WHERE sa.session_id = ${input.sessionId}
        `),
        this.db.$executeRaw(Prisma.sql`
          UPDATE session_audits
          SET
            chunk_count = chunk_count + 1,
            bytes_in = bytes_in + ${input.bytesInDelta},
            bytes_out = bytes_out + ${input.bytesOutDelta},
            updated_at = NOW()
          WHERE session_id = ${input.sessionId}
        `),
      ])
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit chunk persist failed')
    }
  }

  async findAll(tenantId: number, filters: SessionAuditListFilters): Promise<{ rows: SessionAuditRow[]; total: number }> {
    const { search, ticketKey, status, aiState, aiRiskLevel, hostState, hostId, periodDays, page = 1, limit = 20 } = filters
    const skip = (page - 1) * limit
    const whereInput: {
      tenantId: number
      search?: string
      ticketKey?: string
      status?: string
      aiState?: 'with-ai' | 'without-ai'
      aiRiskLevel?: string
      hostState?: 'active' | 'deleted'
      hostId?: number
      periodDays?: number
    } = { tenantId }
    if (search) whereInput.search = search
    if (ticketKey) whereInput.ticketKey = ticketKey
    if (status) whereInput.status = status
    if (aiState) whereInput.aiState = aiState
    if (aiRiskLevel) whereInput.aiRiskLevel = aiRiskLevel
    if (hostState) whereInput.hostState = hostState
    if (hostId) whereInput.hostId = hostId
    if (periodDays) whereInput.periodDays = periodDays
    const where = buildListWhere(whereInput)

    try {
      const rows = await this.db.$queryRaw<SessionAuditRow[]>(Prisma.sql`
        SELECT
          sa.session_id AS sessionId,
          sa.tenant_id AS tenantId,
          sa.user_id AS userId,
          sa.user_name_snapshot AS userNameSnapshot,
          sa.user_email_snapshot AS userEmailSnapshot,
          sa.host_id AS hostId,
          sa.host_name_snapshot AS hostNameSnapshot,
          sa.host_ip_snapshot AS hostIpSnapshot,
          (h.deleted_at IS NOT NULL) AS hostDeleted,
          h.deleted_at AS hostDeletedAt,
          sa.connection_method AS connectionMethod,
          s.client_ip AS clientIp,
          s.user_agent AS userAgent,
          s.agent_remote_ip AS agentRemoteIp,
          sa.ticket_provider AS ticketProvider,
          sa.ticket_key AS ticketKey,
          sa.ticket_url AS ticketUrl,
          sa.started_at AS startedAt,
          sa.ended_at AS endedAt,
          sa.status,
          sa.chunk_count AS chunkCount,
          sa.bytes_in AS bytesIn,
          sa.bytes_out AS bytesOut,
          sa.ai_summary_status AS aiSummaryStatus,
          sa.ai_summary_text AS aiSummaryText,
          sa.ai_summary_json AS aiSummaryJson,
          sa.ai_risk_level AS aiRiskLevel
        FROM session_audits sa
        LEFT JOIN sessions s ON s.id = sa.session_id
        LEFT JOIN hosts h ON h.id = sa.host_id
        ${where}
        ORDER BY sa.started_at DESC
        LIMIT ${limit}
        OFFSET ${skip}
      `)

      const totalRow = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM session_audits sa
        LEFT JOIN hosts h ON h.id = sa.host_id
        ${where}
      `)

      return {
        rows,
        total: Number(totalRow[0]?.total ?? 0),
      }
    } catch (err) {
      if (isTableMissingError(err)) return { rows: [], total: 0 }
      logger.error({ err }, 'Session audit list query failed')
      return { rows: [], total: 0 }
    }
  }

  async findBySessionId(tenantId: number, sessionId: number): Promise<SessionAuditRow | null> {
    try {
      const rows = await this.db.$queryRaw<SessionAuditRow[]>(Prisma.sql`
        SELECT
          sa.session_id AS sessionId,
          sa.tenant_id AS tenantId,
          sa.user_id AS userId,
          sa.user_name_snapshot AS userNameSnapshot,
          sa.user_email_snapshot AS userEmailSnapshot,
          sa.host_id AS hostId,
          sa.host_name_snapshot AS hostNameSnapshot,
          sa.host_ip_snapshot AS hostIpSnapshot,
          (h.deleted_at IS NOT NULL) AS hostDeleted,
          h.deleted_at AS hostDeletedAt,
          sa.connection_method AS connectionMethod,
          s.client_ip AS clientIp,
          s.user_agent AS userAgent,
          s.agent_remote_ip AS agentRemoteIp,
          sa.ticket_provider AS ticketProvider,
          sa.ticket_key AS ticketKey,
          sa.ticket_url AS ticketUrl,
          sa.started_at AS startedAt,
          sa.ended_at AS endedAt,
          sa.status,
          sa.chunk_count AS chunkCount,
          sa.bytes_in AS bytesIn,
          sa.bytes_out AS bytesOut,
          sa.ai_summary_status AS aiSummaryStatus,
          sa.ai_summary_text AS aiSummaryText,
          sa.ai_summary_json AS aiSummaryJson,
          sa.ai_risk_level AS aiRiskLevel
        FROM session_audits sa
        LEFT JOIN sessions s ON s.id = sa.session_id
        LEFT JOIN hosts h ON h.id = sa.host_id
        WHERE sa.tenant_id = ${tenantId}
          AND sa.session_id = ${sessionId}
        LIMIT 1
      `)
      return rows[0] ?? null
    } catch (err) {
      if (isTableMissingError(err)) return null
      logger.error({ err }, 'Session audit detail query failed')
      return null
    }
  }

  async listChunks(sessionId: number): Promise<SessionAuditChunkRow[]> {
    try {
      return await this.db.$queryRaw<SessionAuditChunkRow[]>(Prisma.sql`
        SELECT
          sac.seq AS seq,
          sac.storage_key AS storageKey
        FROM session_audit_chunks sac
        INNER JOIN session_audits sa ON sa.id = sac.session_audit_id
        WHERE sa.session_id = ${sessionId}
        ORDER BY sac.seq ASC
      `)
    } catch (err) {
      if (isTableMissingError(err)) return []
      logger.error({ err }, 'Session audit chunks query failed')
      return []
    }
  }

  async linkTicket(input: SessionAuditLinkTicketInput): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE session_audits
        SET
          ticket_provider = ${input.ticketProvider},
          ticket_key = ${input.ticketKey},
          ticket_url = ${input.ticketUrl},
          updated_at = NOW()
        WHERE tenant_id = ${input.tenantId}
          AND session_id = ${input.sessionId}
      `)
    } catch (err) {
      this.handlePersistenceError(err, 'Session audit ticket link persist failed')
    }
  }

  private handlePersistenceError(err: unknown, message: string): void {
    if (isTableMissingError(err)) {
      if (!this.warnedMissingTable) {
        this.warnedMissingTable = true
        logger.warn({ err }, 'Session audit tables not available yet; persistence disabled')
      }
      return
    }
    logger.error({ err }, message)
  }
}

function buildListWhere(filters: {
  tenantId: number
  search?: string
  ticketKey?: string
  status?: string
  aiState?: 'with-ai' | 'without-ai'
  aiRiskLevel?: string
  hostState?: 'active' | 'deleted'
  hostId?: number
  periodDays?: number
}) {
  const clauses = [Prisma.sql`sa.tenant_id = ${filters.tenantId}`]

  if (filters.ticketKey) {
    clauses.push(Prisma.sql`sa.ticket_key = ${filters.ticketKey}`)
  }

  if (filters.status) {
    clauses.push(Prisma.sql`sa.status = ${filters.status}`)
  }

  if (filters.aiRiskLevel) {
    clauses.push(Prisma.sql`LOWER(sa.ai_risk_level) = ${filters.aiRiskLevel.toLowerCase()}`)
  }

  if (filters.hostState === 'active') {
    clauses.push(Prisma.sql`h.deleted_at IS NULL`)
  }

  if (filters.hostState === 'deleted') {
    clauses.push(Prisma.sql`h.deleted_at IS NOT NULL`)
  }

  if (filters.hostId) {
    clauses.push(Prisma.sql`sa.host_id = ${filters.hostId}`)
  }

  if (filters.periodDays) {
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (filters.periodDays - 1))
    clauses.push(Prisma.sql`sa.started_at >= ${from}`)
  }

  if (filters.aiState === 'with-ai') {
    clauses.push(Prisma.sql`(
      sa.ai_summary_text IS NOT NULL
      OR sa.ai_summary_json IS NOT NULL
    )`)
  }

  if (filters.aiState === 'without-ai') {
    clauses.push(Prisma.sql`(
      sa.ai_summary_text IS NULL
      AND sa.ai_summary_json IS NULL
    )`)
  }

  if (filters.search) {
    const like = `%${filters.search}%`
    clauses.push(Prisma.sql`(
      sa.user_name_snapshot LIKE ${like}
      OR sa.user_email_snapshot LIKE ${like}
      OR sa.host_name_snapshot LIKE ${like}
      OR sa.host_ip_snapshot LIKE ${like}
      OR sa.ticket_key LIKE ${like}
    )`)
  }

  const [first, ...rest] = clauses
  if (rest.length === 0) {
    return Prisma.sql`WHERE ${first}`
  }
  return Prisma.sql`WHERE ${first} ${Prisma.join(rest.map((clause) => Prisma.sql`AND ${clause}`), ' ')}`
}

function isTableMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (err.message.includes('session_audits') || err.message.includes('session_audit_chunks')) && (
    err.message.includes("doesn't exist")
    || err.message.includes('does not exist')
    || err.message.includes('no such table')
  )
}
