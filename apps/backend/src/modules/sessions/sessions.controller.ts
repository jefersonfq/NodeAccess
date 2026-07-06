import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SessionsService } from './sessions.service.js'

interface SessionQuery {
  page?:   number
  limit?:  number
  search?: string
  active?: string
  connectionMethod?: string
  accessType?: string
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
    const { page, limit, search, active, connectionMethod, accessType, hostState, hostId, periodDays, dateFrom, dateTo, hasError, originIp } = request.query
    const tenantId = request.jwtUser!.tenantId

    const result = await this.sessionsService.list(tenantId, {
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
      ...(search !== undefined && { search }),
      ...(active !== undefined && { active: active === 'true' }),
      ...(connectionMethod !== undefined && { connectionMethod }),
      ...(accessType === 'authenticated' || accessType === 'jit_public_link' ? { accessType } : {}),
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

  async close(request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const sessionId = Number(request.params.sessionId)
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return reply.code(400).send({ message: 'Sessão inválida' })
    }

    const result = await this.sessionsService.closeActiveSession(tenantId, sessionId)
    if (result.reason === 'not_found') {
      return reply.code(404).send({ ...result, message: 'Sessão não encontrada' })
    }
    if (result.reason === 'not_active') {
      return reply.code(409).send({ ...result, message: 'Sessão já encerrada' })
    }
    if (result.reason === 'not_in_runtime') {
      return reply.code(409).send({ ...result, message: 'Sessão ativa não encontrada no runtime desta instância. Use o cleanup de fantasmas se ela estiver travada.' })
    }

    return reply.send(result)
  }

  async accessMap(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now()
    const user = request.jwtUser!
    const result = await this.sessionsService.getAccessMap(user.tenantId, {
      userId: Number(user.sub),
      role: user.role,
    })

    request.log.info({
      event: 'sessions.access_map',
      activeSessions: result.totals.activeSessions,
      activeHosts: result.totals.activeHosts,
      concurrentHosts: result.totals.concurrentHosts,
      payloadBytes: Buffer.byteLength(JSON.stringify(result)),
      durationMs: Date.now() - startedAt,
    })

    return reply.send(result)
  }
}
