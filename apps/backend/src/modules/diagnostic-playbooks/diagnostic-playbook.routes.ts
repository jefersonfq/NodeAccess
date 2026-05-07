import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CreateDiagnosticPlaybookSchema,
  DiagnosticPlaybookPublicSchema,
  UpdateDiagnosticPlaybookSchema,
} from '@nodeaccess/shared'
import type { CreateDiagnosticPlaybookDto, UpdateDiagnosticPlaybookDto } from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { DiagnosticPlaybookController } from './diagnostic-playbook.controller.js'

interface HostParam {
  id: string
}

interface PlaybookParam {
  id: string
}

const hostParamSchema = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

const playbookParamSchema = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

export async function diagnosticPlaybookRoutes(app: FastifyInstance, controller: DiagnosticPlaybookController): Promise<void> {
  app.get<{ Params: HostParam }>('/:id/diagnostic-playbooks', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Hosts'],
      summary: 'Listar playbooks de diagnostico disponiveis para o host',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      response: {
        200: {
          type: 'array',
          items: zodToJsonSchema(DiagnosticPlaybookPublicSchema),
        },
      },
    },
  }, (request, reply) => controller.listForHost(request, reply))
}

export async function diagnosticPlaybookAdminRoutes(app: FastifyInstance, controller: DiagnosticPlaybookController): Promise<void> {
  app.get('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Hosts'],
      summary: 'Listar catalogo administrativo de playbooks de diagnostico',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: zodToJsonSchema(DiagnosticPlaybookPublicSchema),
        },
      },
    },
  }, (request, reply) => controller.listAdmin(request, reply))

  app.post<{ Body: CreateDiagnosticPlaybookDto }>('/', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Hosts'],
      summary: 'Criar playbook de diagnostico',
      security: [{ bearerAuth: [] }],
      body: zodToJsonSchema(CreateDiagnosticPlaybookSchema),
      response: {
        201: zodToJsonSchema(DiagnosticPlaybookPublicSchema),
      },
    },
  }, (request, reply) => controller.createAdmin(request, reply))

  app.patch<{ Params: PlaybookParam; Body: UpdateDiagnosticPlaybookDto }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Hosts'],
      summary: 'Atualizar playbook de diagnostico',
      security: [{ bearerAuth: [] }],
      params: playbookParamSchema,
      body: zodToJsonSchema(UpdateDiagnosticPlaybookSchema),
      response: {
        200: zodToJsonSchema(DiagnosticPlaybookPublicSchema),
      },
    },
  }, (request, reply) => controller.updateAdmin(request, reply))

  app.delete<{ Params: PlaybookParam }>('/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Hosts'],
      summary: 'Excluir playbook de diagnostico',
      security: [{ bearerAuth: [] }],
      params: playbookParamSchema,
      response: {
        204: { type: 'null' },
      },
    },
  }, (request, reply) => controller.deleteAdmin(request, reply))

  app.get<{ Params: PlaybookParam }>('/:id/history', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Hosts'],
      summary: 'Listar historico administrativo do playbook de diagnostico',
      security: [{ bearerAuth: [] }],
      params: playbookParamSchema,
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              action: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              adminName: { type: 'string' },
              details: { type: ['string', 'null'] },
            },
            required: ['id', 'action', 'timestamp', 'adminName', 'details'],
          },
        },
      },
    },
  }, (request, reply) => controller.listAdminHistory(request, reply))
}
