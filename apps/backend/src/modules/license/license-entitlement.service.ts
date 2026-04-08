import type { PrismaClient } from '@prisma/client'
import { ForbiddenError } from '../../shared/errors.js'

function parseBool(value: boolean | number | bigint | null | undefined): boolean {
  return value === true || value === 1 || value === BigInt(1)
}

function parseJsonRecord(value: unknown): Record<string, boolean> {
  if (!value) return {}
  try {
    const parsed = typeof value === 'string'
      ? JSON.parse(value) as Record<string, unknown>
      : value as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([key, raw]) => [key, raw === true]))
  } catch {
    return {}
  }
}

export interface LicenseEntitlementsSnapshot {
  featureEntitlements: Record<string, boolean>
  integrationEntitlements: Record<string, boolean>
}

export class LicenseEntitlementService {
  constructor(private readonly db: PrismaClient) {}

  async getSnapshot(tenantId: number): Promise<LicenseEntitlementsSnapshot> {
    try {
      const rows = await this.db.$queryRaw<Array<{
        featureEntitlementsJson: unknown
        integrationEntitlementsJson: unknown
      }>>`
        SELECT
          feature_entitlements_json AS featureEntitlementsJson,
          integration_entitlements_json AS integrationEntitlementsJson
        FROM licenses
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `

      const row = rows[0]
      return {
        featureEntitlements: parseJsonRecord(row?.featureEntitlementsJson),
        integrationEntitlements: parseJsonRecord(row?.integrationEntitlementsJson),
      }
    } catch {
      return {
        featureEntitlements: {},
        integrationEntitlements: {},
      }
    }
  }

  async isFeatureEnabled(tenantId: number, featureKey: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(tenantId)
    return snapshot.featureEntitlements[featureKey] === true
  }

  async isIntegrationProviderEnabled(tenantId: number, providerKey: string): Promise<boolean> {
    const snapshot = await this.getSnapshot(tenantId)
    return snapshot.featureEntitlements.integrations === true
      && snapshot.integrationEntitlements[providerKey] === true
  }

  async requireFeature(tenantId: number, featureKey: string, message: string): Promise<void> {
    const enabled = await this.isFeatureEnabled(tenantId, featureKey)
    if (!enabled) throw new ForbiddenError(message)
  }

  async requireIntegrationProvider(tenantId: number, providerKey: string, message: string): Promise<void> {
    const enabled = await this.isIntegrationProviderEnabled(tenantId, providerKey)
    if (!enabled) throw new ForbiddenError(message)
  }

  async isSessionAuditAiLicensed(tenantId: number): Promise<boolean> {
    try {
      const rows = await this.db.$queryRaw<Array<{ sessionAuditAiEnabled: boolean | number | bigint }>>`
        SELECT session_audit_ai_enabled AS sessionAuditAiEnabled
        FROM licenses
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `
      return parseBool(rows[0]?.sessionAuditAiEnabled)
    } catch {
      return false
    }
  }
}
