import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  OidcConfigPublicSchema,
  UpsertOidcSchema,
  type UpsertOidcDto,
} from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { OidcConfigController } from './oidc-config.controller.js'

export async function oidcConfigRoutes(app: FastifyInstance, controller: OidcConfigController) {
  app.get('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Integrations'],
      summary: 'Obter configuração OIDC do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(OidcConfigPublicSchema) },
    },
  }, (request, reply) => controller.get(request, reply))

  app.put<{ Body: UpsertOidcDto }>('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Integrations'],
      summary: 'Configurar provedor OIDC do tenant',
      description: 'Armazena o client secret cifrado e nunca o retorna na resposta.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(UpsertOidcSchema),
      response: { 200: zodToJsonSchema(OidcConfigPublicSchema) },
    },
  }, (request, reply) => controller.update(request, reply))
}
