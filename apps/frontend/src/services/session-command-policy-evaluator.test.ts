import { describe, expect, it } from 'vitest'
import type { SessionCommandPolicyRule } from './session-command-policy.service'
import { commandMatchesPolicyRule, evaluatePolicyGroupCommand } from './session-command-policy-evaluator'

function rule(overrides: Partial<SessionCommandPolicyRule>): SessionCommandPolicyRule {
  return {
    id: 'rule-1',
    policyGroupId: 1,
    type: 'contains',
    pattern: 'shutdown',
    action: 'block',
    message: 'Bloqueado',
    priority: 100,
    enabled: true,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('commandMatchesPolicyRule', () => {
  it.each([
    ['contains', 'sudo shutdown now', 'shutdown', true],
    ['prefix', 'sudo systemctl stop nginx', 'sudo systemctl', true],
    ['exact', 'reboot', 'reboot', true],
    ['exact', 'sudo reboot', 'reboot', false],
    ['regex', 'sudo   su -', '^sudo\\s+su', true],
  ] as const)('matches %s rules', (type, command, pattern, expected) => {
    expect(commandMatchesPolicyRule(command, rule({ type, pattern }))).toBe(expected)
  })

  it('treats an invalid regex as no match', () => {
    expect(commandMatchesPolicyRule('anything', rule({ type: 'regex', pattern: '[' }))).toBe(false)
  })
})

describe('evaluatePolicyGroupCommand', () => {
  it('uses the highest-priority active matching rule', () => {
    const result = evaluatePolicyGroupCommand('sudo shutdown now', 'allow', [
      rule({ id: 'allow', action: 'allow', priority: 100 }),
      rule({ id: 'block', action: 'block', priority: 200 }),
      rule({ id: 'inactive', action: 'allow', priority: 300, enabled: false }),
    ])
    expect(result).toMatchObject({ action: 'block', source: 'rule' })
    expect(result?.matchedRule?.id).toBe('block')
  })

  it('gives block precedence when matching rules share a priority', () => {
    const result = evaluatePolicyGroupCommand('shutdown now', 'allow', [
      rule({ id: 'allow', action: 'allow' }),
      rule({ id: 'block', action: 'block' }),
    ])
    expect(result?.matchedRule?.id).toBe('block')
  })

  it('uses the group default when no active rule matches', () => {
    expect(evaluatePolicyGroupCommand('ls -la', 'block', [rule({ enabled: false })])).toMatchObject({
      action: 'block',
      source: 'default',
    })
  })

  it('does not evaluate an empty command', () => {
    expect(evaluatePolicyGroupCommand('   ', 'allow', [])).toBeNull()
  })
})
