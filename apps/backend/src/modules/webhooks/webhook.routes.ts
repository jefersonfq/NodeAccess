import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CreateWebhookSubscriptionSchema,
  UpdateWebhookSubscriptionSchema,
  WebhookSubscriptionPublicSchema,
  WebhookDeliveryPublicSchema,
} from '@nodeaccess/shared'
import { requireAdmin } from '../../shared/guards.js'
import type { WebhookController } from './webhook.controller.js'

const tag               = ['Webhooks']
const subPublicSchema   = zodToJsonSchema(WebhookSubscriptionPublicSchema) as any
const deliverySchema    = zodToJsonSchema(WebhookDeliveryPublicSchema) as any
const createBodySchema  = zodToJsonSchema(CreateWebhookSubscriptionSchema) as any
const updateBodySchema  = zodToJsonSchema(UpdateWebhookSubscriptionSchema) as any
createBodySchema.examples = [
  {
    name: 'Incidentes e acessos sensiveis',
    description: 'Envia eventos relevantes do NodeAccess para o barramento interno',
    targetUrl: 'https://integrador.example.com/nodeaccess/webhooks',
    httpMethod: 'POST',
    subscribedEvents: [
      'ssh_session.started',
      'ssh_session.ended',
      'host.updated',
      'diagnostic_run.completed',
    ],
    secret: 'segredo-hmac-com-ao-menos-8-caracteres',
    timeoutMs: 5000,
    maxRetries: 5,
    payloadMode: 'AUTOMATIC',
  },
]

export async function webhookRoutes(app: FastifyInstance, controller: WebhookController): Promise<void> {
  app.get('/subscriptions', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar webhook subscriptions do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: subPublicSchema } },
    },
    handler: controller.listSubscriptions.bind(controller),
  })

  ;(app as any).post('/subscriptions', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Criar webhook subscription',
      security: [{ bearerAuth: [] }],
      body: createBodySchema,
      response: { 200: subPublicSchema },
    },
    handler: controller.createSubscription.bind(controller),
  })

  ;(app as any).patch('/subscriptions/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar webhook subscription',
      security: [{ bearerAuth: [] }],
      body: updateBodySchema,
      response: { 200: subPublicSchema },
    },
    handler: controller.updateSubscription.bind(controller),
  })

  ;(app as any).post('/subscriptions/:id/pause', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Pausar webhook subscription',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.pauseSubscription.bind(controller),
  })

  ;(app as any).post('/subscriptions/:id/activate', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reativar webhook subscription',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.activateSubscription.bind(controller),
  })

  ;(app as any).post('/subscriptions/:id/rotate-secret', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Rotacionar segredo HMAC',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: { secret: { type: 'string' } },
          required: ['secret'],
        },
      },
    },
    handler: controller.rotateSecret.bind(controller),
  })

  ;(app as any).delete('/subscriptions/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Remover webhook subscription',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.deleteSubscription.bind(controller),
  })

  ;(app as any).get('/subscriptions/:id/deliveries', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar entregas de uma subscription',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD'] },
        },
      },
      response: { 200: { type: 'array', items: deliverySchema } },
    },
    handler: controller.listDeliveries.bind(controller),
  })

  ;(app as any).post('/subscriptions/:id/deliveries/:deliveryId/retry', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reenviar entrega morta',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.retryDelivery.bind(controller),
  })

  ;(app as any).post('/subscriptions/:id/test', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Testar entrega de webhook',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            ok:        { type: 'boolean' },
            status:    { type: 'integer', nullable: true },
            latencyMs: { type: 'integer' },
            snippet:   { type: 'string', nullable: true },
            error:     { type: 'string', nullable: true },
          },
          required: ['ok', 'status', 'latencyMs', 'snippet', 'error'],
        },
      },
    },
    handler: controller.testDelivery.bind(controller),
  })
}
