import type { ControllerRoute } from '../../shared/controller-route.js'
import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from '../../shared/zod-json-schema.js'
import {
  CreateWebhookSubscriptionSchema,
  UpdateWebhookSubscriptionSchema,
  WebhookSubscriptionPublicSchema,
  WebhookDeliveryPublicSchema,
} from '@nodeaccess/shared'
import { requireAdmin } from '../../shared/guards.js'
import type { WebhookController } from './webhook.controller.js'

const tag               = ['Webhooks']
const subPublicSchema   = zodToJsonSchema(WebhookSubscriptionPublicSchema)
const deliverySchema    = zodToJsonSchema(WebhookDeliveryPublicSchema)
const createBodySchema  = zodToJsonSchema(CreateWebhookSubscriptionSchema)
const updateBodySchema  = zodToJsonSchema(UpdateWebhookSubscriptionSchema)
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

export function webhookRoutes(app: FastifyInstance, controller: WebhookController): Promise<void> {
  app.get<ControllerRoute<WebhookController['listSubscriptions']>>('/subscriptions', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar webhook subscriptions do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: subPublicSchema } },
    },
    handler: controller.listSubscriptions.bind(controller),
  })

  ;app.post<ControllerRoute<WebhookController['createSubscription']>>('/subscriptions', {
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

  ;app.patch<ControllerRoute<WebhookController['updateSubscription']>>('/subscriptions/:id', {
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

  ;app.post<ControllerRoute<WebhookController['pauseSubscription']>>('/subscriptions/:id/pause', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Pausar webhook subscription',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.pauseSubscription.bind(controller),
  })

  ;app.post<ControllerRoute<WebhookController['activateSubscription']>>('/subscriptions/:id/activate', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reativar webhook subscription',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.activateSubscription.bind(controller),
  })

  ;app.post<ControllerRoute<WebhookController['rotateSecret']>>('/subscriptions/:id/rotate-secret', {
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

  ;app.delete<ControllerRoute<WebhookController['deleteSubscription']>>('/subscriptions/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Remover webhook subscription',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.deleteSubscription.bind(controller),
  })

  ;app.get<ControllerRoute<WebhookController['listDeliveries']>>('/subscriptions/:id/deliveries', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar entregas de uma subscription',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          beforeId: { type: 'integer', minimum: 1 },
          status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'RETRY_SCHEDULED', 'DEAD'] },
        },
      },
      response: { 200: { type: 'array', items: deliverySchema } },
    },
    handler: controller.listDeliveries.bind(controller),
  })

  ;app.post<ControllerRoute<WebhookController['retryDelivery']>>('/subscriptions/:id/deliveries/:deliveryId/retry', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reenviar entrega morta',
      security: [{ bearerAuth: [] }],
      response: { 204: { type: 'null', description: 'No content' } },
    },
    handler: controller.retryDelivery.bind(controller),
  })

  ;app.post<ControllerRoute<WebhookController['testDelivery']>>('/subscriptions/:id/test', {
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
  return Promise.resolve()
}
