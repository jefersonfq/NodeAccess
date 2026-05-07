import { ConflictError } from '../../shared/errors.js'
import { env } from '../../config/env.js'
import { metrics } from '../../shared/metrics.js'
import type { SessionAuditPolicyPublic, UpdateSessionAuditPolicyDto } from '@nodeaccess/shared'
import type { SessionAuditPolicyRepository } from './session-audit-policy.repository.js'
import type { Redis } from 'ioredis'

export class SessionAuditPolicyService {
  constructor(
    private readonly repository: SessionAuditPolicyRepository,
    private readonly redis: Redis,
  ) {}

  async shouldAuditSession(tenantId: number, userId: number, groupIds: number[]): Promise<boolean> {
    if (!env.FEATURE_SESSION_AUDIT) return false

    const state = await this.getState(tenantId)
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
    return this.withCacheInfo(await this.getState(tenantId))
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

    await this.clearPolicyCache(tenantId)
    return this.withCacheInfo(await this.getState(tenantId))
  }

  async clearPolicyCache(tenantId: number): Promise<void> {
    if (!this.cacheEnabled()) return

    try {
      await this.redis.del(this.cacheKey(tenantId))
    } catch {
      metrics.inc(
        'nodeaccess_session_audit_policy_cache_errors_total',
        'Total de erros no cache da politica de auditoria de sessao',
        { operation: 'clear' },
      )
    }
  }

  private async getState(tenantId: number): Promise<Omit<SessionAuditPolicyPublic, 'cache'>> {
    if (!this.cacheEnabled()) {
      return this.repository.getState(tenantId)
    }

    const key = this.cacheKey(tenantId)

    try {
      const cached = await this.redis.get(key)
      if (cached) {
        metrics.inc(
          'nodeaccess_session_audit_policy_cache_hits_total',
          'Total de leituras atendidas pelo cache da politica de auditoria de sessao',
        )
        return JSON.parse(cached) as Omit<SessionAuditPolicyPublic, 'cache'>
      }
    } catch {
      metrics.inc(
        'nodeaccess_session_audit_policy_cache_errors_total',
        'Total de erros no cache da politica de auditoria de sessao',
        { operation: 'read' },
      )
    }

    metrics.inc(
      'nodeaccess_session_audit_policy_cache_misses_total',
      'Total de leituras nao atendidas pelo cache da politica de auditoria de sessao',
    )

    const state = await this.repository.getState(tenantId)
    try {
      await this.redis.set(key, JSON.stringify(state), 'EX', env.SESSION_AUDIT_POLICY_CACHE_TTL_SECONDS)
    } catch {
      metrics.inc(
        'nodeaccess_session_audit_policy_cache_errors_total',
        'Total de erros no cache da politica de auditoria de sessao',
        { operation: 'write' },
      )
    }

    return state
  }

  private withCacheInfo(state: Omit<SessionAuditPolicyPublic, 'cache'>): SessionAuditPolicyPublic {
    return {
      ...state,
      cache: {
        enabled: this.cacheEnabled(),
        backend: 'redis',
        ttlSeconds: env.SESSION_AUDIT_POLICY_CACHE_TTL_SECONDS,
        manualClearAvailable: false,
      },
    }
  }

  private cacheEnabled(): boolean {
    return env.SESSION_AUDIT_POLICY_CACHE_TTL_SECONDS > 0
  }

  private cacheKey(tenantId: number): string {
    return `nodeaccess:session-audit-policy:${tenantId}:v1`
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
