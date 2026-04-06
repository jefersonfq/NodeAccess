import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { WebAccessController } from './web-access.controller.js'

const tag = ['WebAccess']

export async function webAccessRoutes(app: FastifyInstance, ctrl: WebAccessController): Promise<void> {
  app.post('/:forwardingId/link', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Gerar link temporário de acesso web para forwarding',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { forwardingId: { type: 'integer' } },
        required: ['forwardingId'],
      },
    },
    handler: ctrl.createLink.bind(ctrl),
  })

  app.get('/proxy', {
    schema: { tags: tag, summary: 'Proxy autenticado para acesso web raiz' },
    handler: ctrl.proxy.bind(ctrl),
  })

  app.post('/proxy', {
    schema: { tags: tag, summary: 'Proxy autenticado para acesso web raiz (POST)' },
    handler: ctrl.proxy.bind(ctrl),
  })

  app.get('/proxy/*', {
    schema: { tags: tag, summary: 'Proxy autenticado para acesso web' },
    handler: ctrl.proxy.bind(ctrl),
  })

  app.post('/proxy/*', {
    schema: { tags: tag, summary: 'Proxy autenticado para acesso web (POST)' },
    handler: ctrl.proxy.bind(ctrl),
  })
}
