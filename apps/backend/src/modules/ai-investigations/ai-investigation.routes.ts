import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from '../../shared/zod-json-schema.js'
import { AiInvestigationSchema, CompleteAiInvestigationSchema } from '@nodeaccess/shared'
import { requireAdmin } from '../../shared/guards.js'
import type { AiInvestigationController } from './ai-investigation.controller.js'
const params = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }
export function aiInvestigationRoutes(app: FastifyInstance, controller: AiInvestigationController) : Promise<void> {
  app.get('/', { preHandler: [requireAdmin], schema: { tags: ['AiInvestigations'], security: [{ bearerAuth: [] }] } }, (r,p) => controller.list(r,p))
  app.get<{ Params:{id:string} }>('/:id', { preHandler: [requireAdmin], schema: { tags: ['AiInvestigations'], security: [{ bearerAuth: [] }], params, response: { 200: zodToJsonSchema(AiInvestigationSchema) } } }, (r,p) => controller.get(r,p))
  app.post<{ Params:{id:string}; Body: Parameters<AiInvestigationController['complete']>[0]['body'] }>('/:id/complete', { preHandler: [requireAdmin], schema: { tags: ['AiInvestigations'], security: [{ bearerAuth: [] }], params, body: zodToJsonSchema(CompleteAiInvestigationSchema) } }, (r,p) => controller.complete(r,p))
  app.post<{ Params:{id:string} }>('/:id/abandon', { preHandler: [requireAdmin], schema: { tags: ['AiInvestigations'], security: [{ bearerAuth: [] }], params } }, (r,p) => controller.abandon(r,p))
  return Promise.resolve()
}
