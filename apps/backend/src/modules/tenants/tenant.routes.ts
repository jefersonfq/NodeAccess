import type { FastifyInstance } from 'fastify'
import { CreateTenantAdminResultSchema, CreateTenantResultSchema, CreateTenantSchema, TenantAdminBootstrapSchema, TenantDashboardSummarySchema, TenantPublicSchema, UpdateTenantSchema } from '@nodeaccess/shared'
import type { CreateTenantDto, TenantAdminBootstrapDto, UpdateTenantDto } from '@nodeaccess/shared'
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

  app.get('/dashboard', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Resumo operacional dos tenants (platform admin)',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(TenantDashboardSummarySchema) },
    },
  }, (request, reply) => controller.dashboard(request, reply))

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

  app.post<{ Params: IdParam; Body: TenantAdminBootstrapDto }>('/:id/admins', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Criar admin para tenant (platform admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(TenantAdminBootstrapSchema),
      response: { 201: zodToJsonSchema(CreateTenantAdminResultSchema) },
    },
  }, (request, reply) => controller.createAdmin(request, reply))

  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requirePlatformAdmin],
    schema: {
      tags: tag,
      summary: 'Excluir tenant vazio (platform admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
