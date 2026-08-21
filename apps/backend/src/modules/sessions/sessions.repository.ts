import { Prisma, type PrismaClient } from '@prisma/client'
import { endStaleActiveSessions } from './session-liveness.js'
import { normalizeSessionSort, type SessionSortBy, type SessionSortDirection } from './session-list-query.js'

export interface SessionFilters {
  search?: string
  active?: boolean
  connectionMethod?: string
  accessType?: 'authenticated' | 'jit_public_link'
  hostState?: 'active' | 'deleted'
  hostId?: number
  userId?: number
  periodDays?: number
  dateFrom?: Date
  dateTo?: Date
  hasError?: boolean
  originIp?: string
  sortBy?: SessionSortBy
  sortDirection?: SessionSortDirection
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
  accessType: string
  jitLinkId: number | null
  jitGuestName: string | null
  agentRemoteIp: string | null
  endedReason: string | null
  errorCode: string | null
  errorMessage: string | null
  user: { id: number; name: string; email: string }
  host: { id: number; name: string; ip: string; deleted: boolean; deletedAt: Date | null }
}

export interface ActiveSessionOverviewRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  userAvatarUpdatedAt: Date | null
  hostId: number
  hostTenantId: number
  hostName: string
  hostIp: string
  hostPort: number
  hostScope: string
  hostGroupName: string | null
  hostAccessProtocol: string
  startedAt: Date
  lastSeenAt: Date
  connectionMethod: string
  accessType: string
  clientIp: string | null
  agentRemoteIp: string | null
  agentNameSnapshot: string | null
}

export interface ActiveSessionRuntimeRow {
  id: number
  tenantId: number
  active: boolean
  connectionMethod: string
}

export interface ActiveInventoryAclSessionRow {
  id: number
  userId: number
  userRole: 'ADMIN' | 'USER'
  hostId: number
  connectionMethod: string
}

export class SessionsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(
    tenantId: number,
    filters: SessionFilters,
  ): Promise<{ sessions: SessionRow[]; total: number }> {
    const { search, active, connectionMethod, accessType, hostState, hostId, userId, periodDays, dateFrom, dateTo, hasError, originIp, page = 1, limit = 20 } = filters
    const { sortBy, sortDirection } = normalizeSessionSort(filters.sortBy, filters.sortDirection)
    const skip = (page - 1) * limit

    const whereParts: Prisma.Sql[] = [
      Prisma.sql`u.tenant_id = ${tenantId}`,
      Prisma.sql`h.tenant_id = ${tenantId}`,
    ]
    if (active !== undefined) whereParts.push(Prisma.sql`s.active = ${active}`)
    if (connectionMethod) whereParts.push(Prisma.sql`s.connection_method = ${connectionMethod}`)
    if (accessType) whereParts.push(Prisma.sql`COALESCE(s.access_type, 'authenticated') = ${accessType}`)
    if (hostState === 'active') whereParts.push(Prisma.sql`h.deleted_at IS NULL`)
    if (hostState === 'deleted') whereParts.push(Prisma.sql`h.deleted_at IS NOT NULL`)
    if (hostId) whereParts.push(Prisma.sql`s.host_id = ${hostId}`)
    if (userId) whereParts.push(Prisma.sql`s.user_id = ${userId}`)
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
    const sortExpression: Record<SessionSortBy, Prisma.Sql> = {
      user: Prisma.sql`u.name`,
      host: Prisma.sql`h.name`,
      startedAt: Prisma.sql`s.started_at`,
      endedAt: Prisma.sql`s.ended_at`,
      duration: Prisma.sql`TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.ended_at, CURRENT_TIMESTAMP(3)))`,
      connectionMethod: Prisma.sql`COALESCE(s.connection_method, 'direct')`,
      active: Prisma.sql`s.active`,
    }
    const sortDirectionSql = sortDirection === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

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
        accessType: string | null
        jitLinkId: number | null
        jitGuestName: string | null
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
          COALESCE(s.access_type, 'authenticated') AS accessType,
          s.jit_link_id AS jitLinkId,
          s.jit_guest_name AS jitGuestName,
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
        ORDER BY ${sortExpression[sortBy]} ${sortDirectionSql}, s.id DESC
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
        accessType: row.accessType ?? 'authenticated',
        jitLinkId: row.jitLinkId,
        jitGuestName: row.jitGuestName,
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

  async listFilterUsers(tenantId: number): Promise<Array<{ id: number; name: string; email: string }>> {
    return this.db.$queryRaw<Array<{ id: number; name: string; email: string }>>(Prisma.sql`
      SELECT DISTINCT u.id, u.name, u.email
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      INNER JOIN hosts h ON h.id = s.host_id
      WHERE u.tenant_id = ${tenantId}
        AND h.tenant_id = ${tenantId}
      ORDER BY u.name ASC, u.email ASC, u.id ASC
      LIMIT 1000
    `)
  }

  async endStaleActive(staleBefore: Date): Promise<number> {
    return endStaleActiveSessions(this.db, staleBefore)
  }

  async findActiveOverview(
    tenantId: number,
    _viewer: { userId: number; role: 'ADMIN' | 'USER' },
  ): Promise<ActiveSessionOverviewRow[]> {
    const visibilityParts: Prisma.Sql[] = [
      Prisma.sql`u.tenant_id = ${tenantId}`,
      Prisma.sql`h.tenant_id = ${tenantId}`,
      Prisma.sql`s.active = true`,
      Prisma.sql`h.deleted_at IS NULL`,
    ]

    const whereSql = Prisma.sql`WHERE ${Prisma.join(visibilityParts, ' AND ')}`

    return this.db.$queryRaw<ActiveSessionOverviewRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.user_id AS userId,
        u.name AS userName,
        u.email AS userEmail,
        u.avatar_updated_at AS userAvatarUpdatedAt,
        s.host_id AS hostId,
        h.tenant_id AS hostTenantId,
        h.name AS hostName,
        h.ip AS hostIp,
        h.port AS hostPort,
        h.scope AS hostScope,
        g.name AS hostGroupName,
        h.access_protocol AS hostAccessProtocol,
        s.started_at AS startedAt,
        s.last_seen_at AS lastSeenAt,
        COALESCE(s.connection_method, 'direct') AS connectionMethod,
        COALESCE(s.access_type, 'authenticated') AS accessType,
        s.client_ip AS clientIp,
        s.agent_remote_ip AS agentRemoteIp,
        s.agent_name_snapshot AS agentNameSnapshot
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      INNER JOIN hosts h ON h.id = s.host_id
      LEFT JOIN \`groups\` g ON g.id = h.group_id
      ${whereSql}
      ORDER BY s.last_seen_at DESC, s.started_at DESC
      LIMIT 500
    `)
  }

  async findActiveRuntimeSession(tenantId: number, sessionId: number): Promise<ActiveSessionRuntimeRow | null> {
    const rows = await this.db.$queryRaw<Array<{
      id: number
      tenantId: number
      active: boolean | number
      connectionMethod: string | null
    }>>(Prisma.sql`
      SELECT
        s.id,
        u.tenant_id AS tenantId,
        s.active,
        COALESCE(s.connection_method, 'direct') AS connectionMethod
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      INNER JOIN hosts h ON h.id = s.host_id
      WHERE s.id = ${sessionId}
        AND u.tenant_id = ${tenantId}
        AND h.tenant_id = ${tenantId}
      LIMIT 1
    `)
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      tenantId: row.tenantId,
      active: Boolean(row.active),
      connectionMethod: row.connectionMethod ?? 'direct',
    }
  }

  async findActiveAuthenticatedByInventoryNode(
    tenantId: number,
    inventoryNodeId: number,
  ): Promise<ActiveInventoryAclSessionRow[]> {
    return this.db.$queryRaw<ActiveInventoryAclSessionRow[]>(Prisma.sql`
      WITH RECURSIVE affected_nodes AS (
        SELECT id, host_id
        FROM inventory_nodes
        WHERE id = ${inventoryNodeId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL

        UNION ALL

        SELECT child.id, child.host_id
        FROM inventory_nodes child
        INNER JOIN affected_nodes parent ON child.parent_id = parent.id
        WHERE child.tenant_id = ${tenantId}
          AND child.deleted_at IS NULL
      )
      SELECT DISTINCT
        s.id,
        s.user_id AS userId,
        u.role AS userRole,
        s.host_id AS hostId,
        COALESCE(s.connection_method, 'direct') AS connectionMethod
      FROM affected_nodes node
      INNER JOIN sessions s
        ON s.host_id = node.host_id
       AND s.active = true
       AND COALESCE(s.access_type, 'authenticated') = 'authenticated'
      INNER JOIN users u
        ON u.id = s.user_id
       AND u.tenant_id = ${tenantId}
       AND u.deleted_at IS NULL
      WHERE node.host_id IS NOT NULL
    `)
  }

  async findActiveAuthenticatedByUser(
    tenantId: number,
    userId: number,
  ): Promise<ActiveInventoryAclSessionRow[]> {
    return this.db.$queryRaw<ActiveInventoryAclSessionRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.user_id AS userId,
        u.role AS userRole,
        s.host_id AS hostId,
        COALESCE(s.connection_method, 'direct') AS connectionMethod
      FROM sessions s
      INNER JOIN users u
        ON u.id = s.user_id
       AND u.tenant_id = ${tenantId}
       AND u.deleted_at IS NULL
      INNER JOIN hosts h
        ON h.id = s.host_id
       AND h.tenant_id = ${tenantId}
       AND h.deleted_at IS NULL
      WHERE s.user_id = ${userId}
        AND s.active = true
        AND COALESCE(s.access_type, 'authenticated') = 'authenticated'
    `)
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
