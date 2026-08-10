import { AppError, NotFoundError } from '../../shared/errors.js'
import type {
  SessionCommandBindingTargetType,
  SessionCommandPolicyBindingRecord,
  SessionCommandPolicyGroupRecord,
  SessionCommandPolicyRepository,
  SessionCommandPolicyRuleRecord,
} from './session-command-policy.repository.js'
import {
  SessionCommandPolicyEvaluator,
  type SessionCommandRuleAction,
  type SessionCommandRuleType,
} from './session-command-policy.evaluator.js'

export interface SessionCommandPolicyGroupInput {
  name?: string
  description?: string | null
  enabled?: boolean
  priority?: number
  defaultAction?: 'allow' | 'block'
}

export interface SessionCommandPolicyRuleInput {
  type?: SessionCommandRuleType
  pattern?: string
  action?: SessionCommandRuleAction
  message?: string | null
  enabled?: boolean
  priority?: number
}

export interface SessionCommandPolicyBindingInput {
  targetType?: SessionCommandBindingTargetType
  targetId?: number | null
}

export interface SessionCommandPolicyEvaluateInput {
  command?: string
  userId?: number
  hostId?: number
}

export interface SessionCommandPolicyEvaluateResult {
  command: string
  action: SessionCommandRuleAction
  source: 'rule' | 'runtime_default'
  defaultAction: SessionCommandRuleAction
  matchedRule: null | {
    id: string
    type: SessionCommandRuleType
    pattern: string
    action: SessionCommandRuleAction
    message?: string
    priority: number
  }
  message?: string
  rulesEvaluated: number
}

export class SessionCommandPolicyService {
  constructor(private readonly repository: SessionCommandPolicyRepository) {}

  listGroups(tenantId: number): Promise<SessionCommandPolicyGroupRecord[]> {
    return this.repository.listGroups(tenantId)
  }

  async evaluate(tenantId: number, input: SessionCommandPolicyEvaluateInput): Promise<SessionCommandPolicyEvaluateResult> {
    const command = normalizeRequiredString(input.command, 'Comando obrigatorio')
    const userId = normalizePositiveInteger(input.userId, 'Usuario obrigatorio')
    const hostId = normalizePositiveInteger(input.hostId, 'Host obrigatorio')
    const [rules, defaultAction] = await Promise.all([
      this.repository.findEffectiveRules({ tenantId, userId, hostId }),
      this.repository.findEffectiveDefaultAction({ tenantId, userId, hostId }),
    ])
    const decision = new SessionCommandPolicyEvaluator().evaluate(command, rules, defaultAction)
    const matchedRule = decision.ruleId ? rules.find((rule) => rule.id === decision.ruleId) ?? null : null

    return {
      command,
      action: decision.action,
      source: matchedRule ? 'rule' : 'runtime_default',
      defaultAction,
      matchedRule: matchedRule
        ? {
            id: matchedRule.id,
            type: matchedRule.type,
            pattern: matchedRule.pattern,
            action: matchedRule.action,
            ...(matchedRule.message !== undefined && { message: matchedRule.message }),
            priority: matchedRule.priority,
          }
        : null,
      ...(decision.message !== undefined && { message: decision.message }),
      rulesEvaluated: rules.length,
    }
  }

  async createGroup(tenantId: number, input: SessionCommandPolicyGroupInput): Promise<SessionCommandPolicyGroupRecord> {
    const name = normalizeRequiredString(input.name, 'Nome da politica obrigatorio')
    return this.repository.createGroup({
      tenantId,
      name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      defaultAction: input.defaultAction ?? 'allow',
    })
  }

  async updateGroup(tenantId: number, id: number, input: SessionCommandPolicyGroupInput): Promise<SessionCommandPolicyGroupRecord> {
    if (input.name !== undefined) normalizeRequiredString(input.name, 'Nome da politica obrigatorio')
    const updated = await this.repository.updateGroup(tenantId, id, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.priority !== undefined && { priority: input.priority }),
      ...(input.defaultAction !== undefined && { defaultAction: input.defaultAction }),
    })
    if (!updated) throw new NotFoundError('Politica de comandos')
    return updated
  }

  async deleteGroup(tenantId: number, id: number): Promise<void> {
    await this.repository.deleteGroup(tenantId, id)
  }

  listRules(tenantId: number, policyGroupId: number): Promise<SessionCommandPolicyRuleRecord[]> {
    return this.repository.listRules(tenantId, policyGroupId)
  }

  async createRule(tenantId: number, policyGroupId: number, input: SessionCommandPolicyRuleInput): Promise<SessionCommandPolicyRuleRecord> {
    const type = input.type ?? 'contains'
    const pattern = normalizeRequiredString(input.pattern, 'Padrao da regra obrigatorio')
    validateRule(type, pattern)
    return this.repository.createRule(tenantId, policyGroupId, {
      type,
      pattern,
      action: input.action ?? 'block',
      message: input.message ?? null,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
    })
  }

  async deleteRule(tenantId: number, policyGroupId: number, ruleId: number): Promise<void> {
    await this.repository.deleteRule(tenantId, policyGroupId, ruleId)
  }

  listBindings(tenantId: number, policyGroupId: number): Promise<SessionCommandPolicyBindingRecord[]> {
    return this.repository.listBindings(tenantId, policyGroupId)
  }

  async createBinding(tenantId: number, policyGroupId: number, input: SessionCommandPolicyBindingInput): Promise<SessionCommandPolicyBindingRecord> {
    if (!input.targetType) throw new AppError('Tipo de vinculo obrigatorio', 400, 'SESSION_COMMAND_POLICY_BINDING_TARGET_TYPE_REQUIRED')
    if (input.targetType !== 'global' && typeof input.targetId !== 'number') {
      throw new AppError('targetId obrigatorio para este tipo de vinculo', 400, 'SESSION_COMMAND_POLICY_BINDING_TARGET_ID_REQUIRED')
    }
    const targetId = input.targetType === 'global' ? null : input.targetId!
    const duplicate = (await this.repository.listBindings(tenantId, policyGroupId)).some((binding) =>
      binding.targetType === input.targetType && binding.targetId === targetId,
    )
    if (duplicate) {
      throw new AppError('Este vinculo ja existe neste grupo', 409, 'SESSION_COMMAND_POLICY_BINDING_DUPLICATE')
    }
    return this.repository.createBinding(tenantId, policyGroupId, { targetType: input.targetType, targetId })
  }

  async deleteBinding(tenantId: number, policyGroupId: number, bindingId: number): Promise<void> {
    await this.repository.deleteBinding(tenantId, policyGroupId, bindingId)
  }
}

function normalizeRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(message, 400, 'SESSION_COMMAND_POLICY_VALIDATION_ERROR')
  }
  return value.trim()
}

function normalizePositiveInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppError(message, 400, 'SESSION_COMMAND_POLICY_VALIDATION_ERROR')
  }
  return value
}

function validateRule(type: SessionCommandRuleType, pattern: string): void {
  if (!['regex', 'contains', 'prefix', 'exact'].includes(type)) {
    throw new AppError('Tipo de regra invalido', 400, 'SESSION_COMMAND_POLICY_RULE_TYPE_INVALID')
  }
  if (type === 'regex') {
    try {
      new RegExp(pattern, 'i')
    } catch {
      throw new AppError('Regex invalida na regra de comando', 400, 'SESSION_COMMAND_POLICY_REGEX_INVALID')
    }
  }
}
