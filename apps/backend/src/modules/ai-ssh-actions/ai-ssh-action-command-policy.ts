import { env } from '../../config/env.js'
import type { CreateAiSshActionRunDto } from '@nodeaccess/shared'

export type ActionCommandRisk = 'safe' | 'approval_required' | 'blocked'

export interface ActionCommandPolicyPatterns {
  safePatterns?: string[]
  approvalPatterns?: string[]
  blockedPatterns?: string[]
}

const defaultBlockedPatterns = [
  /\brm\s+-rf\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\buseradd\b/i,
  /\busermod\b/i,
  /\buserdel\b/i,
  /\bpasswd\b/i,
  /\bchpasswd\b/i,
  /\bcurl\b.*\|\s*(sh|bash)\b/i,
  /\bwget\b.*\|\s*(sh|bash)\b/i,
]

const defaultApprovalRequiredPatterns = [
  /\bmount\b/i,
  /\bumount\b/i,
  /\biptables\b/i,
  /\bufw\b/i,
  /\bfirewall-cmd\b/i,
  /\bsystemctl\s+(start|stop|restart|reload|enable|disable)\b/i,
  /\bservice\s+\S+\s+(start|stop|restart|reload)\b/i,
  /\bapt(-get)?\s+(install|remove|purge|upgrade)\b/i,
  /\byum\s+(install|remove|update)\b/i,
  /\bdnf\s+(install|remove|upgrade)\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  />\s*\/etc\//i,
]

function compilePatterns(values: string[]): RegExp[] {
  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((pattern) => {
      try {
        return [new RegExp(pattern, 'i')]
      } catch {
        return []
      }
    })
}

function parseEnvPatternOverrides(value: string | undefined): string[] {
  return value?.split(';;') ?? []
}

export function classifyActionCommand(command: string, policy: ActionCommandPolicyPatterns = {}): ActionCommandRisk {
  const customBlocked = compilePatterns([
    ...parseEnvPatternOverrides(env.AI_SSH_ACTION_BLOCKED_COMMAND_PATTERNS),
    ...(policy.blockedPatterns ?? []),
  ])
  const customApprovalRequired = compilePatterns([
    ...parseEnvPatternOverrides(env.AI_SSH_ACTION_APPROVAL_COMMAND_PATTERNS),
    ...(policy.approvalPatterns ?? []),
  ])
  const customSafe = compilePatterns([
    ...parseEnvPatternOverrides(env.AI_SSH_ACTION_SAFE_COMMAND_PATTERNS),
    ...(policy.safePatterns ?? []),
  ])

  if ([...defaultBlockedPatterns, ...customBlocked].some((pattern) => pattern.test(command))) {
    return 'blocked'
  }

  if (customSafe.some((pattern) => pattern.test(command))) {
    return 'safe'
  }

  if ([...defaultApprovalRequiredPatterns, ...customApprovalRequired].some((pattern) => pattern.test(command))) {
    return 'approval_required'
  }

  return 'safe'
}

export function summarizeCommandRisk(steps: CreateAiSshActionRunDto['steps'], policy: ActionCommandPolicyPatterns = {}): {
  maxRisk: ActionCommandRisk
  approvalRequiredSteps: string[]
  blockedSteps: string[]
} {
  const approvalRequiredSteps: string[] = []
  const blockedSteps: string[] = []

  for (const step of steps) {
    const risk = classifyActionCommand(step.command, policy)
    if (risk === 'approval_required') approvalRequiredSteps.push(step.id)
    if (risk === 'blocked') blockedSteps.push(step.id)
  }

  return {
    maxRisk: blockedSteps.length ? 'blocked' : approvalRequiredSteps.length ? 'approval_required' : 'safe',
    approvalRequiredSteps,
    blockedSteps,
  }
}
