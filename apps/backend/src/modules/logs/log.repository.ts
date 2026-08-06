import { Prisma, type AuthEventType, type PrismaClient } from '@prisma/client'

export interface AuthLogFilters {
  eventType?: string
  success?:   boolean
  search?:    string
  page?:      number
  limit?:     number
}

export interface AdminLogFilters {
  search?: string
  action?: string
  actions?: string[]
  actionPrefix?: string
  detailsContains?: string[]
  targetType?: string
  targetId?: number
  mcpTokenId?: number
  mcpAuthMode?: string
  page?:   number
  limit?:  number
}

export interface McpInteractiveSshSessionFilters {
  search?: string
  status?: string
  hostId?: number
  tokenId?: number
  page?: number
  limit?: number
}

export interface SnippetExecutionFilters {
  search?: string
  status?: string
  userId?: number
  snippetId?: number
  hostId?: number
  dateFrom?: Date
  dateTo?: Date
  page?: number
  limit?: number
}

const authLogInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const

const adminLogInclude = {
  admin: { select: { id: true, name: true } },
} as const

export type AuthLogRow  = Prisma.AuthLogGetPayload<{ include: typeof authLogInclude }>
export type AdminLogRow = Prisma.AdminLogGetPayload<{ include: typeof adminLogInclude }>

export interface McpInteractiveSshSessionRow {
  id: number
  sessionId: string
  tenantId: number
  userId: number
  userName: string
  userEmail: string
  tokenId: number | null
  hostId: number
  hostName: string
  reason: string
  status: string
  openedAt: Date
  lastActivityAt: Date
  expiresAt: Date
  closedAt: Date | null
  closeReason: string | null
  inputBytes: number
  outputBytesRead: number
}

export interface SnippetExecutionRow {
  id: number
  tenantId: number
  userId: number
  userName: string
  userEmail: string
  snippetId: number | null
  snippetName: string | null
  snippetScope: string | null
  hostId: number | null
  hostName: string | null
  sessionId: number | null
  executionId: string
  source: string
  status: string
  executedAt: Date
}

export class LogRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAuthLogs(
    tenantId: number,
    filters: AuthLogFilters,
  ): Promise<{ logs: AuthLogRow[]; total: number }> {
    const { eventType, success, search, page = 1, limit = 30 } = filters
    const skip = (page - 1) * limit

    // With search: only show logs from known users in this tenant
    // Without search: include anonymous failures (userId = null) + tenant users
    const where: Prisma.AuthLogWhereInput = {}

    if (eventType !== undefined) {
      Object.assign(where, {
        eventType: eventType as Prisma.EnumAuthEventTypeFilter['equals'],
      })
    }
    if (success !== undefined) {
      Object.assign(where, { success })
    }
    if (search !== undefined) {
      where.user = {
        tenantId,
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      }
    } else {
      where.OR = [
        { userId: null },
        { user: { tenantId } },
      ]
    }

    const [logs, total] = await this.db.$transaction([
      this.db.authLog.findMany({
        where,
        include: authLogInclude,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.db.authLog.count({ where }),
    ])

    return { logs, total }
  }

  async findAdminLogs(
    tenantId: number,
    filters: AdminLogFilters,
  ): Promise<{ logs: AdminLogRow[]; total: number }> {
    const { search, action, actions, actionPrefix, detailsContains, targetType, targetId, mcpTokenId, mcpAuthMode, page = 1, limit = 30 } = filters
    const skip = (page - 1) * limit
    const andFilters: Prisma.AdminLogWhereInput[] = [
      ...((detailsContains ?? []).map((item) => ({ details: { contains: item } }))),
      ...(mcpTokenId !== undefined ? [{ details: { contains: `"tokenId":${mcpTokenId}` } }] : []),
      ...(mcpAuthMode !== undefined ? [{ details: { contains: `"authMode":"${mcpAuthMode}"` } }] : []),
    ]

    const where: Prisma.AdminLogWhereInput = {
      admin: { tenantId },
      ...(actions !== undefined && actions.length > 0
        ? { action: { in: actions } }
        : action !== undefined
        ? { action }
        : actionPrefix !== undefined
          ? { action: { startsWith: actionPrefix } }
          : {}),
      ...(targetType !== undefined && { targetType }),
      ...(targetId !== undefined && { targetId }),
      ...(andFilters.length > 0 && { AND: andFilters }),
      ...(search !== undefined && {
        OR: [
          { admin:      { name:       { contains: search } } },
          { action:     { contains: search } },
          { targetType: { contains: search } },
          { details:    { contains: search } },
        ],
      }),
    }

    const [logs, total] = await this.db.$transaction([
      this.db.adminLog.findMany({
        where,
        include: adminLogInclude,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.db.adminLog.count({ where }),
    ])

    return { logs, total }
  }

  async findRecentAuthLogs(tenantId: number, limit: number): Promise<AuthLogRow[]> {
    return this.db.authLog.findMany({
      where: {
        OR: [
          { userId: null },
          { user: { tenantId } },
        ],
      },
      include: authLogInclude,
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
  }

  async findRecentAdminEventsByTarget(
    tenantId: number,
    targetType: string,
    targetId: number,
    actions: string[],
    limit: number,
  ): Promise<AdminLogRow[]> {
    return this.db.adminLog.findMany({
      where: {
        admin: { tenantId },
        targetType,
        targetId,
        action: { in: actions },
      },
      include: adminLogInclude,
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
  }

  async findMcpInteractiveSshSessions(
    tenantId: number,
    filters: McpInteractiveSshSessionFilters,
  ): Promise<{ sessions: McpInteractiveSshSessionRow[]; total: number }> {
    const { search, status, hostId, tokenId, page = 1, limit = 30 } = filters
    const skip = (page - 1) * limit
    const where: Prisma.Sql[] = [Prisma.sql`s.tenant_id = ${tenantId}`]

    if (status !== undefined) where.push(Prisma.sql`s.status = ${status}`)
    if (hostId !== undefined) where.push(Prisma.sql`s.host_id = ${hostId}`)
    if (tokenId !== undefined) where.push(Prisma.sql`s.token_id = ${tokenId}`)
    if (search !== undefined) {
      const like = `%${search}%`
      where.push(Prisma.sql`(
        s.session_id LIKE ${like}
        OR s.host_name LIKE ${like}
        OR s.reason LIKE ${like}
        OR COALESCE(s.close_reason, '') LIKE ${like}
        OR u.name LIKE ${like}
        OR u.email LIKE ${like}
      )`)
    }

    const combinedWhere = where.slice(1).reduce(
      (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
      where[0]!,
    )
    const whereSql = Prisma.sql`WHERE ${combinedWhere}`

    const sessions = await this.db.$queryRaw<McpInteractiveSshSessionRow[]>(Prisma.sql`
      SELECT
        s.id,
        s.session_id AS sessionId,
        s.tenant_id AS tenantId,
        s.user_id AS userId,
        u.name AS userName,
        u.email AS userEmail,
        s.token_id AS tokenId,
        s.host_id AS hostId,
        s.host_name AS hostName,
        s.reason,
        s.status,
        s.opened_at AS openedAt,
        s.last_activity_at AS lastActivityAt,
        s.expires_at AS expiresAt,
        s.closed_at AS closedAt,
        s.close_reason AS closeReason,
        s.input_bytes AS inputBytes,
        s.output_bytes_read AS outputBytesRead
      FROM mcp_interactive_ssh_sessions s
      INNER JOIN users u ON u.id = s.user_id
      ${whereSql}
      ORDER BY s.opened_at DESC
      LIMIT ${limit} OFFSET ${skip}
    `)

    const countRows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM mcp_interactive_ssh_sessions s
      INNER JOIN users u ON u.id = s.user_id
      ${whereSql}
    `)

    return {
      sessions,
      total: Number(countRows[0]?.total ?? 0),
    }
  }

  async findSnippetExecutions(
    tenantId: number,
    filters: SnippetExecutionFilters,
  ): Promise<{ executions: SnippetExecutionRow[]; total: number }> {
    const { search, status, userId, snippetId, hostId, dateFrom, dateTo, page = 1, limit = 30 } = filters
    const skip = (page - 1) * limit
    const where: Prisma.Sql[] = [Prisma.sql`e.tenant_id = ${tenantId}`]

    if (status !== undefined) where.push(Prisma.sql`e.status = ${status}`)
    if (userId !== undefined) where.push(Prisma.sql`e.user_id = ${userId}`)
    if (snippetId !== undefined) where.push(Prisma.sql`e.snippet_id = ${snippetId}`)
    if (hostId !== undefined) where.push(Prisma.sql`e.host_id = ${hostId}`)
    if (dateFrom !== undefined) where.push(Prisma.sql`e.executed_at >= ${dateFrom}`)
    if (dateTo !== undefined) where.push(Prisma.sql`e.executed_at <= ${dateTo}`)
    if (search !== undefined) {
      const like = `%${search}%`
      where.push(Prisma.sql`(
        COALESCE(sn.name, '') LIKE ${like}
        OR u.name LIKE ${like}
        OR u.email LIKE ${like}
        OR COALESCE(h.name, '') LIKE ${like}
      )`)
    }

    const combinedWhere = where.slice(1).reduce(
      (acc, clause) => Prisma.sql`${acc} AND ${clause}`,
      where[0]!,
    )
    const whereSql = Prisma.sql`WHERE ${combinedWhere}`

    const executions = await this.db.$queryRaw<SnippetExecutionRow[]>(Prisma.sql`
      SELECT
        e.id,
        e.tenant_id AS tenantId,
        e.user_id AS userId,
        u.name AS userName,
        u.email AS userEmail,
        e.snippet_id AS snippetId,
        sn.name AS snippetName,
        sn.scope AS snippetScope,
        e.host_id AS hostId,
        h.name AS hostName,
        e.session_id AS sessionId,
        e.execution_id AS executionId,
        e.source,
        e.status,
        e.executed_at AS executedAt
      FROM snippet_execution_events e
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN snippets sn ON sn.id = e.snippet_id
      LEFT JOIN hosts h ON h.id = e.host_id
      ${whereSql}
      ORDER BY e.executed_at DESC
      LIMIT ${limit} OFFSET ${skip}
    `)

    const countRows = await this.db.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM snippet_execution_events e
      INNER JOIN users u ON u.id = e.user_id
      LEFT JOIN snippets sn ON sn.id = e.snippet_id
      LEFT JOIN hosts h ON h.id = e.host_id
      ${whereSql}
    `)

    return {
      executions,
      total: Number(countRows[0]?.total ?? 0),
    }
  }

  async logAdminEvent(data: {
    adminId:    number
    action:     string
    targetType: string
    targetId:   number
    details?:   string
  }): Promise<void> {
    await this.db.adminLog.create({ data })
  }

  async logAuthEvent(data: {
    userId?: number
    eventType: AuthEventType
    ip?: string
    userAgent?: string
    success: boolean
  }): Promise<void> {
    await this.db.authLog.create({ data })
  }
}
