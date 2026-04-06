import type { FastifyRequest, FastifyReply } from 'fastify'
import type { DashboardService } from './dashboard.service.js'

interface DashboardStatsQuery {
  periodDays?: string
}

export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  async getStats(request: FastifyRequest<{ Querystring: DashboardStatsQuery }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const requestedDays = Number(request.query.periodDays)
    const allowedDays = [7, 30, 90]
    const periodDays = allowedDays.includes(requestedDays) ? requestedDays : 30
    const stats = await this.dashboardService.getStats(tenantId, periodDays)
    return reply.send(stats)
  }
}
