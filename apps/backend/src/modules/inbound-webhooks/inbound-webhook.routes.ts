import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CreateInboundWebhookEndpointSchema,
  InboundWebhookEndpointCreatedSchema,
  InboundWebhookEndpointPublicSchema,
  InboundWebhookIngestResultSchema,
  InboundWebhookReceiptPublicSchema,
  InboundWebhookReceiptStatusSchema,
  UpdateInboundWebhookEndpointSchema,
} from '@nodeaccess/shared'
import { requireAdmin } from '../../shared/guards.js'
import type { InboundWebhookController } from './inbound-webhook.controller.js'

const tag = ['InboundWebhooks']
const createBodySchema = zodToJsonSchema(CreateInboundWebhookEndpointSchema) as any
const updateBodySchema = zodToJsonSchema(UpdateInboundWebhookEndpointSchema) as any
const endpointSchema = zodToJsonSchema(InboundWebhookEndpointPublicSchema)
const endpointCreatedSchema = zodToJsonSchema(InboundWebhookEndpointCreatedSchema)
const receiptSchema = zodToJsonSchema(InboundWebhookReceiptPublicSchema)
const ingestResultSchema = zodToJsonSchema(InboundWebhookIngestResultSchema)
const receiptStatusSchema = zodToJsonSchema(InboundWebhookReceiptStatusSchema)

createBodySchema.examples = [
  {
    provider: 'monitoring',
    name: 'Monitoramento de hosts',
    description: 'Recebe eventos de indisponibilidade para registrar contexto operacional.',
    secret: 'segredo-hmac-com-ao-menos-8-caracteres',
    allowedEventTypes: ['host.unavailable', 'host.recovered'],
    mappingMode: 'GENERIC',
  },
]

export async function inboundWebhookRoutes(app: FastifyInstance, controller: InboundWebhookController): Promise<void> {
  app.get('/endpoints', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar endpoints inbound do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: endpointSchema } },
    },
    handler: controller.listEndpoints.bind(controller),
  })

  ;(app as any).post('/endpoints', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Criar endpoint inbound',
      description: 'Cria um receptor de eventos externos. O endpointToken e exibido apenas nesta resposta.',
      security: [{ bearerAuth: [] }],
      body: createBodySchema,
      response: { 200: endpointCreatedSchema },
    },
    handler: controller.createEndpoint.bind(controller),
  })

  ;(app as any).patch('/endpoints/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar endpoint inbound',
      security: [{ bearerAuth: [] }],
      body: updateBodySchema,
      response: { 200: endpointSchema },
    },
    handler: controller.updateEndpoint.bind(controller),
  })

  ;(app as any).post('/endpoints/:id/pause', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Pausar endpoint inbound',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.pauseEndpoint.bind(controller),
  })

  ;(app as any).post('/endpoints/:id/activate', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reativar endpoint inbound',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.activateEndpoint.bind(controller),
  })

  ;(app as any).post('/endpoints/:id/revoke', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Revogar endpoint inbound',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.revokeEndpoint.bind(controller),
  })

  ;(app as any).get('/endpoints/:id/receipts', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar recebimentos de um endpoint inbound',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: receiptStatusSchema,
        },
      },
      response: { 200: { type: 'array', items: receiptSchema } },
    },
    handler: controller.listReceipts.bind(controller),
  })

  ;(app as any).post('/:provider/:endpointToken', {
    schema: {
      tags: tag,
      summary: 'Receber evento externo inbound',
      description: 'Endpoint publico por token opaco. No primeiro corte apenas valida, deduplica e registra o recebimento.',
      body: {
        type: 'object',
        additionalProperties: true,
      },
      response: {
        202: ingestResultSchema,
        400: ingestResultSchema,
      },
    },
    config: { rawBody: false },
    bodyLimit: 1024 * 256,
    handler: controller.ingest.bind(controller),
  })
}
