import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { TagController } from './tag.controller.js'
import { requireAuth } from '../../shared/guards.js'

export async function tagRoutes(app: FastifyInstance, controller: TagController) {
  app.get('/', { preHandler: [requireAuth] }, (req, rep) => controller.list(req, rep))
  app.delete('/:id', { preHandler: [requireAuth] }, (req, rep) => controller.delete(req as FastifyRequest<{ Params: { id: string } }>, rep))
}
