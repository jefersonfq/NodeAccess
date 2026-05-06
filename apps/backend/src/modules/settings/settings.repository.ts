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
          totp_issuer AS totpIssuer
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
      }
    }
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
        ${current ? parseBool(current.multiConnect) : false},
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
}

function normalizeSessionAuditAiProvider(value: string | null | undefined): 'automatic' | 'openai' | 'local_ai' {
  if (value === 'openai' || value === 'local_ai') return value
  return 'automatic'
}
