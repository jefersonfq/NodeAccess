import type { FastifyInstance } from 'fastify'
import { requireAuth, requireAdmin } from '../../shared/guards.js'
import type {
  SessionAuditCommandsQuery,
  SessionAuditController,
  SessionAuditLinkTicketBody,
  SessionAuditParams,
  SessionAuditPreviewQuery,
  SessionAuditQuery,
  SessionAuditRetrySummaryBody,
} from './session-audit.controller.js'

export async function sessionAuditRoutes(app: FastifyInstance, controller: SessionAuditController) {
  app.get('/', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.list(req as never as import('fastify').FastifyRequest<{ Querystring: SessionAuditQuery }>, rep))
  app.get('/:sessionId', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.getBySessionId(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.get('/:sessionId/preview', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.preview(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Querystring: SessionAuditPreviewQuery }>, rep))
  app.get('/:sessionId/commands', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.commands(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Querystring: SessionAuditCommandsQuery }>, rep))
  app.get('/:sessionId/jobs', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.jobs(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.get('/:sessionId/artifacts', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.artifacts(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.post('/:sessionId/retry-summary', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.retrySummary(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Body: SessionAuditRetrySummaryBody }>, rep))
  app.post('/:sessionId/link-ticket', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.linkTicket(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Body: SessionAuditLinkTicketBody }>, rep))
  app.get('/:sessionId/download', { preHandler: [requireAuth, requireAdmin] }, (req, rep) => controller.download(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
}
