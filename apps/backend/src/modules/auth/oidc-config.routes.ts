import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  OidcConfigPublicSchema,
  RotateOidcClientSecretSchema,
  UpsertOidcSchema,
  type RotateOidcClientSecretDto,
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

  app.post<{ Body: { issuer: string } }>('/test-discovery', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Integrations'],
      summary: 'Testar discovery do provedor OIDC',
      description: 'Valida issuer, endpoints obrigatórios, HTTPS e algoritmos suportados sem persistir a configuração.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['issuer'],
        properties: { issuer: { type: 'string', format: 'uri' } },
      },
      response: {
        200: {
          type: 'object',
          required: ['ok', 'issuer', 'authorizationEndpoint', 'tokenEndpoint', 'jwksUri', 'checkedAt'],
          properties: {
            ok: { type: 'boolean', const: true },
            issuer: { type: 'string' },
            authorizationEndpoint: { type: 'string' },
            tokenEndpoint: { type: 'string' },
            jwksUri: { type: 'string' },
            checkedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, (request, reply) => controller.testDiscovery(request, reply))

  app.post<{ Body: RotateOidcClientSecretDto }>('/rotate-client-secret', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Integrations'],
      summary: 'Rotacionar client secret OIDC',
      description: 'Substitui somente o client secret, preservando a configuração e sem retornar o segredo.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(RotateOidcClientSecretSchema),
      response: { 200: zodToJsonSchema(OidcConfigPublicSchema) },
    },
  }, (request, reply) => controller.rotateClientSecret(request, reply))
}
