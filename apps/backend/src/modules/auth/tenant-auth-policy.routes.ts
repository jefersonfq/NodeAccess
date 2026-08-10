import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  TenantAuthPolicyPublicSchema,
  TenantAuthPolicySchema,
  BreakGlassStatusSchema,
  ValidateBreakGlassSchema,
  type TenantAuthPolicyDto,
  type ValidateBreakGlassDto,
} from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { TenantAuthPolicyController } from './tenant-auth-policy.controller.js'

export async function tenantAuthPolicyRoutes(app: FastifyInstance, controller: TenantAuthPolicyController) {
  app.get('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['AuthPolicy'],
      summary: 'Obter política de autenticação do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(TenantAuthPolicyPublicSchema) },
    },
  }, (request, reply) => controller.get(request, reply))

  app.put<{ Body: TenantAuthPolicyDto }>('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['AuthPolicy'],
      summary: 'Atualizar política de autenticação do tenant',
      description: 'Persiste a política solicitada e retorna os valores efetivos limitados pela instalação. A aplicação no login é ativada em etapa separada.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(TenantAuthPolicySchema),
      response: { 200: zodToJsonSchema(TenantAuthPolicyPublicSchema) },
    },
  }, (request, reply) => controller.update(request, reply))

  app.get('/break-glass', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: ['AuthPolicy'], security: [{ bearerAuth: [] }], response: { 200: zodToJsonSchema(BreakGlassStatusSchema) } },
  }, (request, reply) => controller.getBreakGlass(request, reply))

  app.post<{ Body: ValidateBreakGlassDto }>('/break-glass/validate', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: ['AuthPolicy'], security: [{ bearerAuth: [] }], body: zodToJsonSchema(ValidateBreakGlassSchema), response: { 200: zodToJsonSchema(BreakGlassStatusSchema) } },
  }, (request, reply) => controller.validateBreakGlass(request, reply))
}
