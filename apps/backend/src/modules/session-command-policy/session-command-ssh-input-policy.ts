import type { SshInputPolicy, SshInputPolicyContext, SshInputPolicyDecision } from '../ssh/ssh-input-policy.js'
import type { SessionCommandPolicyRepository } from './session-command-policy.repository.js'
import {
  SessionCommandPolicyEvaluator,
  type SessionCommandRule,
} from './session-command-policy.evaluator.js'

export interface SessionCommandRuleProvider {
  getRules(context: SshInputPolicyContext): Promise<SessionCommandRule[]>
  getDefaultAction?(context: SshInputPolicyContext): Promise<'allow' | 'block'>
}

export class EmptySessionCommandRuleProvider implements SessionCommandRuleProvider {
  async getRules(): Promise<SessionCommandRule[]> {
    return []
  }
}

export class RepositorySessionCommandRuleProvider implements SessionCommandRuleProvider {
  constructor(private readonly repository: SessionCommandPolicyRepository) {}

  async getRules(context: SshInputPolicyContext): Promise<SessionCommandRule[]> {
    return this.repository.findEffectiveRules({
      tenantId: context.tenantId,
      userId: context.userId,
      hostId: context.hostId,
    })
  }

  async getDefaultAction(context: SshInputPolicyContext): Promise<'allow' | 'block'> {
    return this.repository.findEffectiveDefaultAction({
      tenantId: context.tenantId,
      userId: context.userId,
      hostId: context.hostId,
    })
  }
}

interface BufferedSession {
  line: string
}

export class SessionCommandSshInputPolicy implements SshInputPolicy {
  private readonly sessions = new Map<string, BufferedSession>()

  constructor(
    private readonly ruleProvider: SessionCommandRuleProvider,
    private readonly evaluator = new SessionCommandPolicyEvaluator(),
  ) {}

  async evaluate(data: Buffer, context: SshInputPolicyContext): Promise<SshInputPolicyDecision> {
    const key = this.sessionKey(context)
    const state = this.sessions.get(key) ?? { line: '' }
    const output: number[] = []
    const [rules, defaultAction] = await Promise.all([
      this.ruleProvider.getRules(context),
      this.ruleProvider.getDefaultAction?.(context) ?? Promise.resolve<'allow' | 'block'>('allow'),
    ])

    for (const byte of data) {
      if (byte === 3) {
        state.line = ''
        output.push(byte)
        continue
      }

      if (byte === 8 || byte === 127) {
        state.line = state.line.slice(0, -1)
        output.push(byte)
        continue
      }

      if (byte === 13 || byte === 10) {
        const command = state.line.trim()
        state.line = ''

        const decision = this.evaluator.evaluate(command, rules, defaultAction)
        if (decision.action === 'block') {
          this.sessions.set(key, state)
          return {
            allow: false,
            data: Buffer.from([21]),
            message: decision.message ?? 'Comando bloqueado por politica',
          }
        }

        output.push(byte)
        continue
      }

      state.line += String.fromCharCode(byte)
      output.push(byte)
    }

    this.sessions.set(key, state)
    return {
      allow: true,
      data: Buffer.from(output),
    }
  }

  private sessionKey(context: SshInputPolicyContext): string {
    return context.sessionId !== undefined
      ? `${context.source}:${context.sessionId}`
      : `${context.source}:${context.tenantId}:${context.userId}:${context.hostId}`
  }
}
