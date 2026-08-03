import {
  CreateInventoryFolderSchema,
  InventoryIntegrityRepairResultSchema,
  InventoryIntegrityReportSchema,
  MoveInventoryFolderSchema,
  InventoryNodePublicSchema,
  MoveInventoryHostSchema,
  UpdateInventoryFolderSchema,
} from '@nodeaccess/shared'
import type { CreateInventoryFolderDto, MoveInventoryFolderDto, MoveInventoryHostDto, UpdateInventoryFolderDto } from '@nodeaccess/shared'
import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAuth, requireHostManager } from '../../shared/guards.js'
import type { InventoryController } from './inventory.controller.js'

interface IdParam {
  id: string
}

const tag = ['Host inventory']
const nodeSchema = zodToJsonSchema(InventoryNodePublicSchema)
const idParam = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 } },
  required: ['id'],
}

export async function inventoryRoutes(app: FastifyInstance, controller: InventoryController): Promise<void> {
  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar árvore oficial do inventário',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: nodeSchema } },
    },
  }, (request, reply) => controller.list(request, reply))

  app.get('/integrity', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Verificar integridade do inventário corporativo',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(InventoryIntegrityReportSchema) },
    },
  }, (request, reply) => controller.integrity(request, reply))

  app.post('/integrity/repair', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Recriar nós corporativos ausentes para hosts ativos',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(InventoryIntegrityRepairResultSchema) },
    },
  }, (request, reply) => controller.repairIntegrity(request, reply))

  app.get<{ Params: IdParam }>('/hosts/:id/node', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Buscar nó de inventário pelo host',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: nodeSchema },
    },
  }, (request, reply) => controller.getHostNode(request, reply))

  app.post<{ Body: CreateInventoryFolderDto }>('/folders', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Criar pasta no inventário',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateInventoryFolderSchema),
      response: { 201: nodeSchema },
    },
  }, (request, reply) => controller.createFolder(request, reply))

  app.patch<{ Params: IdParam; Body: UpdateInventoryFolderDto }>('/folders/:id', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Renomear pasta do inventário',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(UpdateInventoryFolderSchema),
      response: { 200: nodeSchema },
    },
  }, (request, reply) => controller.updateFolder(request, reply))

  app.patch<{ Params: IdParam; Body: MoveInventoryFolderDto }>('/folders/:id/location', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Mover pasta na árvore oficial',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(MoveInventoryFolderSchema),
      response: { 200: nodeSchema },
    },
  }, (request, reply) => controller.moveFolder(request, reply))

  app.delete<{ Params: IdParam }>('/folders/:id', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Excluir pasta vazia do inventário',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null' } },
    },
  }, (request, reply) => controller.deleteFolder(request, reply))

  app.patch<{ Params: IdParam; Body: MoveInventoryHostDto }>('/hosts/:id/location', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Mover host na árvore oficial',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(MoveInventoryHostSchema),
      response: { 200: nodeSchema },
    },
  }, (request, reply) => controller.moveHost(request, reply))
}
