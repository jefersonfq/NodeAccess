import { env } from '../../config/env.js'
import { NotFoundError } from '../../shared/errors.js'
import {
  DEFAULT_SFTP_POLICY_SETTINGS,
  normalizeSftpPolicySettings,
  type SettingsRepository,
  type SftpPolicySettings,
} from './settings.repository.js'

export interface SettingsResponse {
  tenant: {
    id:   number
    name: string
    slug: string
  }
  environment: {
    features: {
      sessionAudit: boolean
      sessionAuditAiSummary: boolean
      sessionAuditAiAutoSummary: boolean
      localAi: boolean
      nativeSshGateway: boolean
    }
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
    hostsDefaultView: 'home' | 'list'
  }
  jitAccess: {
    enabled: boolean
    expiryMinutes: number[]
    maxExpiryMinutes: number
    pinRequired: boolean
  }
  sharedSessions: {
    expiryMinutes: number[]
    maxExpiryMinutes: number
  }
  sftpPolicy: SftpPolicySettings
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
  hostsDefaultView: 'home' | 'list'
}

export interface UpdateJitAccessSettingsInput {
  enabled?: boolean
  expiryMinutes: number[]
  maxExpiryMinutes: number
  pinRequired?: boolean
}

export interface UpdateSharedSessionSettingsInput {
  expiryMinutes: number[]
  maxExpiryMinutes: number
}

export interface UpdateSftpPolicySettingsInput {
  blockOnModePreservationFailure: boolean
  blockOnOwnershipPreservationFailure: boolean
  blockOnTimestampPreservationFailure: boolean
  diffMaxBytes: number
  diffMaxLines: number
}

export interface UpdateLicenseEntitlementsInput {
  maxHosts: number | null
  multiConnect: boolean
  sessionAuditEnabled: boolean
  sessionAuditAiEnabled: boolean
  sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
  sessionAuditAiAutoSummaryEnabled: boolean
  featureEntitlements: Record<string, boolean>
  integrationEntitlements: Record<string, boolean>
}

const FEATURE_KEYS = ['agents', 'secrets', 'snippets', 'portForwarding', 'integrations', 'feedback', 'localAi', 'mcp', 'aiSshActions', 'sessionAuditAiAutoSummary'] as const
const INTEGRATION_PROVIDER_KEYS = ['jira', 'google', 'ldap', 'onepassword', 'oidc'] as const

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
      environment: {
        features: {
          sessionAudit: env.FEATURE_SESSION_AUDIT,
          sessionAuditAiSummary: env.FEATURE_SESSION_AUDIT_AI_SUMMARY,
          sessionAuditAiAutoSummary: env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY,
          localAi: env.FEATURE_LOCAL_AI,
          nativeSshGateway: env.FEATURE_NATIVE_SSH_GATEWAY,
        },
      },
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
        hostsDefaultView: license?.hostsDefaultView ?? 'home',
      },
      jitAccess: license?.jitAccess ?? {
        enabled: true,
        expiryMinutes: [5, 10, 30],
        maxExpiryMinutes: 30,
        pinRequired: false,
      },
      sharedSessions: license?.sharedSessions ?? {
        expiryMinutes: [5, 10, 30],
        maxExpiryMinutes: 30,
      },
      sftpPolicy: license?.sftpPolicy ?? DEFAULT_SFTP_POLICY_SETTINGS,
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
    await Promise.all([
      this.settingsRepo.updateTotpIssuer(tenantId, input.totpIssuer.trim()),
      this.settingsRepo.updateHostsDefaultView(tenantId, input.hostsDefaultView),
    ])
    return this.get(tenantId)
  }

  async updateJitAccessSettings(tenantId: number, input: UpdateJitAccessSettingsInput): Promise<SettingsResponse> {
    const maxExpiryMinutes = Number.isInteger(input.maxExpiryMinutes)
      ? Math.min(1440, Math.max(1, input.maxExpiryMinutes))
      : 30
    const expiryMinutes = Array.from(new Set(input.expiryMinutes
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= maxExpiryMinutes)))
      .sort((a, b) => a - b)

    await this.settingsRepo.updateJitAccessSettings(tenantId, {
      enabled: input.enabled !== false,
      maxExpiryMinutes,
      expiryMinutes: expiryMinutes.length > 0 ? expiryMinutes : [Math.min(10, maxExpiryMinutes)],
      pinRequired: input.pinRequired === true,
    })
    return this.get(tenantId)
  }

  async updateSharedSessionSettings(tenantId: number, input: UpdateSharedSessionSettingsInput): Promise<SettingsResponse> {
    const maxExpiryMinutes = Number.isInteger(input.maxExpiryMinutes)
      ? Math.min(1440, Math.max(1, input.maxExpiryMinutes))
      : 30
    const expiryMinutes = Array.from(new Set(input.expiryMinutes
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= maxExpiryMinutes)))
      .sort((a, b) => a - b)

    await this.settingsRepo.updateSharedSessionSettings(tenantId, {
      maxExpiryMinutes,
      expiryMinutes: expiryMinutes.length > 0 ? expiryMinutes : [Math.min(10, maxExpiryMinutes)],
    })
    return this.get(tenantId)
  }

  async updateSftpPolicySettings(tenantId: number, input: UpdateSftpPolicySettingsInput): Promise<SettingsResponse> {
    const policy = normalizeSftpPolicySettings(
      input.blockOnModePreservationFailure,
      input.blockOnOwnershipPreservationFailure,
      input.blockOnTimestampPreservationFailure,
      input.diffMaxBytes,
      input.diffMaxLines,
    )
    await this.settingsRepo.updateSftpPolicySettings(tenantId, policy)
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

    const currentLicense = await this.settingsRepo.findLicense(tenantId)
    const featureEntitlements = Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, input.featureEntitlements[key] === true]),
    )
    // HA e um entitlement comercial administrado fora da configuracao comum
    // do tenant. Um admin comum nao pode habilita-lo nem remove-lo por engano.
    featureEntitlements.ha = currentLicense?.featureEntitlements.ha === true

    const integrationEntitlements = Object.fromEntries(
      INTEGRATION_PROVIDER_KEYS.map((key) => [key, input.integrationEntitlements[key] === true]),
    )

    await this.settingsRepo.updateLicenseEntitlements(tenantId, {
      maxHosts,
      multiConnect: input.multiConnect === true,
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
