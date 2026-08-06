import type { FastifyInstance } from 'fastify'
import { ClientUxEventsRequestSchema, UserProductivityEventsRequestSchema } from '@nodeaccess/shared'
import type { ClientUxEvent, UserProductivityEvent } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { LogController } from './log.controller.js'
import { requireAuth, requireAdmin } from '../../shared/guards.js'

interface AuthLogQuery {
  eventType?: string
  success?: string
  search?: string
  page?: number
  limit?: number
}

interface AdminLogQuery {
  search?: string
  action?: string
  actions?: string
  actionPrefix?: string
  targetType?: string
  targetId?: number
  mcpTokenId?: number
  mcpAuthMode?: string
  page?: number
  limit?: number
}

interface InventoryAclAuditQuery {
  search?: string
  targetId?: number
  page?: number
  limit?: number
}

interface McpInteractiveSshSessionQuery {
  search?: string
  status?: string
  hostId?: number
  tokenId?: number
  page?: number
  limit?: number
}

interface SnippetExecutionQuery {
  search?: string
  status?: string
  userId?: number
  snippetId?: number
  hostId?: number
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
}

interface ClientUxEventsBody {
  events: ClientUxEvent[]
}

interface UserProductivityEventsBody {
  events: Array<{ event: UserProductivityEvent; targetId: number }>
}

interface McpInteractiveSshSessionParams {
  sessionId: string
}

const tag = ['Logs']

export function logRoutes(app: FastifyInstance, controller: LogController): void {
  app.get<{ Querystring: AuthLogQuery }>('/auth', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar logs de autenticacao',
      description: 'Lista eventos de autenticacao do tenant para investigacao, filtros administrativos e auditoria de acesso.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.listAuthLogs(req, rep))
  app.get<{ Querystring: AdminLogQuery }>('/admin', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar logs administrativos',
      description: 'Lista acoes administrativas e eventos operacionais auditaveis do tenant.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.listAdminLogs(req, rep))
  app.get<{ Querystring: InventoryAclAuditQuery }>('/inventory-acl', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar auditoria de ACL do inventario',
      description: 'Lista alteracoes de ACL do inventario, revogacoes de sessoes por ACL e movimentacoes de hosts que alteram permissao efetiva.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.listInventoryAclAudit(req, rep))
  app.get<{ Querystring: SnippetExecutionQuery }>('/snippet-executions', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar execucoes de snippets',
      description: 'Lista execucoes de snippets e macros para auditoria operacional e troubleshooting.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.listSnippetExecutions(req, rep))
  app.get<{ Querystring: McpInteractiveSshSessionQuery }>('/mcp-interactive-sessions', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar sessoes SSH interativas via MCP',
      description: 'Lista sessoes SSH interativas abertas por tokens MCP para acompanhamento e governanca administrativa.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.listMcpInteractiveSshSessions(req, rep))
  app.post<{ Params: McpInteractiveSshSessionParams }>('/mcp-interactive-sessions/:sessionId/close', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: tag,
      summary: 'Encerrar sessao SSH interativa via MCP',
      description: 'Encerra administrativamente uma sessao SSH interativa aberta via MCP.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.closeMcpInteractiveSshSession(req, rep))
  app.post<{ Body: ClientUxEventsBody }>('/client-ux', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Registrar eventos leves de UX do cliente',
      description: 'Recebe eventos leves de UX do frontend para analise de adocao e atrito. Nao deve conter dados sensiveis.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(ClientUxEventsRequestSchema),
      response: { 204: { type: 'null' } },
    },
  }, (req, rep) => controller.recordClientUxEvents(req, rep))
  app.post<{ Body: UserProductivityEventsBody }>('/user-productivity', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Registrar eventos leves de produtividade do usuario',
      description: 'Recebe eventos leves de produtividade do usuario para indicadores de adocao e uso do produto.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(UserProductivityEventsRequestSchema),
      response: { 204: { type: 'null' } },
    },
  }, (req, rep) => controller.recordUserProductivityEvents(req, rep))
}
