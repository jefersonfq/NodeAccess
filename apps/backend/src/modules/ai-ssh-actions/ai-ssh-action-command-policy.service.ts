import { AppError } from '../../shared/errors.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { AiSshActionCommandPolicyRepository } from './ai-ssh-action-command-policy.repository.js'
import { classifyActionCommand } from './ai-ssh-action-command-policy.js'

export interface AiSshActionCommandPolicyDto {
  safePatterns: string[]
  approvalPatterns: string[]
  blockedPatterns: string[]
}

function normalizePatterns(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const normalized = Array.from(new Set(values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)))

  for (const pattern of normalized) {
    try {
      new RegExp(pattern, 'i')
    } catch {
      throw new AppError(`Regex invalida na policy de comandos SSH por IA: ${pattern}`, 400, 'AI_SSH_ACTION_POLICY_INVALID_REGEX')
    }
  }

  return normalized
}

export class AiSshActionCommandPolicyService {
  constructor(
    private readonly repository: AiSshActionCommandPolicyRepository,
    private readonly entitlements: LicenseEntitlementService,
    private readonly logRepository: LogRepository,
  ) {}

  async get(input: { tenantId: number }): Promise<AiSshActionCommandPolicyDto> {
    await this.entitlements.requireFeature(
      input.tenantId,
      'aiSshActions',
      'Acoes SSH por IA ainda nao estao licenciadas para este tenant',
    )

    const record = await this.repository.findByTenant(input.tenantId)
    return {
      safePatterns: record?.safePatterns ?? [],
      approvalPatterns: record?.approvalPatterns ?? [],
      blockedPatterns: record?.blockedPatterns ?? [],
    }
  }

  async update(input: {
    tenantId: number
    adminId: number
    safePatterns?: string[]
    approvalPatterns?: string[]
    blockedPatterns?: string[]
  }): Promise<AiSshActionCommandPolicyDto> {
    await this.entitlements.requireFeature(
      input.tenantId,
      'aiSshActions',
      'Acoes SSH por IA ainda nao estao licenciadas para este tenant',
    )

    const record = await this.repository.upsert({
      tenantId: input.tenantId,
      safePatterns: normalizePatterns(input.safePatterns ?? []),
      approvalPatterns: normalizePatterns(input.approvalPatterns ?? []),
      blockedPatterns: normalizePatterns(input.blockedPatterns ?? []),
    })

    await this.logRepository.logAdminEvent({
      adminId: input.adminId,
      action: 'AI_SSH_ACTION_COMMAND_POLICY_UPDATED',
      targetType: 'AiSshActionCommandPolicy',
      targetId: input.tenantId,
      details: JSON.stringify({
        safePatterns: record.safePatterns.length,
        approvalPatterns: record.approvalPatterns.length,
        blockedPatterns: record.blockedPatterns.length,
      }),
    }).catch(() => {})

    return {
      safePatterns: record.safePatterns,
      approvalPatterns: record.approvalPatterns,
      blockedPatterns: record.blockedPatterns,
    }
  }

  async evaluate(input: { tenantId: number; command: string }): Promise<{ command: string; risk: 'safe' | 'approval_required' | 'blocked' }> {
    const [result] = await this.evaluateMany({ tenantId: input.tenantId, commands: [input.command] })
    return result!
  }

  async evaluateMany(input: { tenantId: number; commands: string[] }): Promise<Array<{ command: string; risk: 'safe' | 'approval_required' | 'blocked' }>> {
    await this.entitlements.requireFeature(
      input.tenantId,
      'aiSshActions',
      'Acoes SSH por IA ainda nao estao licenciadas para este tenant',
    )

    const commands = input.commands.map((command) => command.trim())
    if (!commands.length || commands.some((command) => !command)) {
      throw new AppError('Comando obrigatorio para avaliar policy', 400, 'AI_SSH_ACTION_POLICY_COMMAND_REQUIRED')
    }

    const record = await this.repository.findByTenant(input.tenantId)
    const patterns = {
      safePatterns: record?.safePatterns ?? [],
      approvalPatterns: record?.approvalPatterns ?? [],
      blockedPatterns: record?.blockedPatterns ?? [],
    }
    return commands.map((command) => ({ command, risk: classifyActionCommand(command, patterns) }))
  }
}
