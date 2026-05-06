import type { FastifyInstance } from 'fastify'
import { CreateTenantResultSchema, CreateTenantSchema, TenantPublicSchema, UpdateTenantSchema } from '@nodeaccess/shared'
import type { CreateTenantDto, UpdateTenantDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requirePlatformAdmin } from '../../shared/guards.js'
import type { TenantController } from './tenant.controller.js'

const tag = ['Platform']
const idParam = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

interface IdParam {
  id: string
}

export async function tenantRoutes(app: FastifyInstance, controller: TenantController): Promise<void> {
  app.get('/', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Listar tenants (platform admin)',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: zodToJsonSchema(TenantPublicSchema) } },
    },
  }, (request, reply) => controller.list(request, reply))

  app.post<{ Body: CreateTenantDto }>('/', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Criar tenant (platform admin)',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateTenantSchema),
      response: { 201: zodToJsonSchema(CreateTenantResultSchema) },
    },
  }, (request, reply) => controller.create(request, reply))

  app.patch<{ Params: IdParam; Body: UpdateTenantDto }>('/:id', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar tenant (platform admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(UpdateTenantSchema),
      response: { 200: zodToJsonSchema(TenantPublicSchema) },
    },
  }, (request, reply) => controller.update(request, reply))
}
