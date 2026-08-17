import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CreateDiagnosticRunSchema,
  DiagnosticRunDetailSchema,
  DiagnosticRunPublicSchema,
  DiagnosticRunReportSchema,
  DiagnosticRunComparisonSchema,
  DiagnosticRunHistorySchema,
  UpdateDiagnosticRunTraceabilitySchema,
  PublishDiagnosticRunReportToJiraSchema,
  PublishDiagnosticRunReportToJiraResultSchema,
} from '@nodeaccess/shared'
import type { CreateDiagnosticRunDto, PublishDiagnosticRunReportToJiraDto, UpdateDiagnosticRunTraceabilityDto } from '@nodeaccess/shared'
import { requireAuth } from '../../shared/guards.js'
import type { DiagnosticRunController } from './diagnostic-run.controller.js'

const tag = ['DiagnosticPlaybooks']

interface HostParam {
  id: string
}

interface RunParam {
  runId: string
}

interface CompareParam extends RunParam {
  baselineRunId: string
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

const compareParamSchema = {
  type: 'object',
  properties: { runId: { type: 'integer' }, baselineRunId: { type: 'integer' } },
  required: ['runId', 'baselineRunId'],
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

  app.get<{ Params: HostParam }>('/:id/diagnostic-runs/history', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Consultar histórico consolidado de diagnósticos do host',
      description: 'Consolida as 30 execuções mais recentes, falhas, risco e achados recorrentes sem inferência causal.',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      response: { 200: zodToJsonSchema(DiagnosticRunHistorySchema) },
    },
  }, (request, reply) => controller.getHistoryForHost(request, reply))

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

  app.get<{ Params: RunParam }>('/:runId/report', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Consultar relatório verificável do diagnóstico',
      description: 'Retorna identidade, rastreabilidade, resumo, evidências e checksum SHA-256 do diagnóstico.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      response: { 200: zodToJsonSchema(DiagnosticRunReportSchema) },
    },
  }, (request, reply) => controller.getReport(request, reply))

  app.get<{ Params: CompareParam }>('/:runId/compare/:baselineRunId', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Comparar duas execuções do mesmo host',
      description: 'Compara evidências e achados de forma determinística, respeitando o acesso às duas execuções.',
      security: [{ bearerAuth: [] }],
      params: compareParamSchema,
      response: { 200: zodToJsonSchema(DiagnosticRunComparisonSchema) },
    },
  }, (request, reply) => controller.compareRuns(request, reply))

  app.patch<{ Params: RunParam; Body: UpdateDiagnosticRunTraceabilityDto }>('/:runId/traceability', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Vincular origem validada ao diagnóstico',
      description: 'Vincula sessão, ticket e/ou ActionRun do mesmo tenant, host e escopo do usuário.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      body: zodToJsonSchema(UpdateDiagnosticRunTraceabilitySchema),
      response: { 200: zodToJsonSchema(DiagnosticRunDetailSchema) },
    },
  }, (request, reply) => controller.updateTraceability(request, reply))

  app.post<{ Params: RunParam; Body: PublishDiagnosticRunReportToJiraDto }>('/:runId/report/jira', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Enfileirar publicação do relatório no Jira',
      description: 'Publica comentário e, opcionalmente, anexo JSON via outbox idempotente.',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
      body: zodToJsonSchema(PublishDiagnosticRunReportToJiraSchema),
      response: { 202: zodToJsonSchema(PublishDiagnosticRunReportToJiraResultSchema) },
    },
  }, (request, reply) => controller.publishReportToJira(request, reply))
}
