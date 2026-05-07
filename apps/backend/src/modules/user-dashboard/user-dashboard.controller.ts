import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserDashboardPeriodDays } from '@nodeaccess/shared'
import type { UserDashboardService } from './user-dashboard.service.js'

interface UserDashboardQuery {
  periodDays?: string
  userId?: string
  forceRefresh?: string
}

const allowedPeriods = [7, 15, 30, 60] as const

export class UserDashboardController {
  constructor(private readonly userDashboardService: UserDashboardService) {}

  async getDashboard(request: FastifyRequest<{ Querystring: UserDashboardQuery }>, reply: FastifyReply) {
    const startedAt = Date.now()
    const requestedPeriod = Number(request.query.periodDays)
    const periodDays = (allowedPeriods as readonly number[]).includes(requestedPeriod)
      ? (requestedPeriod as UserDashboardPeriodDays)
      : 30

    const viewerUserId = Number(request.jwtUser!.sub)
    const viewerRole = request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER'
    const tenantId = request.jwtUser!.tenantId

    const targetUserId =
      viewerRole === 'ADMIN' && request.query.userId ? Number(request.query.userId) : viewerUserId

    const dashboard = await this.userDashboardService.getDashboard({
      targetUserId,
      viewerUserId,
      tenantId,
      viewerRole,
      periodDays,
      forceRefresh: request.query.forceRefresh === 'true',
    })

    request.log.info({
      event: 'user-dashboard.get',
      tenantId,
      viewerUserId,
      targetUserId,
      periodDays,
      cacheHit: dashboard.cache.hit,
      payloadBytes: Buffer.byteLength(JSON.stringify(dashboard)),
      durationMs: Date.now() - startedAt,
    })

    return reply.send(dashboard)
  }

  async getSummary(request: FastifyRequest, reply: FastifyReply) {
    const startedAt = Date.now()
    const userId = Number(request.jwtUser!.sub)
    const summary = await this.userDashboardService.getSummary(request.jwtUser!.tenantId, userId)
    request.log.info({
      event: 'user-dashboard.summary',
      userId,
      payloadBytes: Buffer.byteLength(JSON.stringify(summary)),
      durationMs: Date.now() - startedAt,
    })
    return reply.send(summary)
  }
}
