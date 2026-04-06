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
