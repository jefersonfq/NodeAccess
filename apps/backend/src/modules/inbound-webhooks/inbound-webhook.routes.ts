import type { ControllerRoute } from '../../shared/controller-route.js'
import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from '../../shared/zod-json-schema.js'
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
const createBodySchema = zodToJsonSchema(CreateInboundWebhookEndpointSchema)
const updateBodySchema = zodToJsonSchema(UpdateInboundWebhookEndpointSchema)
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
  app.get<ControllerRoute<InboundWebhookController['listEndpoints']>>('/endpoints', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar endpoints inbound do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: endpointSchema } },
    },
    handler: controller.listEndpoints.bind(controller),
  })

  ;app.post<ControllerRoute<InboundWebhookController['createEndpoint']>>('/endpoints', {
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

  ;app.patch<ControllerRoute<InboundWebhookController['updateEndpoint']>>('/endpoints/:id', {
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

  ;app.post<ControllerRoute<InboundWebhookController['pauseEndpoint']>>('/endpoints/:id/pause', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Pausar endpoint inbound',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.pauseEndpoint.bind(controller),
  })

  ;app.post<ControllerRoute<InboundWebhookController['activateEndpoint']>>('/endpoints/:id/activate', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reativar endpoint inbound',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.activateEndpoint.bind(controller),
  })

  ;app.post<ControllerRoute<InboundWebhookController['revokeEndpoint']>>('/endpoints/:id/revoke', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Revogar endpoint inbound',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.revokeEndpoint.bind(controller),
  })

  ;app.get<ControllerRoute<InboundWebhookController['listReceipts']>>('/endpoints/:id/receipts', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar recebimentos de um endpoint inbound',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          beforeId: { type: 'integer', minimum: 1 },
          status: receiptStatusSchema,
        },
      },
      response: { 200: { type: 'array', items: receiptSchema } },
    },
    handler: controller.listReceipts.bind(controller),
  })

  app.post<{ Params: { id: string } }>('/endpoints/:id/rotate-credentials', {
    preHandler: [requireAdmin],
    schema: { tags: tag, security: [{ bearerAuth: [] }], response: { 200: { type: 'object', properties: { endpointToken: { type: 'string' }, secret: { type: 'string' } }, required: ['endpointToken', 'secret'] } } },
    handler: controller.rotateCredentials.bind(controller),
  })

  // Encapsulation keeps raw-body handling limited to public inbound ingestion.
  await app.register((receiver, _options, done) => {
    receiver.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
      const raw = body as string
      ;(request as typeof request & { inboundRawBody?: string }).inboundRawBody = raw
      void receiver.getDefaultJsonParser('error', 'error')(request, raw, (error, parsed) => {
        if (error) Object.assign(error, { statusCode: 400 })
        done(error, parsed)
      })
    })
  ;receiver.post<ControllerRoute<InboundWebhookController['ingest']>>('/:provider/:endpointToken', {
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
      },
    },
    bodyLimit: 1024 * 256,
    handler: controller.ingest.bind(controller),
  })
    done()
  })
}
