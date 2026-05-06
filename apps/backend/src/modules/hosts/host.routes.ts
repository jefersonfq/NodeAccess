import type { FastifyInstance } from 'fastify'
import { CreateHostSchema, GroupPublicSchema, HostKeyTrustEventSchema, HostPublicSchema, TagPublicSchema, TestConnectionSchema, TestConnectionResultSchema, TrustHostKeySchema } from '@nodeaccess/shared'
import type { CreateHostDto, TestConnectionDto, TrustHostKeyDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import { requireAuth } from '../../shared/guards.js'
import type { HostController } from './host.controller.js'

const tag        = ['Hosts']
const hostSchema = zodToJsonSchema(HostPublicSchema)
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
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:    { type: 'integer', default: 1 },
          limit:   { type: 'integer', default: 20 },
          search:  { type: 'string' },
          scope:   { type: 'string', enum: ['personal', 'team', 'global'] },
          groupId: { type: 'integer' },
          folderId: { type: 'integer' },
          tagId: { type: 'integer' },
          unfiled: { type: 'boolean' },
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
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(hostSidebarSummarySchema) },
    },
  }, (request, reply) => controller.getSidebarSummary(request, reply))

  app.get('/sidebar-bootstrap', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Bootstrap leve da sidebar de hosts',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(hostSidebarBootstrapSchema) },
    },
  }, (request, reply) => controller.getSidebarBootstrap(request, reply))

  app.get<{ Querystring: { ids?: string } }>('/by-ids', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar hosts visíveis por IDs',
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

  /** GET /api/v1/hosts/:id */
  app.get<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Buscar host por ID',
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
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateHostSchema),
      response: { 201: hostSchema },
    },
  }, (request, reply) => controller.create(request, reply))

  /** PATCH /api/v1/hosts/:id */
  app.patch<{ Params: IdParam; Body: Partial<CreateHostDto> }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Atualizar host',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(CreateHostSchema.partial()),
      response: { 200: hostSchema },
    },
  }, (request, reply) => controller.update(request, reply))

  /** POST /api/v1/hosts/test-connection — testa conexão SSH antes de salvar */
  app.post<{ Body: TestConnectionDto }>('/test-connection', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Testar conexão SSH',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(TestConnectionSchema),
      response: { 200: zodToJsonSchema(TestConnectionResultSchema) },
    },
  }, (request, reply) => controller.testConnection(request, reply))

  app.post<{ Params: IdParam; Body: TrustHostKeyDto }>('/:id/trust-host-key', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Confiar ou atualizar host key do host',
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
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null', description: 'Host deletado com sucesso' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
