import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  AiSshActionRunDetailSchema,
  AiSshActionRunPublicSchema,
  CreateAiSshActionRunSchema,
} from '@nodeaccess/shared'
import type { CreateAiSshActionRunDto } from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { AiSshActionController } from './ai-ssh-action.controller.js'

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
      tags: ['Hosts'],
      summary: 'Listar action runs por IA do host',
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
      tags: ['Hosts'],
      summary: 'Solicitar action run por IA para o host',
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
      tags: ['Hosts'],
      summary: 'Detalhar action run por IA',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: {
        200: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.getById(request, reply))

  app.post<{ Params: RunParams; Body: ApprovalBody }>('/:runId/approve', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Hosts'],
      summary: 'Aprovar action run por IA',
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
      tags: ['Hosts'],
      summary: 'Rejeitar action run por IA',
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
      tags: ['Hosts'],
      summary: 'Cancelar action run por IA',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: {
        200: zodToJsonSchema(AiSshActionRunDetailSchema),
      },
    },
  }, (request, reply) => controller.cancel(request, reply))
}
