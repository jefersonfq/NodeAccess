import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { SftpController } from './sftp.controller.js'

const tag      = ['SFTP']
const hostParam = {
  type: 'object',
  properties: { hostId: { type: 'integer' } },
  required: ['hostId'],
}

export async function sftpRoutes(app: FastifyInstance, ctrl: SftpController): Promise<void> {
  /** GET /api/v1/sftp/:hostId/ping */
  app.get('/:hostId/ping', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Testar conexão SFTP e obter home dir',
      security: [{ bearerAuth: [] }],
      params: hostParam,
    },
    handler: ctrl.ping.bind(ctrl),
  })

  /** GET /api/v1/sftp/:hostId/list?path=... */
  app.get('/:hostId/list', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar arquivos/diretórios via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: { path: { type: 'string', default: '/' } },
        required: ['path'],
      },
    },
    handler: ctrl.list.bind(ctrl),
  })

  /** GET /api/v1/sftp/:hostId/download?path=... */
  app.get('/:hostId/download', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Baixar arquivo via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: ctrl.download.bind(ctrl),
  })

  /** POST /api/v1/sftp/:hostId/upload?path=... (multipart) */
  app.post('/:hostId/upload', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Enviar arquivo via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: ctrl.upload.bind(ctrl),
  })

  /** POST /api/v1/sftp/:hostId/mkdir — body: { path } */
  app.post('/:hostId/mkdir', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar diretório via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      body: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: ctrl.mkdir.bind(ctrl),
  })

  /** POST /api/v1/sftp/:hostId/rename — body: { oldPath, newPath } */
  app.post('/:hostId/rename', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Renomear/mover arquivo ou diretório via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      body: {
        type: 'object',
        properties: {
          oldPath: { type: 'string' },
          newPath: { type: 'string' },
        },
        required: ['oldPath', 'newPath'],
      },
    },
    handler: ctrl.rename.bind(ctrl),
  })

  /** DELETE /api/v1/sftp/:hostId/file?path=... */
  app.delete('/:hostId/file', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Deletar arquivo ou diretório vazio via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: ctrl.delete.bind(ctrl),
  })

  /** POST /api/v1/sftp/:hostId/touch — body: { path } */
  app.post('/:hostId/touch', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar arquivo vazio via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      body: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: ctrl.createFile.bind(ctrl),
  })

  /** GET /api/v1/sftp/:hostId/read?path=... */
  app.get('/:hostId/read', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Ler conteúdo de arquivo de texto via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
    handler: ctrl.readFile.bind(ctrl),
  })

  /** PUT /api/v1/sftp/:hostId/write — body: { path, content } */
  app.put('/:hostId/write', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Escrever conteúdo em arquivo de texto via SFTP',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      body: {
        type: 'object',
        properties: {
          path:    { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    handler: ctrl.writeFile.bind(ctrl),
  })
}
