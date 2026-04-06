import type { PrismaClient } from '@prisma/client'
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
