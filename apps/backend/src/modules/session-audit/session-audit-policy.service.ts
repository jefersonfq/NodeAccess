import { ConflictError } from '../../shared/errors.js'
import { env } from '../../config/env.js'
import type { SessionAuditPolicyPublic, UpdateSessionAuditPolicyDto } from '@nodeaccess/shared'
import type { SessionAuditPolicyRepository } from './session-audit-policy.repository.js'

export class SessionAuditPolicyService {
  constructor(private readonly repository: SessionAuditPolicyRepository) {}

  async shouldAuditSession(tenantId: number, userId: number, groupIds: number[]): Promise<boolean> {
    if (!env.FEATURE_SESSION_AUDIT) return false

    const state = await this.repository.getState(tenantId)
    if (!state.licensed) return false
    if (!state.enabled) return false

    switch (state.mode) {
      case 'ALL':
        return true
      case 'USERS':
        return state.userIds.includes(userId)
      case 'GROUPS':
        return groupIds.some((groupId) => state.groupIds.includes(groupId))
      case 'MIXED':
        return state.userIds.includes(userId) || groupIds.some((groupId) => state.groupIds.includes(groupId))
      case 'DISABLED':
      default:
        return false
    }
  }

  async getPolicy(tenantId: number): Promise<SessionAuditPolicyPublic> {
    return this.repository.getState(tenantId)
  }

  async updatePolicy(tenantId: number, dto: UpdateSessionAuditPolicyDto): Promise<SessionAuditPolicyPublic> {
    const state = await this.repository.getState(tenantId)
    if (!state.licensed) {
      throw new ConflictError('Auditoria de sessão não está licenciada para este tenant')
    }

    const sanitized = sanitizePolicyDto(dto)

    await this.repository.save({
      tenantId,
      enabled: sanitized.enabled,
      mode: sanitized.mode,
      userIds: uniqueSorted(sanitized.userIds),
      groupIds: uniqueSorted(sanitized.groupIds),
    })

    return this.repository.getState(tenantId)
  }
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function sanitizePolicyDto(dto: UpdateSessionAuditPolicyDto): UpdateSessionAuditPolicyDto {
  if (!dto.enabled || dto.mode === 'DISABLED' || dto.mode === 'ALL') {
    return {
      enabled: dto.enabled,
      mode: dto.enabled ? dto.mode : 'DISABLED',
      userIds: [],
      groupIds: [],
    }
  }

  if (dto.mode === 'USERS') {
    return { ...dto, groupIds: [] }
  }

  if (dto.mode === 'GROUPS') {
    return { ...dto, userIds: [] }
  }

  return dto
}
