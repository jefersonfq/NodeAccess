import type { FastifyInstance } from 'fastify'
import { CreateBastionSchema, UpdateBastionSchema, BastionPublicSchema } from '@nodeaccess/shared'
import type { CreateBastionDto, UpdateBastionDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { BastionController } from './bastion.controller.js'

const tag          = ['Bastions']
const bastionSchema = zodToJsonSchema(BastionPublicSchema)
interface IdParam {
  id: string
}
const idParam      = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function bastionRoutes(app: FastifyInstance, controller: BastionController): Promise<void> {
  /** GET /api/v1/bastions — qualquer autenticado (necessário para selects em forms) */
  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar bastion hosts',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: bastionSchema } },
    },
  }, (request, reply) => controller.list(request, reply))

  /** GET /api/v1/bastions/:id */
  app.get<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Buscar bastion por ID',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: bastionSchema },
    },
  }, (request, reply) => controller.getById(request, reply))

  /** POST /api/v1/bastions (admin) */
  app.post<{ Body: CreateBastionDto }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Criar bastion host (admin)',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateBastionSchema),
      response: { 201: bastionSchema },
    },
  }, (request, reply) => controller.create(request, reply))

  /** PATCH /api/v1/bastions/:id (admin) */
  app.patch<{ Params: IdParam; Body: UpdateBastionDto }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Atualizar bastion host (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(UpdateBastionSchema),
      response: { 200: bastionSchema },
    },
  }, (request, reply) => controller.update(request, reply))

  /** DELETE /api/v1/bastions/:id (admin) */
  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Deletar bastion host (admin)',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null', description: 'Bastion deletado com sucesso' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
