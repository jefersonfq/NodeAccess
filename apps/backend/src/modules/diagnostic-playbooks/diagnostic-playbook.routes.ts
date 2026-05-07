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

const tag = ['DiagnosticPlaybooks']

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
      tags: tag,
      summary: 'Listar playbooks de diagnostico disponiveis para o host',
      description: 'Retorna o catalogo de playbooks que podem ser executados no host informado, respeitando visibilidade e permissoes do usuario autenticado.',
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
      tags: tag,
      summary: 'Listar catalogo administrativo de playbooks de diagnostico',
      description: 'Lista todos os playbooks de diagnostico configurados no tenant para administracao do catalogo.',
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
      tags: tag,
      summary: 'Criar playbook de diagnostico',
      description: 'Cria um playbook de diagnostico controlado. O conteudo deve ser tratado como acao operacional auditavel.',
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
      tags: tag,
      summary: 'Atualizar playbook de diagnostico',
      description: 'Atualiza metadados ou comandos de um playbook existente preservando historico administrativo.',
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
      tags: tag,
      summary: 'Excluir playbook de diagnostico',
      description: 'Remove um playbook do catalogo administrativo. Historicos operacionais devem permanecer auditaveis.',
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
      tags: tag,
      summary: 'Listar historico administrativo do playbook de diagnostico',
      description: 'Retorna eventos administrativos associados ao playbook para rastreabilidade de alteracoes.',
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
