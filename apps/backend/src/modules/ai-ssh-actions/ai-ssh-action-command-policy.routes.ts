import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { AiSshActionCommandPolicyController } from './ai-ssh-action-command-policy.controller.js'

interface PolicyBody {
  safePatterns?: string[]
  approvalPatterns?: string[]
  blockedPatterns?: string[]
}

interface EvaluateBody {
  command?: string
}

const policyBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    safePatterns: { type: 'array', items: { type: 'string' } },
    approvalPatterns: { type: 'array', items: { type: 'string' } },
    blockedPatterns: { type: 'array', items: { type: 'string' } },
  },
} as const

export async function aiSshActionCommandPolicyRoutes(app: FastifyInstance, controller: AiSshActionCommandPolicyController): Promise<void> {
  app.get('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Obter policy de comandos SSH por IA do tenant',
    },
  }, (req, rep) => controller.get(req, rep))

  app.put<{ Body: PolicyBody }>('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Atualizar policy de comandos SSH por IA do tenant',
      body: policyBodySchema,
    },
  }, (req, rep) => controller.update(req, rep))

  app.post<{ Body: EvaluateBody }>('/evaluate', {
    preHandler: [requireAuth, requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Avaliar comando contra a policy de comandos SSH por IA',
      body: {
        type: 'object',
        required: ['command'],
        properties: {
          command: { type: 'string', minLength: 1 },
        },
      },
    },
  }, (req, rep) => controller.evaluate(req, rep))
}
