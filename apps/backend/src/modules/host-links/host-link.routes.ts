import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { HostLinkController } from './host-link.controller.js'
import type { CreateHostLinkDto } from '@nodeaccess/shared'

interface HostLinkIdParam { id: string }
interface HostLinkTokenParam { token: string }

export async function hostLinkRoutes(app: FastifyInstance, controller: HostLinkController): Promise<void> {
  app.post('/', { preHandler: [requireAuth] }, (req, rep) =>
    controller.create(req as never as import('fastify').FastifyRequest<{ Body: CreateHostLinkDto }>, rep))

  app.get('/:token/resolve', { preHandler: [requireAuth] }, (req, rep) =>
    controller.resolve(req as never as import('fastify').FastifyRequest<{ Params: HostLinkTokenParam }>, rep))

  app.delete('/:id', { preHandler: [requireAuth] }, (req, rep) =>
    controller.revoke(req as never as import('fastify').FastifyRequest<{ Params: HostLinkIdParam }>, rep))
}
