export type SessionCommandRuleType = 'regex' | 'contains' | 'prefix' | 'exact'
export type SessionCommandRuleAction = 'allow' | 'block'

export interface SessionCommandRule {
  id: string
  type: SessionCommandRuleType
  pattern: string
  action: SessionCommandRuleAction
  message?: string
  enabled: boolean
  priority: number
}

export interface SessionCommandPolicyDecision {
  action: SessionCommandRuleAction
  ruleId?: string
  message?: string
}

export class SessionCommandPolicyEvaluator {
  evaluate(command: string, rules: SessionCommandRule[], defaultAction: SessionCommandRuleAction = 'allow'): SessionCommandPolicyDecision {
    const normalizedCommand = command.trim()
    if (!normalizedCommand) return { action: 'allow' }

    const matchingRules = rules
      .filter((rule) => rule.enabled && this.matches(normalizedCommand, rule))
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority
        if (a.action === b.action) return 0
        return a.action === 'block' ? -1 : 1
      })

    const match = matchingRules[0]
    if (!match) return { action: defaultAction }

    return {
      action: match.action,
      ruleId: match.id,
      ...(match.message !== undefined && { message: match.message }),
    }
  }

  private matches(command: string, rule: SessionCommandRule): boolean {
    if (!rule.pattern.trim()) return false

    if (rule.type === 'exact') {
      return command === rule.pattern
    }

    if (rule.type === 'prefix') {
      return command.startsWith(rule.pattern)
    }

    if (rule.type === 'contains') {
      return command.includes(rule.pattern)
    }

    try {
      return new RegExp(rule.pattern, 'i').test(command)
    } catch {
      return false
    }
  }
}
