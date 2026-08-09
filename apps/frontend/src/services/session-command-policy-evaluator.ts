import type {
  SessionCommandPolicyDefaultAction,
  SessionCommandPolicyRule,
} from './session-command-policy.service'

export interface LocalPolicyEvaluation {
  action: 'allow' | 'block'
  matchedRule: SessionCommandPolicyRule | null
  source: 'rule' | 'default'
  message: string
}

export function evaluatePolicyGroupCommand(
  command: string,
  defaultAction: SessionCommandPolicyDefaultAction,
  rules: SessionCommandPolicyRule[],
): LocalPolicyEvaluation | null {
  const normalizedCommand = command.trim()
  if (!normalizedCommand) return null

  const sortedRules = [...rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      if (a.action === b.action) return 0
      return a.action === 'block' ? -1 : 1
    })
  const matchedRule = sortedRules.find((rule) => commandMatchesPolicyRule(normalizedCommand, rule)) ?? null
  const action = matchedRule?.action ?? defaultAction

  return {
    action,
    matchedRule,
    source: matchedRule ? 'rule' : 'default',
    message: matchedRule?.message ?? (action === 'block'
      ? 'Comando seria bloqueado pela ação padrão do grupo.'
      : 'Comando seria permitido pela ação padrão do grupo.'),
  }
}

export function commandMatchesPolicyRule(
  command: string,
  rule: Pick<SessionCommandPolicyRule, 'type' | 'pattern'>,
) {
  const pattern = rule.pattern.trim()
  if (!pattern) return false
  if (rule.type === 'exact') return command === pattern
  if (rule.type === 'prefix') return command.startsWith(pattern)
  if (rule.type === 'contains') return command.includes(pattern)
  try {
    return new RegExp(pattern, 'i').test(command)
  } catch {
    return false
  }
}
