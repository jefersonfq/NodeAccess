import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { SessionsController } from './sessions.controller.js'

interface SessionQuery {
  page?: number
  limit?: number
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

export async function sessionsRoutes(app: FastifyInstance, controller: SessionsController): Promise<void> {
  /** GET /api/v1/sessions — histórico de sessões SSH (admin) */
  app.get<{ Querystring: SessionQuery }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags:     ['Sessions'],
      summary:  'Listar sessões SSH (admin)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'integer', minimum: 1 },
          limit:  { type: 'integer', minimum: 1, maximum: 100 },
          search: { type: 'string' },
          active: { type: 'string', enum: ['true', 'false'] },
          connectionMethod: { type: 'string', enum: ['direct', 'user_agent', 'tenant_agent'] },
          hostState: { type: 'string', enum: ['active', 'deleted'] },
          hostId: { type: 'integer', minimum: 1 },
          periodDays: { type: 'integer', enum: [7, 15, 30, 60] },
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          hasError: { type: 'string', enum: ['true', 'false'] },
          originIp: { type: 'string' },
        },
      },
    },
  }, (request, reply) => controller.list(request, reply))

  /** POST /api/v1/sessions/cleanup — encerra sessões fantasma (admin) */
  app.post('/cleanup', {
    preHandler: [requireAdmin],
    schema: {
      tags:     ['Sessions'],
      summary:  'Encerrar sessões ativas fantasma (admin)',
      security: [{ bearerAuth: [] }],
    },
  }, (request, reply) => controller.cleanup(request, reply))
}
