import type { PrismaClient, Tenant, User } from '@prisma/client'

export type PlatformAdminWithTenant = User & {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>
}

export class PlatformAdminRepository {
  constructor(private readonly db: PrismaClient) {}

  list(): Promise<PlatformAdminWithTenant[]> {
    return this.db.user.findMany({
      where: { isPlatformAdmin: true },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  findById(id: number): Promise<PlatformAdminWithTenant | null> {
    return this.db.user.findUnique({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  findByEmail(email: string): Promise<PlatformAdminWithTenant | null> {
    return this.db.user.findFirst({
      where: { email, deletedAt: null },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  findByEmailInTenant(email: string, tenantId: number): Promise<PlatformAdminWithTenant | null> {
    return this.db.user.findFirst({
      where: { email, tenantId, deletedAt: null },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  findTenantById(id: number): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { id } })
  }

  async ensureTenant(slug: string, name: string): Promise<Tenant> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.tenant.findUnique({ where: { slug } })
      if (existing) {
        if (!existing.active) {
          return tx.tenant.update({ where: { id: existing.id }, data: { active: true } })
        }
        return existing
      }

      const tenant = await tx.tenant.create({
        data: { name, slug, active: true },
      })
      await tx.license.create({
        data: {
          tenantId: tenant.id,
          maxUsers: 50,
          active: true,
          maxActiveSessionsPerUser: 10,
          maxActiveSessionsTenant: 100,
        },
      })
      return tenant
    })
  }

  countActivePlatformAdmins(): Promise<number> {
    return this.db.user.count({ where: { isPlatformAdmin: true, active: true } })
  }

  create(data: {
    name: string
    email: string
    passwordHash: string
    tenantId: number
    forcePasswordChange: boolean
  }): Promise<PlatformAdminWithTenant> {
    return this.db.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: data.passwordHash,
        tenantId: data.tenantId,
        role: 'ADMIN',
        isPlatformAdmin: true,
        active: true,
        canManageHosts: true,
        licenseConsumed: true,
        forcePasswordChange: data.forcePasswordChange,
        mfaEnabled: false,
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  promote(
    id: number,
    data: {
      name?: string
      passwordHash?: string
      forcePasswordChange?: boolean
    },
  ): Promise<PlatformAdminWithTenant> {
    return this.db.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
        ...(data.forcePasswordChange !== undefined && { forcePasswordChange: data.forcePasswordChange }),
        role: 'ADMIN',
        isPlatformAdmin: true,
        active: true,
        canManageHosts: true,
        licenseConsumed: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  resetPassword(id: number, passwordHash: string): Promise<PlatformAdminWithTenant> {
    return this.db.user.update({
      where: { id },
      data: {
        passwordHash,
        forcePasswordChange: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  revoke(id: number): Promise<PlatformAdminWithTenant> {
    return this.db.user.update({
      where: { id },
      data: { isPlatformAdmin: false },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
  }

  logAdminEvent(data: {
    adminId: number
    action: string
    targetType: string
    targetId: number
    details?: string
  }): Promise<void> {
    return this.db.adminLog.create({ data }).then(() => undefined)
  }
}
