import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { SnippetGroupController } from './snippet-group.controller.js'

const tag = ['Snippets']

const groupBody = {
  type: 'object',
  properties: {
    name:        { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: 'string', maxLength: 500, nullable: true },
    scope:       { type: 'string', enum: ['PERSONAL', 'TEAM'] },
  },
  required: ['name', 'scope'],
}

const idParam = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function snippetGroupRoutes(app: FastifyInstance, ctrl: SnippetGroupController): Promise<void> {
  app.get('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Listar grupos de snippets', security: [{ bearerAuth: [] }] },
    handler: ctrl.list.bind(ctrl),
  })

  app.post('/', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Criar grupo de snippets', security: [{ bearerAuth: [] }], body: groupBody },
    handler: ctrl.create.bind(ctrl),
  })

  app.put('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Atualizar grupo de snippets', security: [{ bearerAuth: [] }],
      params: idParam,
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500, nullable: true },
          scope:       { type: 'string', enum: ['PERSONAL', 'TEAM'] },
        },
      },
    },
    handler: ctrl.update.bind(ctrl),
  })

  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Excluir grupo de snippets', security: [{ bearerAuth: [] }], params: idParam },
    handler: ctrl.remove.bind(ctrl),
  })
}
