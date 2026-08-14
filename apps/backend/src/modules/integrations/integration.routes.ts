import type { FastifyInstance } from 'fastify'
import {
  UpsertOnePasswordSchema,
  UpsertGoogleSchema,
  UpsertLdapSchema,
  UpsertOpenAiSchema,
  UpsertLocalAiSchema,
  UpsertJiraSchema,
  IntegrationPublicSchema,
  GoogleConfigPublicSchema,
  LdapConfigPublicSchema,
  LdapTestResultSchema,
  OpenAiConfigPublicSchema,
  LocalAiConfigPublicSchema,
  OpenAiTestResultSchema,
  LocalAiTestResultSchema,
  JiraConfigPublicSchema,
  JiraTestResultSchema,
} from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { IntegrationController } from './integration.controller.js'

const tag              = ['Integrations']
const integrationSchema = zodToJsonSchema(IntegrationPublicSchema)
const googleSchema      = zodToJsonSchema(GoogleConfigPublicSchema)
const ldapSchema        = zodToJsonSchema(LdapConfigPublicSchema)
const ldapTestSchema    = zodToJsonSchema(LdapTestResultSchema)
const openAiSchema      = zodToJsonSchema(OpenAiConfigPublicSchema)
const localAiSchema     = zodToJsonSchema(LocalAiConfigPublicSchema)
const openAiTestSchema  = zodToJsonSchema(OpenAiTestResultSchema)
const localAiTestSchema = zodToJsonSchema(LocalAiTestResultSchema)
const jiraSchema        = zodToJsonSchema(JiraConfigPublicSchema)
const jiraTestSchema    = zodToJsonSchema(JiraTestResultSchema)
const jiraTicketSchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    url: { type: 'string', nullable: true },
    summary: { type: 'string' },
    status: { type: 'string', nullable: true },
    issueType: { type: 'string', nullable: true },
    projectKey: { type: 'string', nullable: true },
    projectName: { type: 'string', nullable: true },
    assigneeDisplayName: { type: 'string', nullable: true },
    labels: { type: 'array', items: { type: 'string' } },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['key', 'url', 'summary', 'status', 'issueType', 'projectKey', 'projectName', 'assigneeDisplayName', 'labels', 'updatedAt'],
} as const
const onePasswordBodySchema = zodToJsonSchema(UpsertOnePasswordSchema) as any
const googleBodySchema      = zodToJsonSchema(UpsertGoogleSchema) as any
const ldapBodySchema        = zodToJsonSchema(UpsertLdapSchema) as any
const openAiBodySchema      = zodToJsonSchema(UpsertOpenAiSchema) as any
const localAiBodySchema     = zodToJsonSchema(UpsertLocalAiSchema) as any
const jiraBodySchema        = zodToJsonSchema(UpsertJiraSchema) as any

export async function integrationRoutes(app: FastifyInstance, controller: IntegrationController): Promise<void> {
  app.get('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar integrações do tenant',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: integrationSchema } },
    },
    handler: controller.list.bind(controller),
  })

  ;(app as any).put('/onepassword', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configurar integração com 1Password',
      security: [{ bearerAuth: [] }],
      body: onePasswordBodySchema,
      response: { 200: integrationSchema },
    },
    handler: controller.upsertOnePassword.bind(controller),
  })

  app.get('/google', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Obter configuração do Google Workspace',
      security: [{ bearerAuth: [] }],
      response: { 200: googleSchema },
    },
    handler: controller.getGoogle.bind(controller),
  })

  ;(app as any).put('/google', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configurar integração com Google Workspace (OAuth + Directory Sync)',
      security: [{ bearerAuth: [] }],
      body: googleBodySchema,
      response: { 200: googleSchema },
    },
    handler: controller.upsertGoogle.bind(controller),
  })

  app.post('/google/sync', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Sincronizar usuários com Google Workspace agora',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            synced:      { type: 'number' },
            deactivated: { type: 'number' },
          },
        },
      },
    },
    handler: controller.syncGoogle.bind(controller),
  })

  app.get('/ldap', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Obter configuração LDAP/Active Directory',
      security: [{ bearerAuth: [] }],
      response: { 200: ldapSchema },
    },
    handler: controller.getLdap.bind(controller),
  })

  ;(app as any).put('/ldap', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configurar integração LDAP/Active Directory',
      security: [{ bearerAuth: [] }],
      body: ldapBodySchema,
      response: { 200: ldapSchema },
    },
    handler: controller.upsertLdap.bind(controller),
  })

  ;(app as any).post('/ldap/test', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Testar conexão LDAP/Active Directory',
      security: [{ bearerAuth: [] }],
      body: ldapBodySchema,
      response: { 200: ldapTestSchema },
    },
    handler: controller.testLdap.bind(controller),
  })

  app.get('/openai', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Obter configuração da integração OpenAI para auditoria',
      security: [{ bearerAuth: [] }],
      response: { 200: openAiSchema },
    },
    handler: controller.getOpenAi.bind(controller),
  })

  ;(app as any).put('/openai', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configurar integração OpenAI para auditoria',
      security: [{ bearerAuth: [] }],
      body: openAiBodySchema,
      response: { 200: openAiSchema },
    },
    handler: controller.upsertOpenAi.bind(controller),
  })

  app.post('/openai/test', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Testar conexão com a OpenAI',
      security: [{ bearerAuth: [] }],
      response: { 200: openAiTestSchema },
    },
    handler: controller.testOpenAi.bind(controller),
  })

  app.get('/local-ai', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Obter configuração do Assistente local',
      security: [{ bearerAuth: [] }],
      response: { 200: localAiSchema },
    },
    handler: controller.getLocalAi.bind(controller),
  })

  ;(app as any).put('/local-ai', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configurar integração do Assistente local',
      security: [{ bearerAuth: [] }],
      body: localAiBodySchema,
      response: { 200: localAiSchema },
    },
    handler: controller.upsertLocalAi.bind(controller),
  })

  app.post('/local-ai/test', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Testar conexão do Assistente local',
      security: [{ bearerAuth: [] }],
      response: { 200: localAiTestSchema },
    },
    handler: controller.testLocalAi.bind(controller),
  })

  app.post('/local-ai/open-link', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Gerar link temporário de diagnóstico do Assistente local',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            expiresIn: { type: 'string' },
          },
          required: ['url', 'expiresIn'],
        },
      },
    },
    handler: controller.createLocalAiProxyLink.bind(controller),
  })

  app.get('/local-ai/activity', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Listar atividade recente do Assistente local',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              action: { type: 'string', enum: ['TEST_LOCAL_AI', 'OPEN_LOCAL_AI_DIAGNOSTIC'] },
              adminName: { type: 'string' },
              timestamp: { type: 'string' },
              details: { type: 'string', nullable: true },
            },
            required: ['id', 'action', 'adminName', 'timestamp', 'details'],
          },
        },
      },
    },
    handler: controller.getLocalAiRecentActivity.bind(controller),
  })

  app.get('/local-ai/proxy', {
    schema: {
      tags: tag,
      summary: 'Proxy temporário de diagnóstico do Assistente local',
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
    },
    handler: controller.proxyLocalAi.bind(controller),
  })

  app.get('/jira', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Obter configuração da integração JIRA',
      security: [{ bearerAuth: [] }],
      response: { 200: jiraSchema },
    },
    handler: controller.getJira.bind(controller),
  })

  ;(app as any).put('/jira', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Configurar integração JIRA',
      security: [{ bearerAuth: [] }],
      body: jiraBodySchema,
      response: { 200: jiraSchema },
    },
    handler: controller.upsertJira.bind(controller),
  })

  app.post('/jira/test', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Testar conexão com o JIRA',
      security: [{ bearerAuth: [] }],
      response: { 200: jiraTestSchema },
    },
    handler: controller.testJira.bind(controller),
  })

  ;(app as any).post('/jira/oauth/start', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Iniciar autorização OAuth read-only do Jira',
      security: [{ bearerAuth: [] }],
      body: { type: 'object', properties: { requestWrite: { type: 'boolean' } }, additionalProperties: false },
      response: { 200: { type: 'object', properties: { authorizationUrl: { type: 'string' }, expiresInSeconds: { type: 'number' } }, required: ['authorizationUrl', 'expiresInSeconds'] } },
    },
    handler: controller.beginJiraOAuth.bind(controller),
  })

  app.get('/jira/oauth/callback', {
    schema: {
      tags: tag,
      summary: 'Concluir callback OAuth do Jira',
      querystring: {
        type: 'object', required: ['code', 'state'],
        properties: { code: { type: 'string', minLength: 1 }, state: { type: 'string', minLength: 1 } },
      },
      response: { 200: { type: 'object', properties: { ok: { type: 'boolean' }, siteName: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'siteName', 'scopes'] } },
    },
    handler: controller.completeJiraOAuth.bind(controller),
  })
  app.delete('/jira/oauth', { preHandler: [requireAdmin], schema: { tags: tag, summary: 'Remover autorização OAuth do Jira', security: [{ bearerAuth: [] }] }, handler: controller.disconnectJiraOAuth.bind(controller) })

  ;(app as any).get('/jira/tickets/:key', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Ler ticket do JIRA por chave',
      security: [{ bearerAuth: [] }],
      response: { 200: jiraTicketSchema },
    },
    handler: controller.getJiraTicket.bind(controller),
  })

  app.get('/jira/session-policy', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Obter política Jira para sessões SSH', security: [{ bearerAuth: [] }],
      querystring: { type: 'object', required: ['hostId'], properties: { hostId: { type: 'integer', minimum: 1 } } },
    },
    handler: controller.getJiraSessionPolicy.bind(controller),
  })

  ;(app as any).post('/jira/session-authorizations', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Validar ticket e autorizar atendimento SSH',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['hostId'], additionalProperties: false,
        properties: { hostId: { type: 'integer', minimum: 1 }, ticketKey: { type: 'string', maxLength: 100 }, interactionId: { type: 'string', maxLength: 100 }, breakGlassReason: { type: 'string', minLength: 10, maxLength: 1000 } },
      },
    },
    handler: controller.authorizeJiraSession.bind(controller),
  })

  ;(app as any).get('/jira/interactions/:id', {
    preHandler: [requireAuth],
    schema: { tags: tag, summary: 'Obter atendimento Jira atual', security: [{ bearerAuth: [] }] },
    handler: controller.getJiraInteraction.bind(controller),
  })

  ;(app as any).post('/jira/interactions/:id/close', {
    preHandler: [requireAuth],
    schema: {
      tags: tag, summary: 'Encerrar atendimento Jira explicitamente', security: [{ bearerAuth: [] }],
      body: { type: 'object', required: ['auditUrl'], properties: { auditUrl: { type: 'string', maxLength: 2000 } } },
    },
    handler: controller.closeJiraInteraction.bind(controller),
  })
}
