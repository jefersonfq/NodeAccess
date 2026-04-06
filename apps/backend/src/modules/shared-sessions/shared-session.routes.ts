import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type {
  CreateSharedSessionDto,
  DenySharedSessionControlDto,
  GrantSharedSessionControlDto,
  RevokeSharedSessionControlDto,
  RequestSharedSessionControlDto,
} from '@nodeaccess/shared'
import type { SharedSessionController } from './shared-session.controller.js'

interface SharedSessionIdParam { id: string }
interface SharedSessionTokenParam { token: string }
interface SharedSessionControlTargetParam extends SharedSessionIdParam { userId: string }

export async function sharedSessionRoutes(app: FastifyInstance, controller: SharedSessionController): Promise<void> {
  app.post('/', { preHandler: [requireAuth] }, (req, rep) =>
    controller.create(req as never as import('fastify').FastifyRequest<{ Body: CreateSharedSessionDto }>, rep))

  app.get('/:id', { preHandler: [requireAuth] }, (req, rep) =>
    controller.getById(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam }>, rep))

  app.post('/:token/resolve', { preHandler: [requireAuth] }, (req, rep) =>
    controller.resolve(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionTokenParam }>, rep))

  app.delete('/:id', { preHandler: [requireAuth] }, (req, rep) =>
    controller.revoke(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam }>, rep))

  app.post('/:id/control/request', { preHandler: [requireAuth] }, (req, rep) =>
    controller.requestControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam; Body: RequestSharedSessionControlDto }>, rep))

  app.post('/:id/control/grant/:userId', { preHandler: [requireAuth] }, (req, rep) =>
    controller.grantControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionControlTargetParam; Body: GrantSharedSessionControlDto }>, rep))

  app.post('/:id/control/deny/:userId', { preHandler: [requireAuth] }, (req, rep) =>
    controller.denyControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionControlTargetParam; Body: DenySharedSessionControlDto }>, rep))

  app.post('/:id/control/revoke', { preHandler: [requireAuth] }, (req, rep) =>
    controller.revokeControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam; Body: RevokeSharedSessionControlDto }>, rep))
}
