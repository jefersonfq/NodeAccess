import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CreateDiagnosticRunSchema,
  DiagnosticRunDetailSchema,
  DiagnosticRunPublicSchema,
} from '@nodeaccess/shared'
import type { CreateDiagnosticRunDto } from '@nodeaccess/shared'
import { requireAuth } from '../../shared/guards.js'
import type { DiagnosticRunController } from './diagnostic-run.controller.js'

const tag = ['DiagnosticPlaybooks']

interface HostParam {
  id: string
}

interface RunParam {
  runId: string
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

export async function diagnosticRunHostRoutes(app: FastifyInstance, controller: DiagnosticRunController): Promise<void> {
  app.get<{ Params: HostParam }>('/:id/diagnostic-runs', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar execucoes de diagnostico do host',
      description: 'Lista execucoes de diagnostico vinculadas ao host informado e visiveis ao usuario autenticado.',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      response: {
        200: {
          type: 'array',
          items: zodToJsonSchema(DiagnosticRunPublicSchema),
        },
      },
    },
  }, (request, reply) => controller.listForHost(request, reply))

  app.post<{ Params: HostParam; Body: CreateDiagnosticRunDto }>('/:id/diagnostic-runs', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Solicitar execucao de diagnostico para o host',
      description: 'Solicita a execucao controlada de um playbook no host. A operacao e auditavel e pode gerar resumo por IA.',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      body: zodToJsonSchema(CreateDiagnosticRunSchema),
      response: {
        201: zodToJsonSchema(DiagnosticRunDetailSchema),
      },
    },
  }, (request, reply) => controller.createForHost(request, reply))
}

export async function diagnosticRunRoutes(app: FastifyInstance, controller: DiagnosticRunController): Promise<void> {
  app.get<{ Params: RunParam }>('/:runId', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Detalhar execucao de diagnostico',
      description: 'Retorna status, comandos, saidas truncadas/redigidas e resumo de uma execucao de diagnostico.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: {
        200: zodToJsonSchema(DiagnosticRunDetailSchema),
      },
    },
  }, (request, reply) => controller.getById(request, reply))

  app.post<{ Params: RunParam }>('/:runId/ai-summary', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Solicitar regeneracao do resumo por IA do diagnostico',
      description: 'Reprocessa o resumo por IA sem executar novamente o playbook no host.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: {
        200: zodToJsonSchema(DiagnosticRunDetailSchema),
      },
    },
  }, (request, reply) => controller.regenerateSummary(request, reply))

  app.get<{ Params: RunParam }>('/:runId/download', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Exportar execucao de diagnostico em JSON',
      description: 'Baixa a execucao de diagnostico em JSON para suporte, investigacao ou anexacao em processo externo.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
    },
  }, (request, reply) => controller.download(request, reply))
}
