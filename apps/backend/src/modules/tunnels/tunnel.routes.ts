import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { TunnelController } from './tunnel.controller.js'

const tag = ['Tunnels']

export async function tunnelRoutes(app: FastifyInstance, ctrl: TunnelController): Promise<void> {
  /** GET /api/v1/tunnels */
  app.get('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Listar túneis ativos', security: [{ bearerAuth: [] }] },
    handler: ctrl.list.bind(ctrl),
  })

  /** POST /api/v1/tunnels/test */
  app.post('/test', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Testar destino interno de port forwarding',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['hostId', 'remoteHost', 'remotePort'],
        properties: {
          hostId:     { type: 'integer' },
          remoteHost: { type: 'string', minLength: 1 },
          remotePort: { type: 'integer', minimum: 1, maximum: 65535 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['success', 'message', 'latencyMs', 'connectionMethod'],
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            latencyMs: { type: ['integer', 'null'] },
            connectionMethod: { type: 'string', enum: ['direct', 'user_agent', 'tenant_agent', 'private_access_connector'] },
          },
        },
      },
    },
    handler: ctrl.test.bind(ctrl),
  })

  /** POST /api/v1/tunnels */
  app.post('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar túnel SSH (port forwarding)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['hostId', 'localPort', 'remoteHost', 'remotePort'],
        properties: {
          hostId:     { type: 'integer' },
          bindAddress: { type: 'string', enum: ['127.0.0.1', '0.0.0.0'] },
          description: { type: 'string' },
          localPort:  { type: 'integer', minimum: 1024, maximum: 65535 },
          remoteHost: { type: 'string', minLength: 1 },
          remotePort: { type: 'integer', minimum: 1, maximum: 65535 },
        },
      },
    },
    handler: ctrl.create.bind(ctrl),
  })

  /** DELETE /api/v1/tunnels/:id */
  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Encerrar túnel',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    handler: ctrl.close.bind(ctrl),
  })
}
