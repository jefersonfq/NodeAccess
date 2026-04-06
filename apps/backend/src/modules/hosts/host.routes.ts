import type { FastifyInstance } from 'fastify'
import { CreateHostSchema, HostKeyTrustEventSchema, HostPublicSchema, TestConnectionSchema, TestConnectionResultSchema, TrustHostKeySchema } from '@nodeaccess/shared'
import type { CreateHostDto, TestConnectionDto, TrustHostKeyDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAuth } from '../../shared/guards.js'
import type { HostController } from './host.controller.js'

const tag        = ['Hosts']
const hostSchema = zodToJsonSchema(HostPublicSchema)
interface IdParam {
  id: string
}
interface HostQuery {
  page?: number
  limit?: number
  search?: string
  scope?: string
  groupId?: number
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
