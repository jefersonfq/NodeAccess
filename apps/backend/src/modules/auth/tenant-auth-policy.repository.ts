import type { PrismaClient } from '@prisma/client'
import type { TenantAuthPolicyRequest } from './auth-policy.js'

export class TenantAuthPolicyRepository {
  constructor(private readonly db: PrismaClient) {}

  async find(tenantId: number): Promise<TenantAuthPolicyRequest | null> {
    const row = await this.db.tenantAuthPolicy.findUnique({ where: { tenantId } })
    if (!row) return null
    return {
      localLoginEnabled: row.localLoginEnabled,
      ssoRequired: row.ssoRequired,
      mfaRequired: row.mfaRequired,
      jitProvisioningEnabled: row.jitProvisioningEnabled,
      automaticAccountLinkingEnabled: row.automaticAccountLinkingEnabled,
      emailTenantDiscoveryEnabled: row.emailTenantDiscoveryEnabled,
      ...(row.lockoutMaxAttempts !== null && { lockoutMaxAttempts: row.lockoutMaxAttempts }),
      ...(row.lockoutDurationMinutes !== null && { lockoutDurationMinutes: row.lockoutDurationMinutes }),
      ...(row.accessTokenMinutes !== null && { accessTokenMinutes: row.accessTokenMinutes }),
      ...(row.refreshTokenDays !== null && { refreshTokenDays: row.refreshTokenDays }),
    }
  }

  async upsert(tenantId: number, policy: TenantAuthPolicyRequest): Promise<TenantAuthPolicyRequest> {
    await this.db.tenantAuthPolicy.upsert({
      where: { tenantId },
      create: { tenantId, ...policy },
      update: policy,
    })
    return (await this.find(tenantId))!
  }

  async setBreakGlass(tenantId: number, userId: number, validatedAt: Date): Promise<void> {
    await this.db.tenantAuthPolicy.upsert({
      where: { tenantId },
      create: { tenantId, breakGlassUserId: userId, breakGlassValidatedAt: validatedAt },
      update: { breakGlassUserId: userId, breakGlassValidatedAt: validatedAt },
    })
  }

  async getBreakGlass(tenantId: number): Promise<{
    userId: number
    email: string
    validatedAt: Date
  } | null> {
    const row = await this.db.tenantAuthPolicy.findUnique({
      where: { tenantId },
      select: {
        breakGlassValidatedAt: true,
        breakGlassUser: {
          select: {
            id: true, email: true, active: true, role: true, passwordHash: true,
            forcePasswordChange: true, lockedUntil: true, deletedAt: true,
          },
        },
      },
    })
    const user = row?.breakGlassUser
    if (!row?.breakGlassValidatedAt || !user || !user.active || user.deletedAt || user.role !== 'ADMIN'
      || !user.passwordHash || user.forcePasswordChange || (user.lockedUntil && user.lockedUntil > new Date())) return null
    return { userId: user.id, email: user.email, validatedAt: row.breakGlassValidatedAt }
  }
}
