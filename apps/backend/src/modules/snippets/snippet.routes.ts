import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { SnippetController } from './snippet.controller.js'

const tag = ['Snippets']

const snippetBody = {
  type: 'object',
  properties: {
    name:        { type: 'string', minLength: 1 },
    command:     { type: 'string', minLength: 1 },
    description: { type: 'string' },
    scope:       { type: 'string', enum: ['PERSONAL', 'TEAM'] },
  },
  required: ['name', 'command', 'scope'],
}

const idParam = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function snippetRoutes(app: FastifyInstance, ctrl: SnippetController): Promise<void> {
  /** GET /api/v1/snippets */
  app.get('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Listar snippets', security: [{ bearerAuth: [] }] },
    handler: ctrl.list.bind(ctrl),
  })

  /** POST /api/v1/snippets */
  app.post('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Criar snippet', security: [{ bearerAuth: [] }], body: snippetBody },
    handler: ctrl.create.bind(ctrl),
  })

  /** PUT /api/v1/snippets/:id */
  app.put('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Atualizar snippet', security: [{ bearerAuth: [] }],
      params: idParam,
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string' },
          command:     { type: 'string' },
          description: { type: 'string' },
          scope:       { type: 'string', enum: ['PERSONAL', 'TEAM'] },
        },
      },
    },
    handler: ctrl.update.bind(ctrl),
  })

  /** DELETE /api/v1/snippets/:id */
  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Excluir snippet', security: [{ bearerAuth: [] }], params: idParam },
    handler: ctrl.remove.bind(ctrl),
  })
}
