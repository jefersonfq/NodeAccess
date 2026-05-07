import type { FastifyReply, FastifyRequest } from 'fastify'
import type { HostDashboardPeriodDays } from '@nodeaccess/shared'
import type { HostDashboardService } from './host-dashboard.service.js'

interface HostDashboardParams {
  id: string
}

interface HostDashboardQuery {
  periodDays?: string
  forceRefresh?: string
}

const allowedPeriods = [7, 15, 30, 60] as const

export class HostDashboardController {
  constructor(private readonly service: HostDashboardService) {}

  async getDashboard(request: FastifyRequest<{ Params: HostDashboardParams; Querystring: HostDashboardQuery }>, reply: FastifyReply) {
    const requestedPeriod = Number(request.query.periodDays)
    const periodDays = (allowedPeriods as readonly number[]).includes(requestedPeriod)
      ? requestedPeriod as HostDashboardPeriodDays
      : 30

    const dashboard = await this.service.getDashboard({
      hostId: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      periodDays,
      forceRefresh: request.query.forceRefresh === 'true',
    })

    return reply.send(dashboard)
  }
}
