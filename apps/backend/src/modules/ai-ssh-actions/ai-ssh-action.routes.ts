import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  AiSshActionRunDetailSchema,
  AiSshActionRunPublicSchema,
  CreateAiSshActionRunSchema,
  AiSshActionRunReportSchema,
} from '@nodeaccess/shared'
import type { CreateAiSshActionRunDto } from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { AiSshActionController } from './ai-ssh-action.controller.js'

const tag = ['AiSshActions']

interface HostParams {
  id: string
}

interface RunParams {
  runId: string
}

interface ApprovalBody {
  approvalReason?: string | null
}

const hostParamSchema = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

const runParamSchema = {
  type: 'object',
  properties: { runId: { type: 'integer' } },
  required: ['runId'],
}

const approvalBodySchema = {
  type: 'object',
  properties: {
    approvalReason: { type: ['string', 'null'], maxLength: 500 },
  },
}

export async function aiSshActionHostRoutes(app: FastifyInstance, controller: AiSshActionController): Promise<void> {
  app.get<{ Params: HostParams }>('/:id/ai-ssh-action-runs', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar action runs por IA do host',
      description: 'Lista action runs de IA associados ao host informado e visiveis ao usuario autenticado.',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      response: {
        200: {
          type: 'array',
          items: zodToJsonSchema(AiSshActionRunPublicSchema),
        },
      },
    },
  }, (request, reply) => controller.listForHost(request, reply))

  app.post<{ Params: HostParams; Body: Omit<CreateAiSshActionRunDto, 'hostId'> }>('/:id/ai-ssh-action-runs', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Solicitar action run por IA para o host',
      description: 'Solicita uma acao SSH governada por IA para um host. A execucao segue policy, aprovacao quando aplicavel e auditoria.',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      body: zodToJsonSchema(CreateAiSshActionRunSchema.omit({ hostId: true })),
      response: {
        201: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.createForHost(request, reply))
}

export async function aiSshActionRoutes(app: FastifyInstance, controller: AiSshActionController): Promise<void> {
  app.get<{ Params: RunParams }>('/:runId', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Detalhar action run por IA',
      description: 'Retorna status, escopo, policy, aprovacao e resultado de um action run SSH por IA.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: {
        200: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.getById(request, reply))

  app.get<{ Params: RunParams }>('/:runId/report', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Consultar relatório verificável do ActionRun',
      description: 'Retorna avaliação determinística, evidências sanitizadas e checksum do ActionRun.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: { 200: zodToJsonSchema(AiSshActionRunReportSchema) },
    },
  }, (request, reply) => controller.getReport(request, reply))

  app.post<{ Params: RunParams; Body: ApprovalBody }>('/:runId/approve', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Aprovar action run por IA',
      description: 'Aprova uma acao SSH por IA que exige aprovacao administrativa antes da execucao.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      body: approvalBodySchema,
      response: {
        200: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.approve(request, reply))

  app.post<{ Params: RunParams; Body: ApprovalBody }>('/:runId/reject', {
    preHandler: [requireAdmin],
    schema: {
      tags: tag,
      summary: 'Rejeitar action run por IA',
      description: 'Rejeita uma acao SSH por IA pendente de aprovacao administrativa.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      body: approvalBodySchema,
      response: {
        200: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.reject(request, reply))

  app.post<{ Params: RunParams }>('/:runId/cancel', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Cancelar action run por IA',
      description: 'Cancela um action run SSH por IA quando o estado atual permite cancelamento.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: {
        200: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.cancel(request, reply))
}
