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

const tag = ['SessionAudit']

export async function sessionAuditRoutes(app: FastifyInstance, controller: SessionAuditController) {
  app.get('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar auditorias de sessoes SSH',
      description: 'Lista sessoes auditadas do tenant para investigacao, compliance e suporte administrativo.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.list(req as never as import('fastify').FastifyRequest<{ Querystring: SessionAuditQuery }>, rep))
  app.get('/:sessionId', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Detalhar auditoria de sessao SSH',
      description: 'Retorna metadados, postura, resumo e contexto auditavel de uma sessao SSH.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.getBySessionId(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.get('/:sessionId/preview', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Visualizar preview textual da sessao',
      description: 'Retorna trecho textual da captura da sessao para revisao rapida sem baixar o artefato completo.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.preview(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Querystring: SessionAuditPreviewQuery }>, rep))
  app.get('/:sessionId/commands', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar comandos derivados da sessao',
      description: 'Retorna comandos reconstruidos a partir da captura SSH. Use o download bruto como trilha completa quando necessario.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.commands(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Querystring: SessionAuditCommandsQuery }>, rep))
  app.get('/:sessionId/command-stats', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Resumo de comandos derivados da sessao',
      description: 'Retorna totais de comandos reconstruidos e distribuicao por participante quando a sessao foi compartilhada.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.commandStats(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.get('/:sessionId/jobs', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar jobs de processamento da auditoria',
      description: 'Lista jobs relacionados a processamento, resumo ou enriquecimento de auditoria da sessao.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.jobs(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.get('/:sessionId/artifacts', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar artefatos da auditoria',
      description: 'Lista artefatos disponiveis para uma sessao auditada, como chunks ou arquivos processados.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.artifacts(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
  app.post('/:sessionId/retry-summary', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Reprocessar resumo da auditoria',
      description: 'Solicita nova tentativa de resumo/enriquecimento da auditoria sem alterar a sessao original.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.retrySummary(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Body: SessionAuditRetrySummaryBody }>, rep))
  app.post('/:sessionId/link-ticket', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Vincular ticket a auditoria de sessao',
      description: 'Associa uma sessao auditada a um ticket externo ou contexto operacional para investigacao e rastreabilidade.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.linkTicket(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams; Body: SessionAuditLinkTicketBody }>, rep))
  app.get('/:sessionId/download', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Baixar artefato bruto da auditoria',
      description: 'Baixa a trilha bruta auditavel da sessao SSH para revisao completa, compliance ou suporte.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.download(req as never as import('fastify').FastifyRequest<{ Params: SessionAuditParams }>, rep))
}
