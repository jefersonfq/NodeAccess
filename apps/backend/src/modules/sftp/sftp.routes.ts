import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { SftpController } from './sftp.controller.js'

const tag      = ['SFTP']
const hostParam = {
  type: 'object',
  properties: { hostId: { type: 'integer' } },
  required: ['hostId'],
}
const sessionIdProperty = { type: 'integer', nullable: true }

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
        properties: {
          path: { type: 'string' },
          sessionId: sessionIdProperty,
        },
        required: ['path'],
      },
    },
    handler: ctrl.download.bind(ctrl),
  })

  /** GET /api/v1/sftp/:hostId/download-backup?path=...&backupPath=... */
  app.get('/:hostId/download-backup', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Baixar backup SFTP criado pelo NodeAccess',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: {
          path:       { type: 'string' },
          backupPath: { type: 'string' },
          sessionId:  sessionIdProperty,
        },
        required: ['path', 'backupPath'],
      },
    },
    handler: ctrl.downloadBackup.bind(ctrl),
  })

  /** GET /api/v1/sftp/:hostId/backup-diff?path=...&backupPath=... */
  app.get('/:hostId/backup-diff', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Gerar diff mascarado entre backup SFTP e arquivo atual',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      querystring: {
        type: 'object',
        properties: {
          path:       { type: 'string' },
          backupPath: { type: 'string' },
          sessionId:  sessionIdProperty,
        },
        required: ['path', 'backupPath'],
      },
    },
    handler: ctrl.backupDiff.bind(ctrl),
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
        properties: {
          path: { type: 'string' },
          sessionId: sessionIdProperty,
        },
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
        properties: {
          path: { type: 'string' },
          sessionId: sessionIdProperty,
        },
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
          sessionId: sessionIdProperty,
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
        properties: {
          path: { type: 'string' },
          sessionId: sessionIdProperty,
        },
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
        properties: {
          path: { type: 'string' },
          sessionId: sessionIdProperty,
        },
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
        properties: {
          path: { type: 'string' },
          sessionId: sessionIdProperty,
        },
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
          path:               { type: 'string' },
          content:            { type: 'string' },
          sessionId:          sessionIdProperty,
          expectedHash:       { type: 'string', nullable: true },
          expectedModifiedAt: { type: 'string', nullable: true },
          expectedSize:       { type: 'number', nullable: true },
        },
        required: ['path', 'content'],
      },
    },
    handler: ctrl.writeFile.bind(ctrl),
  })

  /** POST /api/v1/sftp/:hostId/restore-backup — body: { path, backupPath } */
  app.post('/:hostId/restore-backup', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Restaurar arquivo a partir de backup SFTP criado pelo NodeAccess',
      security: [{ bearerAuth: [] }],
      params: hostParam,
      body: {
        type: 'object',
        properties: {
          path:       { type: 'string' },
          backupPath: { type: 'string' },
          sessionId:  sessionIdProperty,
        },
        required: ['path', 'backupPath'],
      },
    },
    handler: ctrl.restoreBackup.bind(ctrl),
  })
}
