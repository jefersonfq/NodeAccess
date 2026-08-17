import type { FastifyInstance } from 'fastify'
import {
  CreateLocalAiProposedActionSchema,
  LocalAiChatRequestSchema,
  LocalAiChatResponseSchema,
  LocalAiKnowledgeDocumentSchema,
  LocalAiProposedActionSchema,
  CreateLocalAiKnowledgeLinkDocumentSchema,
  CreateLocalAiKnowledgeTextDocumentSchema,
  LocalAiStatusSchema,
  LocalAiDiagnosticPlanRequestSchema,
  LocalAiDiagnosticPlanSchema,
  LocalAiTerminalAssistRequestSchema,
  LocalAiTerminalAssistSchema,
  LocalAiUsageSummarySchema,
  AiInteractionListSchema,
  ReviewLocalAiProposedActionSchema,
  CreateAiScriptArtifactSchema,
  AiScriptArtifactDetailSchema,
  AiSshActionRunDetailSchema,
} from '@nodeaccess/shared'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { LocalAiDiagnosticPlanRequest, LocalAiTerminalAssistRequest } from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { LocalAiController } from './local-ai.controller.js'

export async function localAiRoutes(app: FastifyInstance, controller: LocalAiController): Promise<void> {
  app.get('/status', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Obter disponibilidade do Assistente local',
      security: [{ bearerAuth: [] }],
      response: { 200: zodToJsonSchema(LocalAiStatusSchema) },
    },
    handler: controller.status.bind(controller),
  })

  app.get<{ Querystring: { days?: string } }>('/admin/usage', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Consultar consumo agregado dos providers de IA do tenant',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { days: { type: 'integer', minimum: 1, maximum: 366, default: 30 } },
      },
      response: { 200: zodToJsonSchema(LocalAiUsageSummarySchema) },
    },
    handler: controller.usageSummary.bind(controller),
  })

  app.get<{ Querystring: { limit?: string } }>('/admin/interactions', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Listar metadados sanitizados das interações de IA do tenant',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      },
      response: { 200: zodToJsonSchema(AiInteractionListSchema) },
    },
    handler: controller.interactions.bind(controller),
  })

  ;(app as any).post('/chat', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Conversar com o Assistente local em modo leitura',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(LocalAiChatRequestSchema),
      response: { 200: zodToJsonSchema(LocalAiChatResponseSchema) },
    },
    handler: controller.chat.bind(controller),
  })

  ;(app as any).post('/chat/stream', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Conversar com o Assistente local via Server-Sent Events (streaming)',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(LocalAiChatRequestSchema),
    },
    handler: controller.chatStream.bind(controller),
  })

  app.post<{ Body: LocalAiDiagnosticPlanRequest }>('/diagnostic-plan', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Gerar preview governado de diagnóstico SSH',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(LocalAiDiagnosticPlanRequestSchema),
      response: { 200: zodToJsonSchema(LocalAiDiagnosticPlanSchema) },
    },
    handler: controller.generateDiagnosticPlan.bind(controller),
  })

  app.post<{ Body: LocalAiTerminalAssistRequest }>('/terminal-assist', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Gerar explicação, comando ou script governado para o terminal',
      description: 'Retorna preview tipado; comandos passam pela policy e nunca são executados pelo endpoint.',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(LocalAiTerminalAssistRequestSchema),
      response: { 200: zodToJsonSchema(LocalAiTerminalAssistSchema) },
    },
    handler: controller.terminalAssist.bind(controller),
  })

  ;(app as any).post('/script-artifacts', {
    preHandler: [requireAuth],
    schema: { tags: ['LocalAI'], summary: 'Criar artefato governado de script', security: [{ bearerAuth: [] }], body: zodToJsonSchema(CreateAiScriptArtifactSchema), response: { 201: zodToJsonSchema(AiScriptArtifactDetailSchema) } },
    handler: controller.createScriptArtifact.bind(controller),
  })

  ;(app as any).get('/script-artifacts/:id', {
    preHandler: [requireAuth],
    schema: { tags: ['LocalAI'], summary: 'Consultar artefato governado de script', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }, response: { 200: zodToJsonSchema(AiScriptArtifactDetailSchema) } },
    handler: controller.getScriptArtifact.bind(controller),
  })

  ;(app as any).post('/script-artifacts/:id/request-execution', {
    preHandler: [requireAuth],
    schema: { tags: ['LocalAI'], summary: 'Encaminhar script para ActionRun com aprovação', security: [{ bearerAuth: [] }], params: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } }, body: { type: 'object', properties: { approvalReason: { type: ['string', 'null'], maxLength: 500 } } }, response: { 201: zodToJsonSchema(AiSshActionRunDetailSchema) } },
    handler: controller.requestScriptExecution.bind(controller),
  })

  app.get('/proposed-actions', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Listar propostas de ação de baixo impacto do usuário',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: zodToJsonSchema(LocalAiProposedActionSchema) } },
    },
    handler: controller.listMineProposedActions.bind(controller),
  })

  ;(app as any).post('/proposed-actions', {
    preHandler: [requireAuth],
    schema: {
      tags: ['LocalAI'],
      summary: 'Criar proposta de ação de baixo impacto',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateLocalAiProposedActionSchema),
      response: { 201: zodToJsonSchema(LocalAiProposedActionSchema) },
    },
    handler: controller.createProposedAction.bind(controller),
  })

  app.get('/admin/proposed-actions', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Listar propostas de ação de baixo impacto para revisão admin',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: zodToJsonSchema(LocalAiProposedActionSchema) } },
    },
    handler: controller.listAdminProposedActions.bind(controller),
  })

  ;(app as any).patch('/admin/proposed-actions/:id/review', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Aprovar ou rejeitar proposta de ação de baixo impacto',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: zodToJsonSchema(ReviewLocalAiProposedActionSchema),
      response: { 200: zodToJsonSchema(LocalAiProposedActionSchema) },
    },
    handler: controller.reviewProposedAction.bind(controller),
  })

  app.get('/admin/documents', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Listar documentos da base de conhecimento da IA',
      security: [{ bearerAuth: [] }],
      response: { 200: { type: 'array', items: zodToJsonSchema(LocalAiKnowledgeDocumentSchema) } },
    },
    handler: controller.listAdminDocuments.bind(controller),
  })

  ;(app as any).post('/admin/documents/text', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Criar documento textual na base de conhecimento da IA',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateLocalAiKnowledgeTextDocumentSchema),
      response: { 201: zodToJsonSchema(LocalAiKnowledgeDocumentSchema) },
    },
    handler: controller.createTextDocument.bind(controller),
  })

  ;(app as any).post('/admin/documents/link', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Criar referência/link na base de conhecimento da IA',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateLocalAiKnowledgeLinkDocumentSchema),
      response: { 201: zodToJsonSchema(LocalAiKnowledgeDocumentSchema) },
    },
    handler: controller.createLinkDocument.bind(controller),
  })

  app.post('/admin/documents/upload', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Enviar arquivo textual para a base de conhecimento da IA',
      security: [{ bearerAuth: [] }],
      consumes: ['multipart/form-data'],
      response: { 201: zodToJsonSchema(LocalAiKnowledgeDocumentSchema) },
    },
    handler: controller.uploadDocument.bind(controller),
  })

  app.delete<{ Params: { id: string } }>('/admin/documents/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['LocalAI'],
      summary: 'Remover documento da base de conhecimento da IA',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      response: { 204: { type: 'null' } },
    },
    handler: controller.deleteDocument.bind(controller),
  })
}
