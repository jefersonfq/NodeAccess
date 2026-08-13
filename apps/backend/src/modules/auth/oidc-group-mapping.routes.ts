import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { OidcGroupMappingController } from './oidc-group-mapping.controller.js'

export async function oidcGroupMappingRoutes(app: FastifyInstance, controller: OidcGroupMappingController): Promise<void> {
  app.get('/group-mappings', { preHandler: requireAdmin, handler: controller.list.bind(controller) })
  app.post('/group-mappings', { preHandler: requireAdmin, handler: controller.create.bind(controller) })
  app.delete<{ Params: { id: number } }>('/group-mappings/:id', {
    preHandler: requireAdmin,
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } } },
    handler: controller.delete.bind(controller),
  })
}
