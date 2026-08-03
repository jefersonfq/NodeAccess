import type { FastifyReply, FastifyRequest } from 'fastify'
import type { SessionAuditService } from './session-audit.service.js'

export interface SessionAuditQuery {
  search?: string
  ticketKey?: string
  status?: string
  aiState?: 'with-ai' | 'without-ai'
  aiRiskLevel?: string
  hostState?: 'active' | 'deleted'
  hostId?: number
  periodDays?: number
  minCommandCount?: number
  page?: number
  limit?: number
}

export interface SessionAuditPreviewQuery {
  limit?: number
}

export interface SessionAuditCommandsQuery {
  limit?: number
}

export interface SessionAuditParams {
  sessionId: string
}

export interface SessionAuditRetrySummaryBody {
  template?: 'summary-v1' | 'cab-v1' | 'risk-v1'
}

export interface SessionAuditLinkTicketBody {
  ticketKey: string
}

export class SessionAuditController {
  constructor(private readonly service: SessionAuditService) {}

  async list(request: FastifyRequest<{ Querystring: SessionAuditQuery }>, reply: FastifyReply) {
    const { search, ticketKey, status, aiState, aiRiskLevel, hostState, hostId, periodDays, minCommandCount, page, limit } = request.query
    const tenantId = request.jwtUser!.tenantId
    const filters: SessionAuditQuery = {}
    if (search) filters.search = search
    if (ticketKey) filters.ticketKey = ticketKey
    if (status) filters.status = status
    if (aiState) filters.aiState = aiState
    if (aiRiskLevel) filters.aiRiskLevel = aiRiskLevel
    if (hostState) filters.hostState = hostState
    if (hostId) filters.hostId = Number(hostId)
    if (periodDays) filters.periodDays = Number(periodDays)
    if (minCommandCount !== undefined) {
      const normalized = Math.max(0, Math.floor(Number(minCommandCount)))
      if (Number.isFinite(normalized) && normalized > 0) filters.minCommandCount = normalized
    }
    if (page) filters.page = Number(page)
    if (limit) filters.limit = Number(limit)
    const result = await this.service.list(tenantId, filters)
    return reply.send(result)
  }

  async getBySessionId(request: FastifyRequest<{ Params: SessionAuditParams }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const result = await this.service.getBySessionId(tenantId, sessionId)
    return reply.send(result)
  }

  async download(request: FastifyRequest<{ Params: SessionAuditParams }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const result = await this.service.download(tenantId, sessionId)

    reply.header('content-type', 'application/x-ndjson; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="${result.filename}"`)
    return reply.send(result.content)
  }

  async preview(request: FastifyRequest<{ Params: SessionAuditParams; Querystring: SessionAuditPreviewQuery }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const limit = request.query.limit ? Number(request.query.limit) : undefined
    const result = await this.service.preview(tenantId, sessionId, limit)
    return reply.send(result)
  }

  async commands(request: FastifyRequest<{ Params: SessionAuditParams; Querystring: SessionAuditCommandsQuery }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const limit = request.query.limit ? Number(request.query.limit) : undefined
    const result = await this.service.commands(tenantId, sessionId, limit)
    return reply.send(result)
  }

  async commandStats(request: FastifyRequest<{ Params: SessionAuditParams }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const result = await this.service.commandStats(tenantId, sessionId)
    return reply.send(result)
  }

  async jobs(request: FastifyRequest<{ Params: SessionAuditParams }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const result = await this.service.jobs(tenantId, sessionId)
    return reply.send(result)
  }

  async artifacts(request: FastifyRequest<{ Params: SessionAuditParams }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const result = await this.service.artifacts(tenantId, sessionId)
    return reply.send(result)
  }

  async retrySummary(request: FastifyRequest<{ Params: SessionAuditParams; Body: SessionAuditRetrySummaryBody }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const userId = request.jwtUser!.sub
    const sessionId = Number(request.params.sessionId)
    const body = request.body ?? {}
    await this.service.retrySummary(tenantId, sessionId, Number(userId), body.template ?? 'summary-v1')
    return reply.status(202).send({ ok: true })
  }

  async linkTicket(request: FastifyRequest<{ Params: SessionAuditParams; Body: SessionAuditLinkTicketBody }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    const body = request.body
    const result = await this.service.linkJiraTicket(tenantId, sessionId, body.ticketKey)
    return reply.send(result)
  }
}
