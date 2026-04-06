import type { FastifyInstance } from 'fastify'
import type { DashboardController } from './dashboard.controller.js'
import { requireAuth, requireAdmin } from '../../shared/guards.js'

interface DashboardStatsQuery {
  periodDays?: string
}

export async function dashboardRoutes(app: FastifyInstance, controller: DashboardController) {
  app.get<{ Querystring: DashboardStatsQuery }>(
    '/stats',
    { preHandler: [requireAuth, requireAdmin] },
    (req, rep) => controller.getStats(req, rep),
  )
}
