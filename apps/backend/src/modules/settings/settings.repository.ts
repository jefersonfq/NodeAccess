import type { PrismaClient } from '@prisma/client'
import { logger } from '../../config/logger.js'

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
      return await this.db.license.findUnique({
        where: { tenantId },
        select: {
          maxUsers: true,
          multiConnect: true,
          sessionAuditEnabled: true,
          sessionAuditAiEnabled: true,
          maxActiveSessionsPerUser: true,
          maxActiveSessionsTenant: true,
        },
      })
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
        sessionAuditEnabled: false,
        sessionAuditAiEnabled: false,
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
}
