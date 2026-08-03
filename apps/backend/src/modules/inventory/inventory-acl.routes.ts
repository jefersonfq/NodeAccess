import {
  EffectiveHostInventoryPermissionsSchema,
  EffectiveInventoryPermissionsSchema,
  InventoryAclImpactPreviewResultSchema,
  InventoryAclImpactPreviewSchema,
  InventoryAclEntryPublicSchema,
  UpsertInventoryAclEntrySchema,
} from '@nodeaccess/shared'
import type { InventoryAclImpactPreviewDto, UpsertInventoryAclEntryDto } from '@nodeaccess/shared'
import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireHostManager } from '../../shared/guards.js'
import type { InventoryAclController } from './inventory-acl.controller.js'

interface NodeParam { id: string }
interface EffectiveParam extends NodeParam { userId: string }
interface HostEffectiveParam {
  hostId: string
  userId: string
}
interface EntryParam extends NodeParam {
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: string
}

const id = { type: 'integer', minimum: 1 }
const tag = ['Host inventory ACL']
const entryArray = { type: 'array', items: zodToJsonSchema(InventoryAclEntryPublicSchema) }

export async function inventoryAclRoutes(app: FastifyInstance, controller: InventoryAclController): Promise<void> {
  app.get<{ Params: NodeParam }>('/nodes/:id/acl', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Listar ACL local e herdada do nó',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id }, required: ['id'] },
      response: { 200: entryArray },
    },
  }, (request, reply) => controller.list(request, reply))

  app.put<{ Params: NodeParam; Body: UpsertInventoryAclEntryDto }>('/nodes/:id/acl', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Conceder ou atualizar ACL local',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id }, required: ['id'] },
      body: zodToJsonSchema(UpsertInventoryAclEntrySchema),
      response: { 200: entryArray },
    },
  }, (request, reply) => controller.upsert(request, reply))

  app.post<{ Params: NodeParam; Body: InventoryAclImpactPreviewDto }>('/nodes/:id/acl/impact-preview', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Prever impacto de alteração ACL local',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id }, required: ['id'] },
      body: zodToJsonSchema(InventoryAclImpactPreviewSchema),
      response: { 200: zodToJsonSchema(InventoryAclImpactPreviewResultSchema) },
    },
  }, (request, reply) => controller.previewImpact(request, reply))

  app.delete<{ Params: EntryParam }>('/nodes/:id/acl/:principalType/:principalId', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Revogar ACL local',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { id, principalType: { type: 'string', enum: ['USER', 'GROUP', 'ROLE'] }, principalId: id },
        required: ['id', 'principalType', 'principalId'],
      },
      response: { 204: { type: 'null' } },
    },
  }, (request, reply) => controller.delete(request, reply))

  app.get<{ Params: EffectiveParam }>('/nodes/:id/effective-permissions/users/:userId', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Calcular permissão efetiva de usuário',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { id, userId: id }, required: ['id', 'userId'] },
      response: { 200: zodToJsonSchema(EffectiveInventoryPermissionsSchema) },
    },
  }, (request, reply) => controller.effective(request, reply))

  app.get<{ Params: HostEffectiveParam }>('/hosts/:hostId/effective-permissions/users/:userId', {
    preHandler: [requireHostManager],
    schema: {
      tags: tag,
      summary: 'Calcular permissão efetiva de usuário por host',
      security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { hostId: id, userId: id }, required: ['hostId', 'userId'] },
      response: { 200: zodToJsonSchema(EffectiveHostInventoryPermissionsSchema) },
    },
  }, (request, reply) => controller.effectiveHost(request, reply))
}
