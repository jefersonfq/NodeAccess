import type { FastifyInstance } from 'fastify'
import type { ReportsController } from './reports.controller.js'
import { requireAdmin, requireAuth } from '../../shared/guards.js'

const tag = ['Reports']

interface SnippetReportQuery {
  search?: string
  status?: string
  userId?: number
  snippetId?: number
  hostId?: number
  dateFrom?: string
  dateTo?: string
  periodDays?: number
  page?: number
  limit?: number
}

export async function reportsRoutes(app: FastifyInstance, controller: ReportsController) {
  app.get<{ Querystring: SnippetReportQuery }>(
    '/snippets',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: tag,
        summary: 'Relatorio de uso de snippets',
        description: 'Retorna metricas e linhas administrativas de uso de snippets no tenant.',
        security: [{ bearerAuth: [] }],
      },
    },
    (req, rep) => controller.getSnippetUsage(req, rep),
  )
  app.get<{ Querystring: SnippetReportQuery }>(
    '/sessions',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: tag,
        summary: 'Relatorio de uso de sessoes SSH',
        description: 'Retorna indicadores administrativos de sessoes SSH por periodo, usuario e host.',
        security: [{ bearerAuth: [] }],
      },
    },
    (req, rep) => controller.getSessionUsage(req, rep),
  )
  app.get<{ Querystring: SnippetReportQuery }>(
    '/ssh-tunnels',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: tag,
        summary: 'Relatorio de uso de tuneis SSH',
        description: 'Retorna indicadores administrativos de acessos locais e tuneis SSH.',
        security: [{ bearerAuth: [] }],
      },
    },
    (req, rep) => controller.getSshTunnelUsage(req, rep),
  )
  app.get<{ Querystring: SnippetReportQuery }>(
    '/adoption',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: tag,
        summary: 'Relatorio de adocao por usuario',
        description: 'Retorna dados de adocao e atividade de usuarios para acompanhamento administrativo.',
        security: [{ bearerAuth: [] }],
      },
    },
    (req, rep) => controller.getUserAdoption(req, rep),
  )
  app.get<{ Querystring: SnippetReportQuery }>(
    '/client-ux',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: tag,
        summary: 'Relatorio de UX e uso do cliente',
        description: 'Retorna sinais administrativos de uso da interface para avaliar atrito e adocao.',
        security: [{ bearerAuth: [] }],
      },
    },
    (req, rep) => controller.getClientUx(req, rep),
  )
  app.get<{ Querystring: SnippetReportQuery }>(
    '/host-keys',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        tags: tag,
        summary: 'Relatorio de host keys',
        description: 'Retorna dados administrativos sobre host keys, mudancas e postura de confianca.',
        security: [{ bearerAuth: [] }],
      },
    },
    (req, rep) => controller.getHostKeys(req, rep),
  )
}
