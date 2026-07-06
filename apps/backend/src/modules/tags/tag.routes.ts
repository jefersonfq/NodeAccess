import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { TagController } from './tag.controller.js'
import { requireAuth } from '../../shared/guards.js'

const nameBody = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 50 } },
} as const
const tag = ['Tags']

export async function tagRoutes(app: FastifyInstance, controller: TagController) {
  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar tags de hosts',
      description: 'Lista tags disponiveis para classificacao e filtro de hosts no tenant.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.list(req, rep))
  app.post('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar tag de host',
      description: 'Cria ou reutiliza uma tag por nome para associacao a hosts.',
      security: [{ bearerAuth: [] }],
      body: nameBody,
    },
  }, (req, rep) => controller.create(req as FastifyRequest<{ Body: { name: string } }>, rep))
  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Excluir tag de host',
      description: 'Remove uma tag do tenant quando permitido pela regra de negocio.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.delete(req as FastifyRequest<{ Params: { id: string } }>, rep))
}
