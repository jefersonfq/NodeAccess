import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserDashboardService } from './user-dashboard.service.js'

export class UserDashboardController {
  constructor(private readonly userDashboardService: UserDashboardService) {}

  async getSummary(request: FastifyRequest, reply: FastifyReply) {
    const userId = Number(request.jwtUser!.sub)
    const summary = await this.userDashboardService.getSummary(userId)
    return reply.send(summary)
  }
}
