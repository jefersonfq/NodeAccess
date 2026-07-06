import type { FastifyInstance } from 'fastify'
import { CreateUserSchema, UpdateUserSchema, UserPublicSchema, UserPreferencesSchema, PatchUserPreferencesSchema } from '@nodeaccess/shared'
import type { CreateUserDto, UpdateUserDto, PatchUserPreferencesDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAuth, requireAdmin } from '../../shared/guards.js'
import type { UserController } from './user.controller.js'

const tag        = ['Users']
const userSchema = zodToJsonSchema(UserPublicSchema)
const userPreferencesSchema = zodToJsonSchema(UserPreferencesSchema)
const nullableUserPreferencesSchema = {
  anyOf: [userPreferencesSchema, { type: 'null' }],
}
const idParam    = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

interface IdParam {
  id: string
}

interface PageQuery {
  page?: number
  limit?: number
  search?: string
  role?: 'admin' | 'user'
  active?: string
  includeDeleted?: string
}

interface ChangePasswordBody {
  currentPassword?: string
  newPassword: string
}

export async function userRoutes(app: FastifyInstance, controller: UserController): Promise<void> {
  /** GET /api/v1/users — lista paginada (admin) */
  app.get<{ Querystring: PageQuery }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar usuários paginados (admin)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:           { type: 'integer', default: 1 },
          limit:          { type: 'integer', default: 20 },
          search:         { type: 'string' },
          role:           { type: 'string', enum: ['admin', 'user'] },
          active:         { type: 'string', enum: ['true', 'false'] },
          includeDeleted: { type: 'string', enum: ['true', 'false'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data:  { type: 'array', items: userSchema },
            total: { type: 'integer' },
            page:  { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    },
  }, (request, reply) => controller.list(request, reply))

  /** GET /api/v1/users/:id (admin) */
  app.get<{ Params: IdParam }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Buscar usuário por ID (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: userSchema },
    },
  }, (request, reply) => controller.getById(request, reply))

  /** POST /api/v1/users (admin) */
  app.post<{ Body: CreateUserDto }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Criar usuário (admin)',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateUserSchema),
      response: {
        201: {
          allOf: [userSchema, {
            type: 'object',
            properties: { temporaryPassword: { type: 'string' } },
          }],
        },
      },
    },
  }, (request, reply) => controller.create(request, reply))

  /** PATCH /api/v1/users/:id (admin) */
  app.patch<{ Params: IdParam; Body: UpdateUserDto }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar usuário (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(UpdateUserSchema),
      response: { 200: userSchema },
    },
  }, (request, reply) => controller.update(request, reply))

  /** PATCH /api/v1/users/:id/activate (admin) */
  app.patch<{ Params: IdParam }>('/:id/activate', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Ativar usuário (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: userSchema },
    },
  }, (request, reply) => controller.activate(request, reply))

  /** PATCH /api/v1/users/:id/deactivate (admin) */
  app.patch<{ Params: IdParam }>('/:id/deactivate', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Desativar usuário (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: userSchema },
    },
  }, (request, reply) => controller.deactivate(request, reply))

  /** DELETE /api/v1/users/:id (admin) — soft delete */
  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Excluir usuário (soft delete)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null' } },
    },
  }, (request, reply) => controller.delete(request, reply))

  /** POST /api/v1/users/:id/restore (admin) */
  app.post<{ Params: IdParam }>('/:id/restore', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Restaurar usuário excluído',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: userSchema },
    },
  }, (request, reply) => controller.restore(request, reply))

  /** POST /api/v1/users/:id/reset-password (admin) */
  app.post<{ Params: IdParam }>('/:id/reset-password', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Resetar senha do usuário (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: {
        200: {
          type: 'object',
          properties: {
            temporaryPassword: { type: 'string' },
          },
        },
      },
    },
  }, (request, reply) => controller.resetPassword(request, reply))

  /** POST /api/v1/users/me/change-password (usuário autenticado) */
  app.post<{ Body: ChangePasswordBody }>('/me/change-password', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Alterar própria senha',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword:     { type: 'string' },
        },
      },
      response: { 204: { type: 'null', description: 'Senha alterada com sucesso' } },
    },
  }, (request, reply) => controller.changePassword(request, reply))

  app.get('/me/preferences', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Buscar preferências do usuário autenticado',
      security: [{ bearerAuth: [] }],
      response: { 200: nullableUserPreferencesSchema },
    },
  }, (request, reply) => controller.getPreferences(request, reply))

  app.patch<{ Body: PatchUserPreferencesDto }>('/me/preferences', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Atualizar preferências do usuário autenticado',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(PatchUserPreferencesSchema),
      response: { 200: userPreferencesSchema },
    },
  }, (request, reply) => controller.updatePreferences(request, reply))
}
