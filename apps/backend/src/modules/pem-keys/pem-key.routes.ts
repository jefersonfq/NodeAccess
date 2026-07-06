import type { FastifyInstance } from 'fastify'
import { CreatePemKeySchema, PemKeyPublicSchema } from '@nodeaccess/shared'
import type { CreatePemKeyDto } from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAuth } from '../../shared/guards.js'
import type { PemKeyController } from './pem-key.controller.js'

const tag       = ['PemKeys']
const keySchema = zodToJsonSchema(PemKeyPublicSchema)
interface IdParam {
  id: string
}
const idParam   = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function pemKeyRoutes(app: FastifyInstance, controller: PemKeyController): Promise<void> {
  /** GET /api/v1/pem-keys — lista as chaves do tenant atual (admin) ou do usuário autenticado */
  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar chaves PEM',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: keySchema } },
    },
  }, (request, reply) => controller.list(request, reply))

  /** POST /api/v1/pem-keys */
  app.post<{ Body: CreatePemKeyDto }>('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Enviar nova chave PEM',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreatePemKeySchema),
      response: { 201: keySchema },
    },
  }, (request, reply) => controller.create(request, reply))

  /** DELETE /api/v1/pem-keys/:id */
  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Excluir chave PEM',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null', description: 'Chave excluída com sucesso' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
