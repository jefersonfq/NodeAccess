import type { PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'
import { env } from '../../config/env.js'

interface LicenseRow {
  maxUsers: number
  maxHosts: number | null
  multiConnect: boolean | number | bigint
  sessionAuditEnabled: boolean | number | bigint
  sessionAuditAiEnabled: boolean | number | bigint
  featureEntitlementsJson: string | null
  integrationEntitlementsJson: string | null
  maxActiveSessionsPerUser: number | null
  maxActiveSessionsTenant: number | null
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

export class SettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findTenantById(tenantId: number) {
    return this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    })
  }

  async findLicense(tenantId: number) {
    try {
      const rows = await this.db.$queryRaw<Array<LicenseRow>>`
        SELECT
          max_users AS maxUsers,
          max_hosts AS maxHosts,
          multi_connect AS multiConnect,
          session_audit_enabled AS sessionAuditEnabled,
          session_audit_ai_enabled AS sessionAuditAiEnabled,
          feature_entitlements_json AS featureEntitlementsJson,
          integration_entitlements_json AS integrationEntitlementsJson,
          max_active_sessions_per_user AS maxActiveSessionsPerUser,
          max_active_sessions_tenant AS maxActiveSessionsTenant
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
        featureEntitlements: parseJsonRecord(license.featureEntitlementsJson),
        integrationEntitlements: parseJsonRecord(license.integrationEntitlementsJson),
        maxActiveSessionsPerUser: license.maxActiveSessionsPerUser,
        maxActiveSessionsTenant: license.maxActiveSessionsTenant,
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
        featureEntitlements: {},
        integrationEntitlements: {},
        maxActiveSessionsPerUser: null,
        maxActiveSessionsTenant: null,
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
    return this.db.host.count({ where: { tenantId } })
  }

  async updateLicenseEntitlements(
    tenantId: number,
    input: {
      maxHosts: number | null
      featureEntitlements: Record<string, boolean>
      integrationEntitlements: Record<string, boolean>
    },
  ) {
    const current = await this.db.license.findUnique({
      where: { tenantId },
      select: {
        maxUsers: true,
        multiConnect: true,
        sessionAuditEnabled: true,
        sessionAuditAiEnabled: true,
        maxActiveSessionsPerUser: true,
        maxActiveSessionsTenant: true,
        expiresAt: true,
        keyHash: true,
        active: true,
      },
    })

    await this.db.license.upsert({
      where: { tenantId },
      update: {
        maxHosts: input.maxHosts,
        featureEntitlementsJson: input.featureEntitlements,
        integrationEntitlementsJson: input.integrationEntitlements,
      },
      create: {
        tenantId,
        maxUsers: current?.maxUsers ?? env.LICENSE_MAX_USERS,
        maxHosts: input.maxHosts,
        multiConnect: current?.multiConnect ?? false,
        sessionAuditEnabled: current?.sessionAuditEnabled ?? false,
        sessionAuditAiEnabled: current?.sessionAuditAiEnabled ?? false,
        featureEntitlementsJson: input.featureEntitlements,
        integrationEntitlementsJson: input.integrationEntitlements,
        maxActiveSessionsPerUser: current?.maxActiveSessionsPerUser ?? null,
        maxActiveSessionsTenant: current?.maxActiveSessionsTenant ?? null,
        expiresAt: current?.expiresAt ?? null,
        keyHash: current?.keyHash ?? null,
        active: current?.active ?? true,
      },
    })
  }
}
