import type { FastifyInstance } from 'fastify'
import type { UserDashboardController } from './user-dashboard.controller.js'
import { requireAuth } from '../../shared/guards.js'

export async function userDashboardRoutes(app: FastifyInstance, controller: UserDashboardController) {
  app.get('/summary', { preHandler: [requireAuth] }, (req, rep) => controller.getSummary(req, rep))
}
