import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { SessionCommandPolicyController } from './session-command-policy.controller.js'

const tag = ['CommandPolicies']

const groupBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: ['string', 'null'] },
    enabled: { type: 'boolean' },
    priority: { type: 'number' },
    defaultAction: { type: 'string', enum: ['allow', 'block'] },
  },
} as const

const ruleBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['regex', 'contains', 'prefix', 'exact'] },
    pattern: { type: 'string', minLength: 1 },
    action: { type: 'string', enum: ['allow', 'block'] },
    message: { type: ['string', 'null'] },
    enabled: { type: 'boolean' },
    priority: { type: 'number' },
  },
} as const

const bindingBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetType'],
  properties: {
    targetType: { type: 'string', enum: ['global', 'user', 'user_group', 'host', 'host_group'] },
    targetId: { type: ['number', 'null'] },
  },
} as const

const evaluateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['command', 'userId', 'hostId'],
  properties: {
    command: { type: 'string', minLength: 1 },
    userId: { type: 'number' },
    hostId: { type: 'number' },
  },
} as const

export async function sessionCommandPolicyRoutes(app: FastifyInstance, controller: SessionCommandPolicyController): Promise<void> {
  app.get('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Listar politicas de comandos de sessao', security: [{ bearerAuth: [] }] },
  }, (req, rep) => controller.listGroups(req, rep))

  app.post<{ Body: import('./session-command-policy.service.js').SessionCommandPolicyEvaluateInput }>('/evaluate', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Simular politica efetiva de comandos de sessao', security: [{ bearerAuth: [] }], body: evaluateBodySchema },
  }, (req, rep) => controller.evaluate(req, rep))

  app.post<{ Body: import('./session-command-policy.service.js').SessionCommandPolicyGroupInput }>('/', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Criar politica de comandos de sessao', security: [{ bearerAuth: [] }], body: { ...groupBodySchema, required: ['name'] } },
  }, (req, rep) => controller.createGroup(req, rep))

  app.patch<{ Params: { policyGroupId: string }; Body: import('./session-command-policy.service.js').SessionCommandPolicyGroupInput }>('/:policyGroupId', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Atualizar politica de comandos de sessao', security: [{ bearerAuth: [] }], body: groupBodySchema },
  }, (req, rep) => controller.updateGroup(req, rep))

  app.delete<{ Params: { policyGroupId: string } }>('/:policyGroupId', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Excluir politica de comandos de sessao', security: [{ bearerAuth: [] }] },
  }, (req, rep) => controller.deleteGroup(req, rep))

  app.get<{ Params: { policyGroupId: string } }>('/:policyGroupId/rules', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Listar regras da politica de comandos', security: [{ bearerAuth: [] }] },
  }, (req, rep) => controller.listRules(req, rep))

  app.post<{ Params: { policyGroupId: string }; Body: import('./session-command-policy.service.js').SessionCommandPolicyRuleInput }>('/:policyGroupId/rules', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Criar regra da politica de comandos', security: [{ bearerAuth: [] }], body: { ...ruleBodySchema, required: ['type', 'pattern'] } },
  }, (req, rep) => controller.createRule(req, rep))

  app.delete<{ Params: { policyGroupId: string; ruleId: string } }>('/:policyGroupId/rules/:ruleId', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Excluir regra da politica de comandos', security: [{ bearerAuth: [] }] },
  }, (req, rep) => controller.deleteRule(req, rep))

  app.get<{ Params: { policyGroupId: string } }>('/:policyGroupId/bindings', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Listar vinculos da politica de comandos', security: [{ bearerAuth: [] }] },
  }, (req, rep) => controller.listBindings(req, rep))

  app.post<{ Params: { policyGroupId: string }; Body: import('./session-command-policy.service.js').SessionCommandPolicyBindingInput }>('/:policyGroupId/bindings', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Criar vinculo da politica de comandos', security: [{ bearerAuth: [] }], body: bindingBodySchema },
  }, (req, rep) => controller.createBinding(req, rep))

  app.delete<{ Params: { policyGroupId: string; bindingId: string } }>('/:policyGroupId/bindings/:bindingId', {
    preHandler: [requireAuth, requireAdmin],
    schema: { tags: tag, summary: 'Excluir vinculo da politica de comandos', security: [{ bearerAuth: [] }] },
  }, (req, rep) => controller.deleteBinding(req, rep))
}
