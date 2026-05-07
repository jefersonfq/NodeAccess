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
    maxHosts:     number | null
    activeUsers:  number
    registeredHosts: number
    hasKey:       boolean
    multiConnect: boolean
    sessionAuditEnabled: boolean
    sessionAuditAiEnabled: boolean
    sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
    sessionAuditAiAutoSummaryEnabled: boolean
    featureEntitlements: Record<string, boolean>
    integrationEntitlements: Record<string, boolean>
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
  tenantSettings: {
    totpIssuer: string
  }
}

export interface UpdateSessionLimitsInput {
  maxPerUser:   number | null
  maxPerTenant: number | null
}

export interface UpdatePasswordPolicyInput {
  minLength:   number
  regex:       string
  description: string
}

export interface UpdateTenantSettingsInput {
  totpIssuer: string
}

export interface UpdateLicenseEntitlementsInput {
  maxHosts: number | null
  sessionAuditEnabled: boolean
  sessionAuditAiEnabled: boolean
  sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
  sessionAuditAiAutoSummaryEnabled: boolean
  featureEntitlements: Record<string, boolean>
  integrationEntitlements: Record<string, boolean>
}

const FEATURE_KEYS = ['agents', 'secrets', 'snippets', 'portForwarding', 'integrations', 'feedback', 'localAi', 'mcp', 'aiSshActions', 'sessionAuditAiAutoSummary'] as const
const INTEGRATION_PROVIDER_KEYS = ['jira', 'google', 'onepassword'] as const

export class SettingsService {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  async get(tenantId: number): Promise<SettingsResponse> {
    const tenant = await this.settingsRepo.findTenantById(tenantId)
    if (!tenant) throw new NotFoundError('Tenant')

    const license     = await this.settingsRepo.findLicense(tenantId)
    const activeUsers = await this.settingsRepo.countActiveUsers(tenantId)
    const registeredHosts = await this.settingsRepo.countHosts(tenantId)
    const activeSessions = await this.settingsRepo.countActiveSessions(tenantId)
    const multiConnect =
      env.NODE_ENV === 'development'
        ? (env.LICENSE_MULTI_CONNECT || license?.multiConnect || false)
        : (license?.multiConnect ?? env.LICENSE_MULTI_CONNECT)

    return {
      tenant,
      license: {
        maxUsers:     license?.maxUsers ?? env.LICENSE_MAX_USERS,
        maxHosts:     license?.maxHosts ?? null,
        activeUsers,
        registeredHosts,
        hasKey:       !!env.LICENSE_KEY,
        // Em desenvolvimento, .env pode forcar multi-connect para testes.
        // Fora disso, a referencia principal continua sendo a licenca no banco.
        multiConnect,
        sessionAuditEnabled: license?.sessionAuditEnabled ?? false,
        sessionAuditAiEnabled: license?.sessionAuditAiEnabled ?? false,
        sessionAuditAiProvider: license?.sessionAuditAiProvider ?? 'automatic',
        sessionAuditAiAutoSummaryEnabled: license?.featureEntitlements.sessionAuditAiAutoSummary === true,
        featureEntitlements: license?.featureEntitlements ?? {},
        integrationEntitlements: license?.integrationEntitlements ?? {},
      },
      sessionLimits: {
        activeSessions,
        maxPerUser: license?.maxActiveSessionsPerUser ?? env.SESSION_MAX_ACTIVE_PER_USER ?? null,
        maxPerTenant: license?.maxActiveSessionsTenant ?? env.SESSION_MAX_ACTIVE_PER_TENANT ?? null,
      },
      passwordPolicy: {
        minLength:   license?.passwordPolicyMinLength   ?? env.PASSWORD_MIN_LENGTH,
        regex:       license?.passwordPolicyRegex       ?? env.PASSWORD_POLICY_REGEX,
        description: license?.passwordPolicyDescription ?? env.PASSWORD_POLICY_DESCRIPTION,
      },
      tenantSettings: {
        totpIssuer: license?.totpIssuer ?? env.TOTP_ISSUER,
      },
    }
  }

  async updateSessionLimits(tenantId: number, input: UpdateSessionLimitsInput): Promise<SettingsResponse> {
    const maxPerUser   = input.maxPerUser   !== null ? Math.max(1, Math.floor(input.maxPerUser))   : null
    const maxPerTenant = input.maxPerTenant !== null ? Math.max(1, Math.floor(input.maxPerTenant)) : null
    await this.settingsRepo.updateSessionLimits(tenantId, { maxPerUser, maxPerTenant })
    return this.get(tenantId)
  }

  async updatePasswordPolicy(tenantId: number, input: UpdatePasswordPolicyInput): Promise<SettingsResponse> {
    const minLength = Math.max(1, Math.floor(input.minLength))
    new RegExp(input.regex) // throws if invalid regex
    await this.settingsRepo.updatePasswordPolicy(tenantId, {
      minLength,
      regex:       input.regex.trim(),
      description: input.description.trim(),
    })
    return this.get(tenantId)
  }

  async updateTenantSettings(tenantId: number, input: UpdateTenantSettingsInput): Promise<SettingsResponse> {
    await this.settingsRepo.updateTotpIssuer(tenantId, input.totpIssuer.trim())
    return this.get(tenantId)
  }

  async updateLicenseEntitlements(
    tenantId: number,
    input: UpdateLicenseEntitlementsInput,
  ): Promise<SettingsResponse> {
    const maxHosts = input.maxHosts === null
      ? null
      : Number.isInteger(input.maxHosts) && input.maxHosts > 0
        ? input.maxHosts
        : null

    const featureEntitlements = Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, input.featureEntitlements[key] === true]),
    )

    const integrationEntitlements = Object.fromEntries(
      INTEGRATION_PROVIDER_KEYS.map((key) => [key, input.integrationEntitlements[key] === true]),
    )

    await this.settingsRepo.updateLicenseEntitlements(tenantId, {
      maxHosts,
      sessionAuditEnabled: input.sessionAuditEnabled === true,
      sessionAuditAiEnabled: input.sessionAuditAiEnabled === true,
      sessionAuditAiProvider: normalizeSessionAuditAiProvider(input.sessionAuditAiProvider),
      featureEntitlements,
      integrationEntitlements,
    })

    return this.get(tenantId)
  }
}

function normalizeSessionAuditAiProvider(value: string): 'automatic' | 'openai' | 'local_ai' {
  if (value === 'openai' || value === 'local_ai') return value
  return 'automatic'
}
