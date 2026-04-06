import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { FolderController } from './folder.controller.js'

interface IdParam {
  id: string
}

interface CreateBody {
  name: string
}

const nameBody = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
}
const idParam = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function folderRoutes(app: FastifyInstance, controller: FolderController): Promise<void> {
  app.get('/', {
    preHandler: [requireAuth],
    schema: { tags: ['Folders'], summary: 'Listar pastas do usuário', security: [{ bearerAuth: [] }] },
  }, (request, reply) => controller.list(request, reply))

  app.post<{ Body: CreateBody }>('/', {
    preHandler: [requireAuth],
    schema: { tags: ['Folders'], summary: 'Criar pasta', security: [{ bearerAuth: [] }], body: nameBody },
  }, (request, reply) => controller.create(request, reply))

  app.patch<{ Params: IdParam; Body: CreateBody }>('/:id', {
    preHandler: [requireAuth],
    schema: { tags: ['Folders'], summary: 'Renomear pasta', security: [{ bearerAuth: [] }], params: idParam, body: nameBody },
  }, (request, reply) => controller.update(request, reply))

  app.delete<{ Params: IdParam }>('/:id', {
    preHandler: [requireAuth],
    schema: { tags: ['Folders'], summary: 'Excluir pasta', security: [{ bearerAuth: [] }], params: idParam },
  }, (request, reply) => controller.delete(request, reply))
}
