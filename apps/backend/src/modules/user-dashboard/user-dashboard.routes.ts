import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { UserDashboardSchema, UserDashboardSummarySchema } from '@nodeaccess/shared'
import type { UserDashboardController } from './user-dashboard.controller.js'
import { requireAuth } from '../../shared/guards.js'

interface UserDashboardQuery {
  periodDays?: string
  userId?: string
  forceRefresh?: string
}

export async function userDashboardRoutes(app: FastifyInstance, controller: UserDashboardController) {
  app.get('/summary', {
    preHandler: [requireAuth],
    schema: {
      tags: ['UserDashboard'],
      summary: 'Resumo pessoal do usuario autenticado',
      description: 'Retorna resumo leve de atividade, favoritos e indicadores pessoais para uso em dashboard e atalhos da UI.',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(UserDashboardSummarySchema) },
    },
  }, (req, rep) => controller.getSummary(req, rep))

  app.get<{ Querystring: UserDashboardQuery }>('/dashboard', {
    preHandler: [requireAuth],
    schema: {
      tags: ['UserDashboard'],
      summary: 'Dashboard de atividade do usuario',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          periodDays: { type: 'integer', enum: [7, 15, 30, 60], default: 30 },
          userId: { type: 'integer' },
          forceRefresh: { type: 'string', enum: ['true', 'false'] },
        },
      },
      response: { 200: zodToJsonSchema(UserDashboardSchema) },
    },
  }, (req, rep) => controller.getDashboard(req, rep))
}
