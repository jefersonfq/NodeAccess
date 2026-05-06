import { Prisma, type PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'

export class IntegrationRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByProvider(tenantId: number, provider: string) {
    return this.db.integration.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    })
  }

  async listByTenant(tenantId: number) {
    return this.db.integration.findMany({ where: { tenantId } })
  }

  async isSessionAuditAiLicensed(tenantId: number): Promise<boolean> {
    try {
      const license = await this.db.license.findUnique({
        where: { tenantId },
        select: { sessionAuditAiEnabled: true },
      })
      return license?.sessionAuditAiEnabled ?? false
    } catch (err) {
      logger.warn(
        { err, tenantId },
        'Ignorando verificação de licença de IA até a migration do banco ser aplicada',
      )
      return false
    }
  }

  async findLicenseSnapshot(tenantId: number) {
    try {
      const rows = await this.db.$queryRaw<Array<{
        sessionAuditAiEnabled: boolean | number | bigint
        sessionAuditAiProvider: string | null
        featureEntitlementsJson: string | null
      }>>(Prisma.sql`
        SELECT
          session_audit_ai_enabled AS sessionAuditAiEnabled,
          session_audit_ai_provider AS sessionAuditAiProvider,
          feature_entitlements_json AS featureEntitlementsJson
        FROM licenses
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `)

      const row = rows[0]
      if (!row) return null

      return {
        sessionAuditAiEnabled: row.sessionAuditAiEnabled === true || row.sessionAuditAiEnabled === 1 || row.sessionAuditAiEnabled === BigInt(1),
        sessionAuditAiProvider: row.sessionAuditAiProvider,
        featureEntitlements: parseJsonRecord(row.featureEntitlementsJson),
      }
    } catch (err) {
      logger.warn(
        { err, tenantId },
        'Ignorando snapshot da licença de IA da auditoria até a migration do banco ser aplicada',
      )
      return null
    }
  }

  async upsert(tenantId: number, provider: string, enabled: boolean, config: string) {
    return this.db.integration.upsert({
      where:  { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, enabled, config },
      update: { enabled, config },
    })
  }

  async setEnabled(tenantId: number, provider: string, enabled: boolean) {
    return this.db.integration.update({
      where: { tenantId_provider: { tenantId, provider } },
      data:  { enabled },
    })
  }
}

function parseJsonRecord(value: string | null | undefined): Record<string, boolean> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([key, raw]) => [key, raw === true]),
    )
  } catch {
    return {}
  }
}
