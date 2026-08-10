import type { FastifyInstance } from 'fastify'
import type { OidcAuthController } from './oidc-auth.controller.js'

const slug = { type: 'string', minLength: 1, maxLength: 80 } as const

export async function oidcAuthRoutes(app: FastifyInstance, controller: OidcAuthController) {
  app.get<{ Querystring: { tenantSlug?: string } }>('/config', {
    schema: {
      tags: ['Auth'],
      summary: 'Obter provedor OIDC público do tenant',
      querystring: { type: 'object', properties: { tenantSlug: slug } },
    },
  }, (request, reply) => controller.config(request, reply))

  app.post<{ Body: { tenantSlug?: string } }>('/start', {
    schema: {
      tags: ['Auth'],
      summary: 'Iniciar login OIDC com PKCE',
      body: { type: 'object', properties: { tenantSlug: slug } },
    },
  }, (request, reply) => controller.begin(request, reply))

  app.post<{ Body: { state: string; code: string } }>('/complete', {
    schema: {
      tags: ['Auth'],
      summary: 'Concluir login OIDC e emitir sessão',
      body: {
        type: 'object',
        required: ['state', 'code'],
        properties: {
          state: { type: 'string', minLength: 20, maxLength: 200 },
          code: { type: 'string', minLength: 1, maxLength: 4096 },
        },
      },
    },
  }, (request, reply) => controller.complete(request, reply))
}
