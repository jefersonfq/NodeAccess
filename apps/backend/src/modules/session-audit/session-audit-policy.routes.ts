import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAdmin } from '../../shared/guards.js'
import { SessionAuditPolicyPublicSchema, UpdateSessionAuditPolicySchema } from '@nodeaccess/shared'
import type { UpdateSessionAuditPolicyDto } from '@nodeaccess/shared'
import type { SessionAuditPolicyController } from './session-audit-policy.controller.js'

const tag = ['SessionAudit']

export async function sessionAuditPolicyRoutes(app: FastifyInstance, controller: SessionAuditPolicyController) {
  app.get('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Ler política de auditoria de sessão do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(SessionAuditPolicyPublicSchema) },
    },
  }, (request, reply) => controller.get(request, reply))

  app.put<{ Body: UpdateSessionAuditPolicyDto }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar política de auditoria de sessão do tenant',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(UpdateSessionAuditPolicySchema),
      response: { 200: zodToJsonSchema(SessionAuditPolicyPublicSchema) },
    },
  }, (request, reply) => controller.update(request, reply))
}
