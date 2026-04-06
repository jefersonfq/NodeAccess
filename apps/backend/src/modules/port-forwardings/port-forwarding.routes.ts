import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { PortForwardingController } from './port-forwarding.controller.js'

const tag = ['PortForwardings']

export async function portForwardingRoutes(app: FastifyInstance, ctrl: PortForwardingController): Promise<void> {
  const hostParam = {
    type: 'object',
    properties: { hostId: { type: 'integer' } },
    required: ['hostId'],
  }
  const idParam = {
    type: 'object',
    properties: { id: { type: 'integer' } },
    required: ['id'],
  }

  app.get('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Listar todos os forwardings do tenant', security: [{ bearerAuth: [] }] },
    handler: ctrl.listAll.bind(ctrl),
  })

  app.get('/:hostId', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Listar forwardings do host', security: [{ bearerAuth: [] }], params: hostParam },
    handler: ctrl.list.bind(ctrl),
  })

  app.post('/:hostId', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Criar forwarding', security: [{ bearerAuth: [] }], params: hostParam,
      body: {
        type: 'object',
        required: ['localPort', 'remoteHost', 'remotePort'],
        properties: {
          description: { type: 'string' },
          bindAddress: { type: 'string', enum: ['127.0.0.1', '0.0.0.0'] },
          webEnabled:  { type: 'boolean' },
          webProtocol: { type: 'string', enum: ['http', 'https'] },
          localPort:   { type: 'integer', minimum: 1024, maximum: 65535 },
          remoteHost:  { type: 'string' },
          remotePort:  { type: 'integer', minimum: 1, maximum: 65535 },
          autoStart:   { type: 'boolean' },
        },
      },
    },
    handler: ctrl.create.bind(ctrl),
  })

  app.patch('/:hostId/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Atualizar forwarding', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { hostId: { type: 'integer' }, id: { type: 'integer' } }, required: ['hostId', 'id'] },
      body: {
        type: 'object',
        properties: {
          description: { type: ['string', 'null'] },
          bindAddress: { type: 'string', enum: ['127.0.0.1', '0.0.0.0'] },
          webEnabled:  { type: 'boolean' },
          webProtocol: { type: 'string', enum: ['http', 'https'] },
          localPort:   { type: 'integer', minimum: 1024, maximum: 65535 },
          remoteHost:  { type: 'string' },
          remotePort:  { type: 'integer', minimum: 1, maximum: 65535 },
          autoStart:   { type: 'boolean' },
        },
      },
    },
    handler: ctrl.update.bind(ctrl),
  })

  app.delete('/:hostId/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Remover forwarding', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { hostId: { type: 'integer' }, id: { type: 'integer' } }, required: ['hostId', 'id'] },
    },
    handler: ctrl.remove.bind(ctrl),
  })
}
