import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requirePlatformAdmin } from '../../shared/guards.js'
import type { PlatformAdminController } from './platform-admin.controller.js'
import type { CreatePlatformAdminDto } from './platform-admin.service.js'

const tag = ['Platform']

const CreatePlatformAdminSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email(),
  tenantId: z.number().int().positive().optional(),
  tenantSlug: z.string().trim().min(1).max(80).optional(),
  tenantName: z.string().trim().min(1).max(120).optional(),
  resetPassword: z.boolean().optional(),
})

const PromotePlatformAdminSchema = z.object({
  resetPassword: z.boolean().optional(),
})

const PlatformAdminPublicSchema = z.object({
  id: z.number().int(),
  tenantId: z.number().int(),
  tenantName: z.string(),
  tenantSlug: z.string(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  forcePasswordChange: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const PlatformAdminResultSchema = z.object({
  admin: PlatformAdminPublicSchema,
  temporaryPassword: z.string().optional(),
})

const idParam = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

interface IdParam {
  id: string
}

export async function platformAdminRoutes(app: FastifyInstance, controller: PlatformAdminController): Promise<void> {
  app.get('/', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Listar superadmins da plataforma',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: zodToJsonSchema(PlatformAdminPublicSchema) } },
    },
  }, (request, reply) => controller.list(request, reply))

  app.post<{ Body: CreatePlatformAdminDto }>('/', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Criar ou promover superadmin da plataforma',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreatePlatformAdminSchema),
      response: { 201: zodToJsonSchema(PlatformAdminResultSchema) },
    },
  }, (request, reply) => controller.create(request, reply))

  app.post<{ Params: IdParam; Body: z.infer<typeof PromotePlatformAdminSchema> }>('/users/:id/promote', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Promover usuário existente a superadmin da plataforma',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(PromotePlatformAdminSchema),
      response: { 201: zodToJsonSchema(PlatformAdminResultSchema) },
    },
  }, (request, reply) => controller.promoteUser(request, reply))

  app.post<{ Params: IdParam }>('/:id/reset-password', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Resetar senha temporária de superadmin',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: zodToJsonSchema(PlatformAdminResultSchema) },
    },
  }, (request, reply) => controller.resetPassword(request, reply))

  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Remover permissão de superadmin',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null' } },
    },
  }, (request, reply) => controller.revoke(request, reply))
}
