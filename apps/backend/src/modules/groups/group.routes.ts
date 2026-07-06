import type { FastifyInstance } from 'fastify'
import { CreateGroupSchema, UpdateGroupSchema, GroupPublicSchema } from '@nodeaccess/shared'
import type { CreateGroupDto, UpdateGroupDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAuth, requireAdmin } from '../../shared/guards.js'
import type { GroupController, GroupListQuery } from './group.controller.js'

const tag         = ['Groups']
const groupSchema = zodToJsonSchema(GroupPublicSchema)
interface IdParam {
  id: string
}
const idParam     = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function groupRoutes(app: FastifyInstance, controller: GroupController): Promise<void> {
  /** GET /api/v1/groups — lista todos (qualquer autenticado) */
  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar grupos',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: groupSchema } },
    },
  }, (request, reply) => controller.list(request, reply))

  /** GET /api/v1/groups/paginated — lista grupos com paginação e busca */
  app.get<{ Querystring: GroupListQuery }>('/paginated', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar grupos paginados',
      description: 'Lista grupos visiveis ao usuario autenticado com paginacao server-side e busca por nome ou descricao.',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'integer', default: 1, minimum: 1 },
          limit:  { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          search: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data:  { type: 'array', items: groupSchema },
            total: { type: 'integer' },
            page:  { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
  }, (request, reply) => controller.listPaginated(request, reply))

  /** GET /api/v1/groups/:id */
  app.get<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Buscar grupo por ID',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: groupSchema },
    },
  }, (request, reply) => controller.getById(request, reply))

  /** POST /api/v1/groups (admin) */
  app.post<{ Body: CreateGroupDto }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Criar grupo (admin)',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateGroupSchema),
      response: { 201: groupSchema },
    },
  }, (request, reply) => controller.create(request, reply))

  /** PATCH /api/v1/groups/:id (admin) */
  app.patch<{ Params: IdParam; Body: UpdateGroupDto }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar grupo (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(UpdateGroupSchema),
      response: { 200: groupSchema },
    },
  }, (request, reply) => controller.update(request, reply))

  /** DELETE /api/v1/groups/:id (admin) */
  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Deletar grupo (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null', description: 'Grupo deletado com sucesso' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
