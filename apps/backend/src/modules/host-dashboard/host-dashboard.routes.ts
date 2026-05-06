import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { HostDashboardSchema } from '@nodeaccess/shared'
import { requireAuth } from '../../shared/guards.js'
import type { HostDashboardController } from './host-dashboard.controller.js'

interface HostDashboardParams {
  id: string
}

interface HostDashboardQuery {
  periodDays?: string
  forceRefresh?: string
}

export async function hostDashboardRoutes(app: FastifyInstance, controller: HostDashboardController): Promise<void> {
  app.get<{ Params: HostDashboardParams; Querystring: HostDashboardQuery }>('/:id/dashboard', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Hosts'],
      summary: 'Dashboard historico do host',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
      querystring: {
        type: 'object',
        properties: {
          periodDays: { type: 'integer', enum: [7, 15, 30, 60], default: 30 },
          forceRefresh: { type: 'string', enum: ['true', 'false'] },
        },
      },
      response: { 200: zodToJsonSchema(HostDashboardSchema) },
    },
  }, (request, reply) => controller.getDashboard(request, reply))
}
