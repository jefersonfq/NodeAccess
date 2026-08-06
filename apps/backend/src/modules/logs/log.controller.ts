import type { FastifyRequest, FastifyReply } from 'fastify'
import type { ClientUxEvent } from '@nodeaccess/shared'
import type { UserProductivityEvent } from '@nodeaccess/shared'
import type { LogService } from './log.service.js'

interface AuthLogQuery {
  eventType?: string
  success?:   string
  search?:    string
  page?:      number
  limit?:     number
}

interface AdminLogQuery {
  search?: string
  action?: string
  actions?: string
  actionPrefix?: string
  detailsContains?: string
  targetType?: string
  targetId?: number
  mcpTokenId?: number
  mcpAuthMode?: string
  page?:   number
  limit?:  number
}

interface InventoryAclAuditQuery {
  search?: string
  targetId?: number
  page?: number
  limit?: number
}

interface McpInteractiveSshSessionQuery {
  search?: string
  status?: string
  hostId?: number
  tokenId?: number
  page?: number
  limit?: number
}

interface SnippetExecutionQuery {
  search?: string
  status?: string
  userId?: number
  snippetId?: number
  hostId?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

interface ClientUxEventsBody {
  events: ClientUxEvent[]
}

interface UserProductivityEventsBody {
  events: Array<{ event: UserProductivityEvent; targetId: number }>
}

interface McpInteractiveSshSessionParams {
  sessionId: string
}

export class LogController {
  constructor(private readonly logService: LogService) {}

  async listAuthLogs(request: FastifyRequest<{ Querystring: AuthLogQuery }>, reply: FastifyReply): Promise<FastifyReply> {
    const { eventType, success, search, page, limit } = request.query
    const tenantId = request.jwtUser!.tenantId
    const result = await this.logService.listAuthLogs(tenantId, {
      ...(eventType !== undefined && { eventType }),
      ...(success !== undefined && { success: success === 'true' }),
      ...(search !== undefined && { search }),
      ...(page !== undefined && { page: Number(page) }),
      ...(limit !== undefined && { limit: Number(limit) }),
    })
    return reply.send(result)
  }

  async listAdminLogs(request: FastifyRequest<{ Querystring: AdminLogQuery }>, reply: FastifyReply): Promise<FastifyReply> {
    const { search, action, actions, actionPrefix, detailsContains, targetType, targetId, mcpTokenId, mcpAuthMode, page, limit } = request.query
    const tenantId = request.jwtUser!.tenantId
    const parsedActions = typeof actions === 'string'
      ? actions.split(',').map((item) => item.trim()).filter(Boolean)
      : undefined
    const parsedDetailsContains = typeof detailsContains === 'string'
      ? detailsContains.split(',').map((item) => item.trim()).filter(Boolean)
      : undefined
    const result = await this.logService.listAdminLogs(tenantId, {
      ...(search !== undefined && { search }),
      ...(action !== undefined && { action }),
      ...(parsedActions !== undefined && parsedActions.length > 0 && { actions: parsedActions }),
      ...(actionPrefix !== undefined && parsedActions === undefined && { actionPrefix }),
      ...(parsedDetailsContains !== undefined && parsedDetailsContains.length > 0 && { detailsContains: parsedDetailsContains }),
      ...(targetType !== undefined && { targetType }),
      ...(targetId !== undefined && { targetId: Number(targetId) }),
      ...(mcpTokenId !== undefined && { mcpTokenId: Number(mcpTokenId) }),
      ...(mcpAuthMode !== undefined && { mcpAuthMode }),
      ...(page !== undefined && { page: Number(page) }),
      ...(limit !== undefined && { limit: Number(limit) }),
    })
    return reply.send(result)
  }

  async listInventoryAclAudit(request: FastifyRequest<{ Querystring: InventoryAclAuditQuery }>, reply: FastifyReply): Promise<FastifyReply> {
    const { search, targetId, page, limit } = request.query
    const tenantId = request.jwtUser!.tenantId
    const result = await this.logService.listInventoryAclAudit(tenantId, {
      ...(search !== undefined && { search }),
      ...(targetId !== undefined && { targetId: Number(targetId) }),
      ...(page !== undefined && { page: Number(page) }),
      ...(limit !== undefined && { limit: Number(limit) }),
    })
    return reply.send(result)
  }

  async listMcpInteractiveSshSessions(request: FastifyRequest<{ Querystring: McpInteractiveSshSessionQuery }>, reply: FastifyReply): Promise<FastifyReply> {
    const { search, status, hostId, tokenId, page, limit } = request.query
    const tenantId = request.jwtUser!.tenantId
    const result = await this.logService.listMcpInteractiveSshSessions(tenantId, {
      ...(search !== undefined && { search }),
      ...(status !== undefined && { status }),
      ...(hostId !== undefined && { hostId: Number(hostId) }),
      ...(tokenId !== undefined && { tokenId: Number(tokenId) }),
      ...(page !== undefined && { page: Number(page) }),
      ...(limit !== undefined && { limit: Number(limit) }),
    })
    return reply.send(result)
  }

  async closeMcpInteractiveSshSession(request: FastifyRequest<{ Params: McpInteractiveSshSessionParams }>, reply: FastifyReply): Promise<FastifyReply> {
    const result = await this.logService.closeMcpInteractiveSshSession(request.jwtUser!, request.params.sessionId)
    return reply.send(result)
  }

  async listSnippetExecutions(request: FastifyRequest<{ Querystring: SnippetExecutionQuery }>, reply: FastifyReply): Promise<FastifyReply> {
    const { search, status, userId, snippetId, hostId, dateFrom, dateTo, page, limit } = request.query
    const tenantId = request.jwtUser!.tenantId
    const result = await this.logService.listSnippetExecutions(tenantId, {
      ...(search !== undefined && { search }),
      ...(status !== undefined && { status }),
      ...(userId !== undefined && { userId: Number(userId) }),
      ...(snippetId !== undefined && { snippetId: Number(snippetId) }),
      ...(hostId !== undefined && { hostId: Number(hostId) }),
      ...(dateFrom !== undefined && { dateFrom: new Date(dateFrom) }),
      ...(dateTo !== undefined && { dateTo: new Date(dateTo) }),
      ...(page !== undefined && { page: Number(page) }),
      ...(limit !== undefined && { limit: Number(limit) }),
    })
    return reply.send(result)
  }

  async recordClientUxEvents(request: FastifyRequest<{ Body: ClientUxEventsBody }>, reply: FastifyReply): Promise<FastifyReply> {
    await this.logService.recordClientUxEvents(Number(request.jwtUser!.sub), request.body.events)
    return reply.status(204).send()
  }

  async recordUserProductivityEvents(request: FastifyRequest<{ Body: UserProductivityEventsBody }>, reply: FastifyReply): Promise<FastifyReply> {
    await this.logService.recordUserProductivityEvents(Number(request.jwtUser!.sub), request.body.events)
    return reply.status(204).send()
  }
}
