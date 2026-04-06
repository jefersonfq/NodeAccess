import { env } from '../../config/env.js'
import { NotFoundError } from '../../shared/errors.js'
import type { SettingsRepository } from './settings.repository.js'

export interface SettingsResponse {
  tenant: {
    id:   number
    name: string
    slug: string
  }
  license: {
    maxUsers:     number
    activeUsers:  number
    hasKey:       boolean
    multiConnect: boolean
    sessionAuditEnabled: boolean
    sessionAuditAiEnabled: boolean
  }
  sessionLimits: {
    activeSessions: number
    maxPerUser: number | null
    maxPerTenant: number | null
  }
  passwordPolicy: {
    minLength:   number
    regex:       string
    description: string
  }
}

export class SettingsService {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  async get(tenantId: number): Promise<SettingsResponse> {
    const tenant = await this.settingsRepo.findTenantById(tenantId)
    if (!tenant) throw new NotFoundError('Tenant')

    const license     = await this.settingsRepo.findLicense(tenantId)
    const activeUsers = await this.settingsRepo.countActiveUsers(tenantId)
    const activeSessions = await this.settingsRepo.countActiveSessions(tenantId)
    const multiConnect =
      env.NODE_ENV === 'development'
        ? (env.LICENSE_MULTI_CONNECT || license?.multiConnect || false)
        : (license?.multiConnect ?? env.LICENSE_MULTI_CONNECT)

    return {
      tenant,
      license: {
        maxUsers:     license?.maxUsers ?? env.LICENSE_MAX_USERS,
        activeUsers,
        hasKey:       !!env.LICENSE_KEY,
        // Em desenvolvimento, .env pode forcar multi-connect para testes.
        // Fora disso, a referencia principal continua sendo a licenca no banco.
        multiConnect,
        sessionAuditEnabled: license?.sessionAuditEnabled ?? false,
        sessionAuditAiEnabled: license?.sessionAuditAiEnabled ?? false,
      },
      sessionLimits: {
        activeSessions,
        maxPerUser: license?.maxActiveSessionsPerUser ?? env.SESSION_MAX_ACTIVE_PER_USER ?? null,
        maxPerTenant: license?.maxActiveSessionsTenant ?? env.SESSION_MAX_ACTIVE_PER_TENANT ?? null,
      },
      passwordPolicy: {
        minLength:   env.PASSWORD_MIN_LENGTH,
        regex:       env.PASSWORD_POLICY_REGEX,
        description: env.PASSWORD_POLICY_DESCRIPTION,
      },
    }
  }
}
