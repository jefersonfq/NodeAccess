import type { PrismaClient, Tenant } from '@prisma/client'

export interface TenantWithLicense extends Tenant {
  license: { maxUsers: number } | null
  _count: { users: number }
}

export class TenantRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(): Promise<TenantWithLicense[]> {
    return this.db.tenant.findMany({
      include: {
        license: { select: { maxUsers: true } },
        _count:  { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async countActiveUsers(tenantId: number): Promise<number> {
    return this.db.user.count({ where: { tenantId, active: true, licenseConsumed: true } })
  }

  async findById(id: number): Promise<TenantWithLicense | null> {
    return this.db.tenant.findUnique({
      where: { id },
      include: {
        license: { select: { maxUsers: true } },
        _count:  { select: { users: true } },
      },
    })
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { slug } })
  }

  async findUserByEmail(email: string): Promise<{ id: number } | null> {
    return this.db.user.findUnique({ where: { email }, select: { id: true } })
  }

  async create(data: {
    name: string
    slug: string
    active: boolean
    maxUsers: number
    firstAdmin?: {
      name: string
      email: string
      passwordHash: string
    }
  }): Promise<TenantWithLicense> {
    return this.db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          active: data.active,
        },
      })

      await tx.license.create({
        data: {
          tenantId: tenant.id,
          maxUsers: data.maxUsers,
          active: true,
        },
      })

      if (data.firstAdmin) {
        await tx.user.create({
          data: {
            name: data.firstAdmin.name,
            email: data.firstAdmin.email,
            passwordHash: data.firstAdmin.passwordHash,
            role: 'ADMIN',
            tenantId: tenant.id,
            canManageHosts: true,
            forcePasswordChange: true,
          },
        })
      }

      return tx.tenant.findUniqueOrThrow({
        where: { id: tenant.id },
        include: {
          license: { select: { maxUsers: true } },
          _count:  { select: { users: true } },
        },
      })
    })
  }

  async update(id: number, data: { name?: string; active?: boolean; maxUsers?: number }): Promise<TenantWithLicense> {
    return this.db.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.active !== undefined && { active: data.active }),
        },
      })

      if (data.maxUsers !== undefined) {
        await tx.license.upsert({
          where: { tenantId: id },
          create: { tenantId: id, maxUsers: data.maxUsers, active: true },
          update: { maxUsers: data.maxUsers },
        })
      }

      return tx.tenant.findUniqueOrThrow({
        where: { id },
        include: {
          license: { select: { maxUsers: true } },
          _count:  { select: { users: true } },
        },
      })
    })
  }
}
