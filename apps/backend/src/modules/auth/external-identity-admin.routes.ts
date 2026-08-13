import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { ExternalIdentityAdminController } from './external-identity-admin.controller.js'

const tag = ['OIDC']

export async function externalIdentityAdminRoutes(
  app: FastifyInstance,
  controller: ExternalIdentityAdminController,
): Promise<void> {
  app.get('/identities', {
    schema: {
      tags: tag,
      summary: 'Listar vínculos de identidade externa',
      description: 'Lista vínculos ativos e revogados do tenant sem expor subject ou tokens do provedor.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: requireAdmin,
    handler: controller.list.bind(controller),
  })

  app.post<{ Params: { id: number } }>('/identities/:id/revoke', {
    schema: {
      tags: tag,
      summary: 'Revogar vínculo de identidade externa',
      description: 'Revoga o vínculo, impede religação automática e invalida as sessões renováveis do usuário.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } },
      },
    },
    preHandler: requireAdmin,
    handler: controller.revoke.bind(controller),
  })

  app.get('/link-requests', {
    schema: {
      tags: tag,
      summary: 'Listar solicitações de vínculo OIDC',
      description: 'Lista solicitações de vínculo sem expor subject ou tokens do provedor.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: requireAdmin,
    handler: controller.listLinkRequests.bind(controller),
  })

  app.post<{ Params: { id: number }; Body: { decision: 'approve' | 'reject' } }>('/link-requests/:id/review', {
    schema: {
      tags: tag,
      summary: 'Revisar solicitação de vínculo OIDC',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } },
      },
      body: {
        type: 'object', additionalProperties: false, required: ['decision'],
        properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
      },
    },
    preHandler: requireAdmin,
    handler: controller.reviewLinkRequest.bind(controller),
  })
}
