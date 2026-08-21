import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireLiveSessionsViewer } from '../../shared/guards.js'
import type { SessionsController } from './sessions.controller.js'

interface SessionQuery {
  page?: number
  limit?: number
  search?: string
  active?: string
  connectionMethod?: string
  accessType?: string
  hostState?: string
  hostId?: number
  userId?: number
  periodDays?: number
  dateFrom?: string
  dateTo?: string
  hasError?: string
  originIp?: string
  sortBy?: string
  sortDirection?: string
}

export async function sessionsRoutes(app: FastifyInstance, controller: SessionsController): Promise<void> {
  /** GET /api/v1/sessions/access-map — presenca de sessoes abertas em tempo quase real */
  app.get('/access-map', {
    preHandler: [requireLiveSessionsViewer],
    schema: {
      tags:     ['Sessions'],
      summary:  'Sessoes abertas em tempo quase real',
      security: [{ bearerAuth: [] }],
    },
  }, (request, reply) => controller.accessMap(request, reply))

  app.get('/filter-options', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Sessions'],
      summary: 'Opções de filtro do histórico de sessões',
      security: [{ bearerAuth: [] }],
    },
  }, (request, reply) => controller.filterOptions(request, reply))

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
          connectionMethod: { type: 'string', enum: ['direct', 'user_agent', 'tenant_agent', 'private_access_connector', 'telnet_direct', 'telnet_user_agent', 'telnet_tenant_agent', 'native_ssh_gateway', 'rdp_gateway_pending', 'vnc_gateway_pending'] },
          accessType: { type: 'string', enum: ['authenticated', 'jit_public_link'] },
          hostState: { type: 'string', enum: ['active', 'deleted'] },
          hostId: { type: 'integer', minimum: 1 },
          userId: { type: 'integer', minimum: 1 },
          periodDays: { type: 'integer', enum: [7, 15, 30, 60] },
          dateFrom: { type: 'string', format: 'date-time' },
          dateTo: { type: 'string', format: 'date-time' },
          hasError: { type: 'string', enum: ['true', 'false'] },
          originIp: { type: 'string' },
          sortBy: { type: 'string', enum: ['user', 'host', 'startedAt', 'endedAt', 'duration', 'connectionMethod', 'active'] },
          sortDirection: { type: 'string', enum: ['asc', 'desc'] },
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

  /** POST /api/v1/sessions/:sessionId/close — encerra uma sessão ativa pelo runtime (admin) */
  app.post<{ Params: { sessionId: string } }>('/:sessionId/close', {
    preHandler: [requireAdmin],
    schema: {
      tags:     ['Sessions'],
      summary:  'Encerrar sessão ativa pelo runtime (admin)',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, (request, reply) => controller.close(request, reply))
}
