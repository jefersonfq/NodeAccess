import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { CreateSecretSchema, RotateSecretSchema, SecretPublicSchema, UpdateSecretSchema } from '@nodeaccess/shared'
import type { CreateSecretDto, RotateSecretDto, UpdateSecretDto } from '@nodeaccess/shared'
import { requireAuth } from '../../shared/guards.js'
import type { SecretController } from './secret.controller.js'

interface IdParam {
  id: string
}

interface ListQuery {
  includeRevoked?: string
}

const tag = ['Secrets']
const idParam = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function secretRoutes(app: FastifyInstance, controller: SecretController): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar secrets acessíveis sem expor valores',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { includeRevoked: { type: 'string', enum: ['true', 'false'] } },
      },
      response: { 200: { type: 'array', items: zodToJsonSchema(SecretPublicSchema) } },
    },
  }, (request, reply) => controller.list(request, reply))

  app.post<{ Body: CreateSecretDto }>('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar secret cifrado',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateSecretSchema),
      response: { 201: zodToJsonSchema(SecretPublicSchema) },
    },
  }, (request, reply) => controller.create(request, reply))

  app.patch<{ Params: IdParam; Body: UpdateSecretDto }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Atualizar metadados do secret',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(UpdateSecretSchema),
      response: { 200: zodToJsonSchema(SecretPublicSchema) },
    },
  }, (request, reply) => controller.update(request, reply))

  app.post<{ Params: IdParam; Body: RotateSecretDto }>('/:id/rotate', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Rotacionar valor do secret sem expor o valor atual',
      security: [{ bearerAuth: [] }],
      params: idParam,
      body: zodToJsonSchema(RotateSecretSchema),
      response: { 200: zodToJsonSchema(SecretPublicSchema) },
    },
  }, (request, reply) => controller.rotate(request, reply))

  app.post<{ Params: IdParam }>('/:id/revoke', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Revogar secret',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 200: zodToJsonSchema(SecretPublicSchema) },
    },
  }, (request, reply) => controller.revoke(request, reply))

  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Excluir secret definitivamente',
      security: [{ bearerAuth: [] }],
      params: idParam,
      response: { 204: { type: 'null' } },
    },
  }, (request, reply) => controller.delete(request, reply))
}
