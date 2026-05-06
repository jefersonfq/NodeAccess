import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { EmailConfigController } from './email-config.controller.js'

const tag = ['Email']

export async function emailConfigRoutes(app: FastifyInstance, controller: EmailConfigController): Promise<void> {
  app.addHook('preHandler', requireAdmin)

  app.get('/', {
    schema: { tags: tag, summary: 'Retorna config de email do tenant (sem senha)', security: [{ bearerAuth: [] }] },
    handler: controller.get.bind(controller),
  })

  app.put('/', {
    schema: {
      tags: tag,
      summary: 'Cria ou atualiza config de email',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['provider', 'user', 'password', 'fromName', 'secure'],
        properties: {
          provider: { type: 'string', enum: ['gmail', 'outlook', 'smtp'] },
          host:     { type: 'string', nullable: true },
          port:     { type: 'number', nullable: true },
          secure:   { type: 'boolean' },
          user:     { type: 'string' },
          password: { type: 'string' },
          fromName: { type: 'string' },
        },
      },
    },
    handler: controller.upsert.bind(controller),
  })

  app.post('/test', {
    schema: {
      tags: tag,
      summary: 'Envia email de teste para validar a configuração',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: { email: { type: 'string', description: 'Destinatário do teste (padrão: email do admin)' } },
      },
    },
    handler: controller.test.bind(controller),
  })

  app.post('/test-credentials', {
    schema: {
      tags: tag,
      summary: 'Testa credenciais sem salvar (pré-validação)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['provider', 'user', 'password', 'fromName', 'secure'],
        properties: {
          provider: { type: 'string', enum: ['gmail', 'outlook', 'smtp'] },
          host:     { type: 'string', nullable: true },
          port:     { type: 'number', nullable: true },
          secure:   { type: 'boolean' },
          user:     { type: 'string' },
          password: { type: 'string' },
          fromName: { type: 'string' },
          email:    { type: 'string', description: 'Destinatário do teste' },
        },
      },
      response: { 204: { type: 'null' } },
    },
    handler: controller.testCredentials.bind(controller),
  })

  app.delete('/', {
    schema: { tags: tag, summary: 'Remove config de email do tenant', security: [{ bearerAuth: [] }] },
    handler: controller.delete.bind(controller),
  })
}
