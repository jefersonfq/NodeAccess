import type { FastifyInstance } from 'fastify'
import { CreateHostSchema, GroupPublicSchema, HostBulkActionHistoryResponseSchema, HostBulkApplySchema, HostBulkApplyResponseSchema, HostBulkPreviewResponseSchema, HostBulkPreviewSchema, HostKeyTrustEventSchema, HostPublicSchema, TagPublicSchema, TestConnectionSchema, TestConnectionResultSchema, TrustHostKeySchema } from '@nodeaccess/shared'
import type { CreateHostDto, HostBulkApplyDto, HostBulkPreviewDto, TestConnectionDto, TrustHostKeyDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import { requireAuth } from '../../shared/guards.js'
import type { HostController } from './host.controller.js'

const tag        = ['Hosts']
const hostSchema = zodToJsonSchema(HostPublicSchema)
const createHostBodySchema = zodToJsonSchema(CreateHostSchema) as any
createHostBodySchema.examples = [
  {
    name: 'prod-web-01',
    ip: '10.0.10.15',
    port: 22,
    sshUser: 'ubuntu',
    authType: 'pem',
    connectionMode: 'direct',
    scope: 'team',
    groupId: 3,
    pemKeyId: 7,
    tagNames: ['producao', 'web'],
  },
]
const testConnectionBodySchema = zodToJsonSchema(TestConnectionSchema) as any
testConnectionBodySchema.examples = [
  {
    ip: '10.0.10.15',
    port: 22,
    sshUser: 'ubuntu',
    authType: 'pem',
    connectionMode: 'direct',
    pemKeyId: 7,
  },
  {
    ip: '10.0.20.25',
    port: 22,
    sshUser: 'admin',
    authType: 'password',
    connectionMode: 'direct',
    password: 'senha-informada-pelo-usuario',
    bastionId: 2,
  },
]
const importAssociatedLinksFromOnePasswordSchema = z.object({
  ref: z.string().min(1).max(500),
})
const previewAssociatedLinksFromOnePasswordResponseSchema = z.object({
  links: z.array(z.object({
    label: z.string(),
    urlTemplate: z.string(),
    position: z.number(),
    enabled: z.boolean(),
    openMode: z.enum(['new_tab', 'same_tab']),
    sourceType: z.enum(['manual', 'integration', 'derived']),
    sourceProvider: z.string().nullable().optional(),
    sourceRef: z.string().nullable().optional(),
    sourceStatus: z.enum(['manual', 'synced', 'stale', 'error']),
    sourceUpdatedAt: z.string().datetime().nullable().optional(),
  })),
})
const hostDeleteCheckResponseSchema = z.object({
  canDelete: z.boolean(),
  blockers: z.object({
    sessions: z.number().int().nonnegative(),
    sessionAudits: z.number().int().nonnegative(),
    mcpInteractiveSessions: z.number().int().nonnegative(),
  }),
})
const hostSidebarSummarySchema = z.object({
  all: z.number().int().nonnegative(),
  global: z.number().int().nonnegative(),
  unfiled: z.number().int().nonnegative(),
  maxHosts: z.number().int().positive().nullable(),
  folders: z.record(z.string(), z.number().int().nonnegative()),
  groups: z.record(z.string(), z.number().int().nonnegative()),
  tags: z.record(z.string(), z.number().int().nonnegative()),
})
const folderPublicSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  userId: z.number().int().positive(),
  tenantId: z.number().int().positive(),
  createdAt: z.string().datetime(),
})
const hostSidebarBootstrapSchema = z.object({
  summary: hostSidebarSummarySchema,
  folders: z.array(folderPublicSchema),
  groups: z.array(GroupPublicSchema),
  tags: z.array(TagPublicSchema),
})
const hostAssociatedLinksCatalogSchema = z.array(z.object({
  host: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    ip: z.string(),
    port: z.number().int().positive(),
    sshUser: z.string(),
  }),
  link: z.object({
    id: z.number().int().positive().optional(),
    label: z.string(),
    urlTemplate: z.string(),
    position: z.number().int(),
    enabled: z.boolean(),
    openMode: z.enum(['new_tab', 'same_tab']),
    sourceType: z.enum(['manual', 'integration', 'derived']),
    sourceProvider: z.string().nullable().optional(),
    sourceRef: z.string().nullable().optional(),
    sourceStatus: z.enum(['manual', 'synced', 'stale', 'error']),
    sourceUpdatedAt: z.coerce.date().nullable().optional(),
  }),
}))
interface IdParam {
  id: string
}
interface HostQuery {
  page?: number
  limit?: number
  search?: string
  scope?: string
  groupId?: number
  folderId?: number
  tagId?: number
  unfiled?: boolean
  bastionId?: number
  pemKeyId?: number
  authType?: string
  connectionMode?: string
}
const idParam    = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function hostRoutes(app: FastifyInstance, controller: HostController): Promise<void> {
  /** GET /api/v1/hosts — lista hosts visíveis ao usuário */
  app.get<{ Querystring: HostQuery }>('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar hosts',
      description: 'Lista hosts visiveis ao usuario autenticado com paginacao server-side e filtros operacionais. Nao retorna segredos em claro.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:    { type: 'integer', default: 1 },
          limit:   { type: 'integer', default: 20, minimum: 1, maximum: 500 },
          search:  { type: 'string' },
          scope:   { type: 'string', enum: ['personal', 'team', 'global'] },
          groupId: { type: 'integer' },
          folderId: { type: 'integer' },
          tagId: { type: 'integer' },
          unfiled: { type: 'boolean' },
          bastionId: { type: 'integer', minimum: 0 },
          pemKeyId: { type: 'integer', minimum: 0 },
          authType: { type: 'string', enum: ['password', 'pem', 'pem_password'] },
          accessProtocol: { type: 'string', enum: ['ssh', 'rdp', 'telnet', 'vnc', 'serial'] },
          connectionMode: { type: 'string', enum: ['direct', 'agent', 'agent_user', 'agent_tenant_fallback', 'private_access_connector', 'auto'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data:  { type: 'array', items: hostSchema },
            total: { type: 'integer' },
            page:  { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
  }, (request, reply) => controller.list(request, reply))

  /** GET /api/v1/hosts/:id */
  app.get('/sidebar-summary', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Resumo de contadores para a sidebar de hosts',
      description: 'Retorna contadores leves para a sidebar de Hosts sem carregar o catalogo completo no cliente.',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(hostSidebarSummarySchema) },
    },
  }, (request, reply) => controller.getSidebarSummary(request, reply))

  app.get('/sidebar-bootstrap', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Bootstrap leve da sidebar de hosts',
      description: 'Retorna resumo, pastas, grupos e tags necessarios para inicializar a navegacao lateral de Hosts.',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(hostSidebarBootstrapSchema) },
    },
  }, (request, reply) => controller.getSidebarBootstrap(request, reply))

  app.get<{ Querystring: { ids?: string } }>('/by-ids', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar hosts visíveis por IDs',
      description: 'Resolve somente os hosts solicitados por ID e visiveis ao usuario, evitando listagens amplas para favoritos, recentes e atalhos.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          ids: { type: 'string' },
        },
      },
      response: { 200: { type: 'array', items: hostSchema } },
    },
  }, (request, reply) => controller.listVisibleByIds(request, reply))

  app.get('/associated-links/catalog', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar catálogo leve de links associados',
      description: 'Retorna apenas links associados habilitados e os dados mínimos do host visível ao usuário, evitando carregar o catálogo completo de hosts.',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(hostAssociatedLinksCatalogSchema) },
    },
  }, (request, reply) => controller.listAssociatedLinksCatalog(request, reply))

  app.post<{ Body: HostBulkPreviewDto }>('/bulk/preview', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Pré-visualizar ação em massa de hosts',
      description: 'Calcula o impacto de uma acao em massa antes da aplicacao, permitindo revisar hosts afetados e possiveis riscos.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(HostBulkPreviewSchema),
      response: { 200: zodToJsonSchema(HostBulkPreviewResponseSchema) },
    },
  }, (request, reply) => controller.previewBulkAction(request, reply))

  app.post<{ Body: HostBulkApplyDto }>('/bulk/apply', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Aplicar ação em massa de hosts',
      description: 'Aplica acao em massa previamente validada sobre hosts visiveis e registra historico para rastreabilidade e rollback quando suportado.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(HostBulkApplySchema),
      response: { 200: zodToJsonSchema(HostBulkApplyResponseSchema) },
    },
  }, (request, reply) => controller.applyBulkAction(request, reply))

  app.get('/bulk/history', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar histórico de ações em massa de hosts',
      description: 'Lista execucoes anteriores de bulk actions para auditoria administrativa, revisao de impacto e rollback.',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(HostBulkActionHistoryResponseSchema) },
    },
  }, (request, reply) => controller.listBulkActionHistory(request, reply))

  app.post<{ Params: IdParam }>('/bulk/history/:id/rollback', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Reverter ação em massa de hosts',
      description: 'Executa rollback de uma acao em massa quando o historico possui dados suficientes e a regra de negocio permite.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: zodToJsonSchema(HostBulkApplyResponseSchema) },
    },
  }, (request, reply) => controller.rollbackBulkAction(request, reply))

  /** GET /api/v1/hosts/:id */
  app.get<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Buscar host por ID',
      description: 'Retorna detalhes de um host especifico se o usuario tiver visibilidade pelo escopo pessoal, grupo ou global.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: hostSchema },
    },
  }, (request, reply) => controller.getById(request, reply))

  /** POST /api/v1/hosts */
  app.post<{ Body: CreateHostDto }>('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar host',
      description: 'Cria host SSH no escopo permitido. Segredos devem ser enviados apenas pelos campos esperados e nunca retornam em claro na resposta.',
      security: [{ bearerAuth: [] }],
      body: createHostBodySchema,
      response: { 201: hostSchema },
    },
  }, (request, reply) => controller.create(request, reply))

  /** PATCH /api/v1/hosts/:id */
  app.patch<{ Params: IdParam; Body: Partial<CreateHostDto> }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Atualizar host',
      description: 'Atualiza metadados, conectividade, credencial ou organizacao de um host existente conforme permissoes do usuario.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(CreateHostSchema.partial()),
      response: { 200: hostSchema },
    },
  }, (request, reply) => controller.update(request, reply))

  /** POST /api/v1/hosts/test-connection — testa conexão do host antes de salvar */
  app.post<{ Body: TestConnectionDto }>('/test-connection', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Testar conexão do host',
      description: 'Testa conectividade do host antes de salvar ou durante diagnostico. SSH valida credenciais; Telnet e RDP validam TCP direto ou via agente.',
      security: [{ bearerAuth: [] }],
      body: testConnectionBodySchema,
      response: { 200: zodToJsonSchema(TestConnectionResultSchema) },
    },
  }, (request, reply) => controller.testConnection(request, reply))

  app.post<{ Params: IdParam; Body: TrustHostKeyDto }>('/:id/trust-host-key', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Confiar ou atualizar host key do host',
      description: 'Registra aceite explicito de host key nova ou alterada, respeitando permissao por escopo do host e mantendo historico auditavel.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(TrustHostKeySchema),
      response: { 200: hostSchema },
    },
  }, (request, reply) => controller.trustHostKey(request, reply))

  app.get<{ Params: IdParam }>('/:id/host-key-history', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar histórico recente de host key do host',
      description: 'Lista eventos recentes de confianca ou alteracao de host key para investigacao de seguranca e suporte.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: { type: 'array', items: zodToJsonSchema(HostKeyTrustEventSchema) } },
    },
  }, (request, reply) => controller.listHostKeyHistory(request, reply))

  app.post<{ Params: IdParam; Body: { ref: string } }>('/:id/import-associated-links/onepassword', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Importar links associados do 1Password para o host',
      description: 'Importa links operacionais associados ao host a partir de referencia 1Password, preservando validacoes e sem expor segredos.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(importAssociatedLinksFromOnePasswordSchema),
      response: { 200: hostSchema },
    },
  }, (request, reply) => controller.importAssociatedLinksFromOnePassword(request, reply))

  app.post<{ Params: IdParam; Body: { ref: string } }>('/:id/preview-associated-links/onepassword', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Pré-visualizar links associados do 1Password para o host',
      description: 'Mostra quais links seriam importados de uma referencia 1Password antes de alterar o cadastro do host.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(importAssociatedLinksFromOnePasswordSchema),
      response: { 200: zodToJsonSchema(previewAssociatedLinksFromOnePasswordResponseSchema) },
    },
  }, (request, reply) => controller.previewAssociatedLinksFromOnePassword(request, reply))

  app.get<{ Params: IdParam }>('/:id/delete-check', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Validar se o host pode ser excluído',
      description: 'Verifica bloqueadores historicos ou operacionais antes de excluir host, evitando erro 500 e preservando auditoria.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: zodToJsonSchema(hostDeleteCheckResponseSchema) },
    },
  }, (request, reply) => controller.getDeleteCheck(request, reply))

  /** DELETE /api/v1/hosts/:id */
  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Deletar host',
      description: 'Remove o host do fluxo operacional conforme regra de negocio. Historicos e auditorias devem permanecer preservados.',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null', description: 'Host deletado com sucesso' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
