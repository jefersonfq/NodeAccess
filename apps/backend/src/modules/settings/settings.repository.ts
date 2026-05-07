import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'
import { env } from '../../config/env.js'

interface LicenseRow {
  maxUsers: number
  maxHosts: number | null
  multiConnect: boolean | number | bigint
  sessionAuditEnabled: boolean | number | bigint
  sessionAuditAiEnabled: boolean | number | bigint
  sessionAuditAiProvider: string | null
  featureEntitlementsJson: string | null
  integrationEntitlementsJson: string | null
  maxActiveSessionsPerUser: number | null
  maxActiveSessionsTenant: number | null
  passwordPolicyMinLength: number | null
  passwordPolicyRegex: string | null
  passwordPolicyDescription: string | null
  totpIssuer: string | null
  hostsDefaultView: string | null
  jitAccessExpiryMinutesJson: unknown
  jitAccessMaxExpiryMinutes: number | null
  jitAccessEnabled: boolean | number | bigint
  jitAccessPinRequired: boolean | number | bigint
  sharedSessionExpiryMinutesJson: unknown
  sharedSessionMaxExpiryMinutes: number | null
}

function parseBool(value: boolean | number | bigint | null | undefined): boolean {
  return value === true || value === 1 || value === BigInt(1)
}

function parseJsonRecord(value: unknown): Record<string, boolean> {
  if (!value) return {}
  try {
    const parsed = typeof value === 'string'
      ? JSON.parse(value) as Record<string, unknown>
      : value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([key, raw]) => [key, raw === true]),
    )
  } catch {
    return {}
  }
}

type LicenseSnapshot = {
  maxUsers: number
  maxHosts: number | null
  multiConnect: boolean
  sessionAuditEnabled: boolean
  sessionAuditAiEnabled: boolean
  sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
  featureEntitlements: Record<string, boolean>
  integrationEntitlements: Record<string, boolean>
  maxActiveSessionsPerUser: number | null
  maxActiveSessionsTenant: number | null
  passwordPolicyMinLength: number | null
  passwordPolicyRegex: string | null
  passwordPolicyDescription: string | null
  totpIssuer: string | null
  hostsDefaultView: 'home' | 'list' | null
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
}

const DEFAULT_JIT_ACCESS_SETTINGS = {
  enabled: true,
  expiryMinutes: [5, 10, 30],
  maxExpiryMinutes: 30,
  pinRequired: false,
}

const DEFAULT_SHARED_SESSION_SETTINGS = {
  expiryMinutes: [5, 10, 30],
  maxExpiryMinutes: 30,
}

export class SettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findTenantById(tenantId: number) {
    return this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    })
  }

  async findLicense(tenantId: number): Promise<LicenseSnapshot | null> {
    try {
      const rows = await this.db.$queryRaw<Array<LicenseRow>>`
        SELECT
          max_users AS maxUsers,
          max_hosts AS maxHosts,
          multi_connect AS multiConnect,
          session_audit_enabled AS sessionAuditEnabled,
          session_audit_ai_enabled AS sessionAuditAiEnabled,
          session_audit_ai_provider AS sessionAuditAiProvider,
          feature_entitlements_json AS featureEntitlementsJson,
          integration_entitlements_json AS integrationEntitlementsJson,
          max_active_sessions_per_user AS maxActiveSessionsPerUser,
          max_active_sessions_tenant AS maxActiveSessionsTenant,
          password_policy_min_length AS passwordPolicyMinLength,
          password_policy_regex AS passwordPolicyRegex,
          password_policy_description AS passwordPolicyDescription,
          totp_issuer AS totpIssuer,
          hosts_default_view AS hostsDefaultView,
          jit_access_expiry_minutes_json AS jitAccessExpiryMinutesJson,
          jit_access_max_expiry_minutes AS jitAccessMaxExpiryMinutes,
          jit_access_enabled AS jitAccessEnabled,
          jit_access_pin_required AS jitAccessPinRequired,
          shared_session_expiry_minutes_json AS sharedSessionExpiryMinutesJson,
          shared_session_max_expiry_minutes AS sharedSessionMaxExpiryMinutes
        FROM licenses
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `

      const license = rows[0]
      if (!license) return null

      return {
        maxUsers: license.maxUsers,
        maxHosts: license.maxHosts,
        multiConnect: parseBool(license.multiConnect),
        sessionAuditEnabled: parseBool(license.sessionAuditEnabled),
        sessionAuditAiEnabled: parseBool(license.sessionAuditAiEnabled),
        sessionAuditAiProvider: normalizeSessionAuditAiProvider(license.sessionAuditAiProvider) as 'automatic' | 'openai' | 'local_ai',
        featureEntitlements: parseJsonRecord(license.featureEntitlementsJson),
        integrationEntitlements: parseJsonRecord(license.integrationEntitlementsJson),
        maxActiveSessionsPerUser: license.maxActiveSessionsPerUser,
        maxActiveSessionsTenant: license.maxActiveSessionsTenant,
        passwordPolicyMinLength: license.passwordPolicyMinLength ?? null,
        passwordPolicyRegex: license.passwordPolicyRegex ?? null,
        passwordPolicyDescription: license.passwordPolicyDescription ?? null,
        totpIssuer: license.totpIssuer ?? null,
        hostsDefaultView: (license.hostsDefaultView === 'list' ? 'list' : null),
        jitAccess: normalizeJitAccessSettings(
          license.jitAccessExpiryMinutesJson,
          license.jitAccessMaxExpiryMinutes,
          license.jitAccessEnabled,
          license.jitAccessPinRequired,
        ),
        sharedSessions: normalizeSharedSessionSettings(
          license.sharedSessionExpiryMinutesJson,
          license.sharedSessionMaxExpiryMinutes,
        ),
      }
    } catch (err) {
      logger.warn(
        { err, tenantId },
        'Ignorando campos novos de licença em settings até a migration do banco ser aplicada',
      )

      const license = await this.db.license.findUnique({
        where: { tenantId },
        select: {
          maxUsers: true,
          multiConnect: true,
        },
      })

      if (!license) return null

      return {
        ...license,
        maxHosts: null,
        sessionAuditEnabled: false,
        sessionAuditAiEnabled: false,
        sessionAuditAiProvider: 'automatic' as const,
        featureEntitlements: {},
        integrationEntitlements: {},
        maxActiveSessionsPerUser: null,
        maxActiveSessionsTenant: null,
        passwordPolicyMinLength: null,
        passwordPolicyRegex: null,
        passwordPolicyDescription: null,
        totpIssuer: null,
        hostsDefaultView: null,
        jitAccess: DEFAULT_JIT_ACCESS_SETTINGS,
        sharedSessions: DEFAULT_SHARED_SESSION_SETTINGS,
      }
    }
  }

  async findJitAccessSettings(tenantId: number): Promise<{ enabled: boolean; expiryMinutes: number[]; maxExpiryMinutes: number; pinRequired: boolean }> {
    const license = await this.findLicense(tenantId)
    return license?.jitAccess ?? DEFAULT_JIT_ACCESS_SETTINGS
  }

  async findSharedSessionSettings(tenantId: number): Promise<{ expiryMinutes: number[]; maxExpiryMinutes: number }> {
    const license = await this.findLicense(tenantId)
    return license?.sharedSessions ?? DEFAULT_SHARED_SESSION_SETTINGS
  }

  async countActiveUsers(tenantId: number): Promise<number> {
    return this.db.user.count({ where: { tenantId, active: true, licenseConsumed: true } })
  }

  async countActiveSessions(tenantId: number): Promise<number> {
    return this.db.session.count({ where: { active: true, user: { tenantId } } })
  }

  async countHosts(tenantId: number): Promise<number> {
    return this.db.host.count({ where: { tenantId, deletedAt: null } })
  }

  async updateLicenseEntitlements(
    tenantId: number,
    input: {
      maxHosts: number | null
      multiConnect: boolean
      sessionAuditEnabled: boolean
      sessionAuditAiEnabled: boolean
      sessionAuditAiProvider: 'automatic' | 'openai' | 'local_ai'
      featureEntitlements: Record<string, boolean>
      integrationEntitlements: Record<string, boolean>
    },
  ) {
    const currentRows = await this.db.$queryRaw<Array<{
      maxUsers: number
      multiConnect: boolean | number | bigint
      maxActiveSessionsPerUser: number | null
      maxActiveSessionsTenant: number | null
      expiresAt: Date | null
      keyHash: string | null
      active: boolean | number | bigint
    }>>(Prisma.sql`
      SELECT
        max_users AS maxUsers,
        multi_connect AS multiConnect,
        max_active_sessions_per_user AS maxActiveSessionsPerUser,
        max_active_sessions_tenant AS maxActiveSessionsTenant,
        expires_at AS expiresAt,
        key_hash AS keyHash,
        active AS active
      FROM licenses
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `)

    const current = currentRows[0]

    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (
        tenant_id,
        max_users,
        max_hosts,
        multi_connect,
        session_audit_enabled,
        session_audit_ai_enabled,
        session_audit_ai_provider,
        feature_entitlements_json,
        integration_entitlements_json,
        max_active_sessions_per_user,
        max_active_sessions_tenant,
        expires_at,
        key_hash,
        active,
        issued_at
      ) VALUES (
        ${tenantId},
        ${current?.maxUsers ?? env.LICENSE_MAX_USERS},
        ${input.maxHosts},
        ${input.multiConnect},
        ${input.sessionAuditEnabled},
        ${input.sessionAuditAiEnabled},
        ${input.sessionAuditAiProvider},
        ${JSON.stringify(input.featureEntitlements)},
        ${JSON.stringify(input.integrationEntitlements)},
        ${current?.maxActiveSessionsPerUser ?? null},
        ${current?.maxActiveSessionsTenant ?? null},
        ${current?.expiresAt ?? null},
        ${current?.keyHash ?? null},
        ${current ? parseBool(current.active) : true},
        NOW()
      )
      ON DUPLICATE KEY UPDATE
        max_hosts = VALUES(max_hosts),
        multi_connect = VALUES(multi_connect),
        session_audit_enabled = VALUES(session_audit_enabled),
        session_audit_ai_enabled = VALUES(session_audit_ai_enabled),
        session_audit_ai_provider = VALUES(session_audit_ai_provider),
        feature_entitlements_json = VALUES(feature_entitlements_json),
        integration_entitlements_json = VALUES(integration_entitlements_json)
    `)
  }

  async updateSessionLimits(tenantId: number, input: { maxPerUser: number | null; maxPerTenant: number | null }) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (tenant_id, max_users, max_active_sessions_per_user, max_active_sessions_tenant, issued_at)
      VALUES (${tenantId}, ${env.LICENSE_MAX_USERS}, ${input.maxPerUser}, ${input.maxPerTenant}, NOW())
      ON DUPLICATE KEY UPDATE
        max_active_sessions_per_user = VALUES(max_active_sessions_per_user),
        max_active_sessions_tenant   = VALUES(max_active_sessions_tenant)
    `)
  }

  async updatePasswordPolicy(tenantId: number, input: { minLength: number; regex: string; description: string }) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (tenant_id, max_users, password_policy_min_length, password_policy_regex, password_policy_description, issued_at)
      VALUES (${tenantId}, ${env.LICENSE_MAX_USERS}, ${input.minLength}, ${input.regex}, ${input.description}, NOW())
      ON DUPLICATE KEY UPDATE
        password_policy_min_length   = VALUES(password_policy_min_length),
        password_policy_regex        = VALUES(password_policy_regex),
        password_policy_description  = VALUES(password_policy_description)
    `)
  }

  async updateTotpIssuer(tenantId: number, totpIssuer: string) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (tenant_id, max_users, totp_issuer, issued_at)
      VALUES (${tenantId}, ${env.LICENSE_MAX_USERS}, ${totpIssuer}, NOW())
      ON DUPLICATE KEY UPDATE
        totp_issuer = VALUES(totp_issuer)
    `)
  }

  async updateHostsDefaultView(tenantId: number, hostsDefaultView: 'home' | 'list') {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (tenant_id, max_users, hosts_default_view, issued_at)
      VALUES (${tenantId}, ${env.LICENSE_MAX_USERS}, ${hostsDefaultView}, NOW())
      ON DUPLICATE KEY UPDATE
        hosts_default_view = VALUES(hosts_default_view)
    `)
  }

  async updateJitAccessSettings(
    tenantId: number,
    input: { enabled: boolean; expiryMinutes: number[]; maxExpiryMinutes: number; pinRequired: boolean },
  ) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (tenant_id, max_users, jit_access_expiry_minutes_json, jit_access_max_expiry_minutes, jit_access_enabled, jit_access_pin_required, issued_at)
      VALUES (${tenantId}, ${env.LICENSE_MAX_USERS}, ${JSON.stringify(input.expiryMinutes)}, ${input.maxExpiryMinutes}, ${input.enabled}, ${input.pinRequired}, NOW())
      ON DUPLICATE KEY UPDATE
        jit_access_expiry_minutes_json = VALUES(jit_access_expiry_minutes_json),
        jit_access_max_expiry_minutes  = VALUES(jit_access_max_expiry_minutes),
        jit_access_enabled             = VALUES(jit_access_enabled),
        jit_access_pin_required        = VALUES(jit_access_pin_required)
    `)
  }

  async updateSharedSessionSettings(
    tenantId: number,
    input: { expiryMinutes: number[]; maxExpiryMinutes: number },
  ) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO licenses (tenant_id, max_users, shared_session_expiry_minutes_json, shared_session_max_expiry_minutes, issued_at)
      VALUES (${tenantId}, ${env.LICENSE_MAX_USERS}, ${JSON.stringify(input.expiryMinutes)}, ${input.maxExpiryMinutes}, NOW())
      ON DUPLICATE KEY UPDATE
        shared_session_expiry_minutes_json = VALUES(shared_session_expiry_minutes_json),
        shared_session_max_expiry_minutes  = VALUES(shared_session_max_expiry_minutes)
    `)
  }
}

function normalizeSessionAuditAiProvider(value: string | null | undefined): 'automatic' | 'openai' | 'local_ai' {
  if (value === 'openai' || value === 'local_ai') return value
  return 'automatic'
}

function normalizeJitAccessSettings(
  expiryMinutesJson: unknown,
  maxExpiryMinutesRaw: number | null,
  enabledRaw?: boolean | number | bigint | null,
  pinRequiredRaw?: boolean | number | bigint | null,
): { enabled: boolean; expiryMinutes: number[]; maxExpiryMinutes: number; pinRequired: boolean } {
  const maxExpiryMinutes = Number.isInteger(maxExpiryMinutesRaw) && maxExpiryMinutesRaw && maxExpiryMinutesRaw > 0
    ? Math.min(1440, maxExpiryMinutesRaw)
    : DEFAULT_JIT_ACCESS_SETTINGS.maxExpiryMinutes

  let parsed: unknown = expiryMinutesJson
  if (typeof expiryMinutesJson === 'string') {
    try {
      parsed = JSON.parse(expiryMinutesJson) as unknown
    } catch {
      parsed = null
    }
  }

  const expiryMinutes = Array.isArray(parsed)
    ? normalizeJitExpiryMinutes(parsed, maxExpiryMinutes)
    : DEFAULT_JIT_ACCESS_SETTINGS.expiryMinutes

  return {
    enabled: enabledRaw === null || enabledRaw === undefined ? DEFAULT_JIT_ACCESS_SETTINGS.enabled : parseBool(enabledRaw),
    maxExpiryMinutes,
    expiryMinutes: expiryMinutes.length > 0 ? expiryMinutes : DEFAULT_JIT_ACCESS_SETTINGS.expiryMinutes,
    pinRequired: parseBool(pinRequiredRaw),
  }
}

function normalizeJitExpiryMinutes(values: unknown[], maxExpiryMinutes: number): number[] {
  return Array.from(new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= maxExpiryMinutes)))
    .sort((a, b) => a - b)
}

function normalizeSharedSessionSettings(
  expiryMinutesJson: unknown,
  maxExpiryMinutesRaw: number | null,
): { expiryMinutes: number[]; maxExpiryMinutes: number } {
  const maxExpiryMinutes = Number.isInteger(maxExpiryMinutesRaw) && maxExpiryMinutesRaw && maxExpiryMinutesRaw > 0
    ? Math.min(1440, maxExpiryMinutesRaw)
    : DEFAULT_SHARED_SESSION_SETTINGS.maxExpiryMinutes

  let parsed: unknown = expiryMinutesJson
  if (typeof expiryMinutesJson === 'string') {
    try {
      parsed = JSON.parse(expiryMinutesJson) as unknown
    } catch {
      parsed = null
    }
  }

  const expiryMinutes = Array.isArray(parsed)
    ? normalizeJitExpiryMinutes(parsed, maxExpiryMinutes)
    : DEFAULT_SHARED_SESSION_SETTINGS.expiryMinutes

  return {
    maxExpiryMinutes,
    expiryMinutes: expiryMinutes.length > 0 ? expiryMinutes : DEFAULT_SHARED_SESSION_SETTINGS.expiryMinutes,
  }
}
