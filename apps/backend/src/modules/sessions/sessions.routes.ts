import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { SessionsController } from './sessions.controller.js'

interface SessionQuery {
  page?: number
  limit?: number
  search?: string
  active?: string
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
