import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SessionsService } from './sessions.service.js'

interface SessionQuery {
  page?:   number
  limit?:  number
  search?: string
  active?: string
  connectionMethod?: string
  hostState?: string
  hostId?: number
  periodDays?: number
  dateFrom?: string
  dateTo?: string
  hasError?: string
  originIp?: string
}

export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  async list(request: FastifyRequest<{ Querystring: SessionQuery }>, reply: FastifyReply) {
    const startedAt = Date.now()
    const { page, limit, search, active, connectionMethod, hostState, hostId, periodDays, dateFrom, dateTo, hasError, originIp } = request.query
    const tenantId = request.jwtUser!.tenantId

    const result = await this.sessionsService.list(tenantId, {
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
      ...(search !== undefined && { search }),
      ...(active !== undefined && { active: active === 'true' }),
      ...(connectionMethod !== undefined && { connectionMethod }),
      ...(hostState === 'active' || hostState === 'deleted' ? { hostState } : {}),
      ...(hostId !== undefined && { hostId: Number(hostId) }),
      ...(periodDays !== undefined && { periodDays: Number(periodDays) }),
      ...(dateFrom !== undefined && { dateFrom: new Date(dateFrom) }),
      ...(dateTo !== undefined && { dateTo: new Date(dateTo) }),
      ...(hasError !== undefined && { hasError: hasError === 'true' }),
      ...(originIp !== undefined && { originIp }),
    })

    request.log.info({
      event: 'sessions.list',
      page: result.page,
      limit: result.limit,
      total: result.total,
      rows: result.data.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(result)),
      durationMs: Date.now() - startedAt,
    })

    return reply.send(result)
  }

  async cleanup(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const result   = await this.sessionsService.cleanupGhosts(tenantId)
    return reply.send(result)
  }
}
