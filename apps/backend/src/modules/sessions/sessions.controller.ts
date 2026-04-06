import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SessionsService } from './sessions.service.js'

interface SessionQuery {
  page?:   number
  limit?:  number
  search?: string
  active?: string
}

export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  async list(request: FastifyRequest<{ Querystring: SessionQuery }>, reply: FastifyReply) {
    const { page, limit, search, active } = request.query
    const tenantId = request.jwtUser!.tenantId

    const result = await this.sessionsService.list(tenantId, {
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
      ...(search !== undefined && { search }),
      ...(active !== undefined && { active: active === 'true' }),
    })

    return reply.send(result)
  }

  async cleanup(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const result   = await this.sessionsService.cleanupGhosts(tenantId)
    return reply.send(result)
  }
}
