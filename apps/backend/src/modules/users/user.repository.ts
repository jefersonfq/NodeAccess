import { Prisma, type PrismaClient, type User, type Tenant, type AuthEventType } from '@prisma/client'

export interface UserFilters {
  search?: string
  role?: 'ADMIN' | 'USER'
  active?: boolean
  includeDeleted?: boolean
  page?: number
  limit?: number
}

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  // ---------------------------------------------------------------------------
  // Tenant
  // ---------------------------------------------------------------------------

  async findTenantBySlug(slug: string): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { slug } })
  }

  async findTenantById(id: number): Promise<Tenant | null> {
    return this.db.tenant.findUnique({ where: { id } })
  }

  async findLicenseByTenant(tenantId: number): Promise<{ maxUsers: number } | null> {
    return this.db.license.findUnique({
      where: { tenantId },
      select: { maxUsers: true },
    })
  }

  async findTenantsByEmail(email: string): Promise<{ id: number; name: string; slug: string }[]> {
    const users = await this.db.user.findMany({
      where: { email, active: true, deletedAt: null },
      select: { tenant: { select: { id: true, name: true, slug: true, active: true } } },
    })
    return users
      .map(u => u.tenant)
      .filter(t => t.active)
      .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i) // dedup
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  async findByEmail(email: string, tenantId: number): Promise<User | null> {
    return this.db.user.findFirst({ where: { email, tenantId, deletedAt: null } })
  }

  async findByEmailIncludingDeleted(email: string, tenantId: number): Promise<User | null> {
    return this.db.user.findFirst({ where: { email, tenantId } })
  }

  async findById(id: number): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } })
  }

  async isPlatformAdmin(id: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ is_platform_admin: boolean | number | bigint }>>`
      SELECT is_platform_admin
      FROM users
      WHERE id = ${id}
      LIMIT 1
    `
    const value = rows[0]?.is_platform_admin
    return value === true || value === 1 || value === BigInt(1)
  }

  async findByIdInTenant(id: number, tenantId: number): Promise<User | null> {
    return this.db.user.findFirst({ where: { id, tenantId, deletedAt: null } })
  }

  async findByIdInTenantIncludingDeleted(id: number, tenantId: number): Promise<User | null> {
    return this.db.user.findFirst({ where: { id, tenantId } })
  }

  async findPreferencesByIdInTenant(id: number, tenantId: number): Promise<Prisma.JsonValue | null> {
    const user = await this.db.user.findFirst({
      where: { id, tenantId },
      select: { preferencesJson: true },
    })
    return user?.preferencesJson ?? null
  }

  async findAll(
    tenantId: number,
    filters: UserFilters,
  ): Promise<{ users: User[]; total: number }> {
    const { search, role, active, includeDeleted = false, page = 1, limit = 20 } = filters
    const skip = (page - 1) * limit

    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(role !== undefined && { role }),
      ...(active !== undefined && { active }),
      ...(!includeDeleted && { deletedAt: null }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      }),
    }

    const [users, total] = await this.db.$transaction([
      this.db.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.db.user.count({ where }),
    ])

    return { users, total }
  }

  async findGroupIdsByUser(userId: number): Promise<number[]> {
    const rows = await this.db.userGroup.findMany({
      where: { userId },
      select: { groupId: true },
    })
    return rows.map((r) => r.groupId)
  }

  async findGroupIdsByUsers(userIds: number[]): Promise<Map<number, number[]>> {
    const rows = await this.db.userGroup.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, groupId: true },
    })
    const map = new Map<number, number[]>(userIds.map((id) => [id, []]))
    for (const row of rows) {
      map.get(row.userId)!.push(row.groupId)
    }
    return map
  }

  async findLiveSessionsPermissionsByUsers(userIds: number[]): Promise<Map<number, boolean>> {
    if (userIds.length === 0) return new Map()
    const rows = await this.db.$queryRaw<Array<{ id: number; canViewLiveSessions: boolean | number | bigint }>>`
      SELECT id, can_view_live_sessions AS canViewLiveSessions
      FROM users
      WHERE id IN (${Prisma.join(userIds)})
    `
    return new Map(rows.map((row) => [
      row.id,
      row.canViewLiveSessions === true || row.canViewLiveSessions === 1 || row.canViewLiveSessions === BigInt(1),
    ]))
  }

  async canViewLiveSessions(id: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ canViewLiveSessions: boolean | number | bigint }>>`
      SELECT can_view_live_sessions AS canViewLiveSessions
      FROM users
      WHERE id = ${id}
      LIMIT 1
    `
    const value = rows[0]?.canViewLiveSessions
    return value === true || value === 1 || value === BigInt(1)
  }

  // ---------------------------------------------------------------------------
  // Escrita
  // ---------------------------------------------------------------------------

  async create(data: {
    name: string
    email: string
    passwordHash: string
    role: 'ADMIN' | 'USER'
    canManageHosts: boolean
    canViewLiveSessions: boolean
    tenantId: number
    groupIds: number[]
  }): Promise<User> {
    const { groupIds, ...userData } = data
    const { canViewLiveSessions, ...prismaUserData } = userData
    const user = await this.db.user.create({
      data: {
        ...prismaUserData,
        forcePasswordChange: true,
        groups: {
          create: groupIds.map((groupId) => ({ groupId })),
        },
      },
    })
    if (canViewLiveSessions) await this.setCanViewLiveSessions(user.id, true)
    return user
  }

  async update(
    id: number,
    data: {
      name?: string
      role?: 'ADMIN' | 'USER'
      canManageHosts?: boolean
      canViewLiveSessions?: boolean
      groupIds?: number[]
    },
  ): Promise<User> {
    const { groupIds, canViewLiveSessions, ...rest } = data
    const user = await this.db.user.update({
      where: { id },
      data: {
        ...rest,
        ...(groupIds !== undefined && {
          groups: {
            deleteMany: {},
            create: groupIds.map((groupId) => ({ groupId })),
          },
        }),
      },
    })
    if (canViewLiveSessions !== undefined) await this.setCanViewLiveSessions(id, canViewLiveSessions)
    return user
  }

  async setCanViewLiveSessions(id: number, value: boolean): Promise<void> {
    await this.db.$executeRaw`
      UPDATE users
      SET can_view_live_sessions = ${value}
      WHERE id = ${id}
    `
  }

  async setActive(id: number, active: boolean): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { active, licenseConsumed: active },
    })
  }

  async setForcePasswordChange(id: number, value: boolean): Promise<void> {
    await this.db.user.update({ where: { id }, data: { forcePasswordChange: value } })
  }

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { passwordHash, forcePasswordChange: false },
    })
  }

  async updatePreferences(id: number, preferences: Prisma.InputJsonValue): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { preferencesJson: preferences },
    })
  }

  // ---------------------------------------------------------------------------
  // Auth helpers (usados por AuthService)
  // ---------------------------------------------------------------------------

  async incrementFailedAttempts(id: number): Promise<number> {
    const updated = await this.db.user.update({
      where: { id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    })
    return updated.failedLoginAttempts
  }

  async lockAccount(id: number, until: Date): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { lockedUntil: until, failedLoginAttempts: 0 },
    })
  }

  async resetFailedAttempts(id: number): Promise<void> {
    await this.db.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
  }

  async saveMfaSecret(id: number, secret: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { mfaSecret: secret } })
  }

  async enableMfa(id: number, secret: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { mfaSecret: secret, mfaEnabled: true } })
  }

  async logAuthEvent(data: {
    userId?: number
    eventType: AuthEventType
    ip?: string
    userAgent?: string
    success: boolean
  }): Promise<void> {
    await this.db.authLog.create({ data })
  }

  async logAdminEvent(data: {
    adminId:    number
    action:     string
    targetType: string
    targetId:   number
    details?:   string
  }): Promise<void> {
    await this.db.adminLog.create({ data })
  }

  async softDelete(id: number): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { deletedAt: new Date(), active: false, licenseConsumed: false },
    })
  }

  async restore(id: number): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: { deletedAt: null, active: true, licenseConsumed: true },
    })
  }

  async countActiveByTenant(tenantId: number): Promise<number> {
    return this.db.user.count({ where: { tenantId, active: true, licenseConsumed: true } })
  }

  // ---------------------------------------------------------------------------
  // Google SSO helpers
  // ---------------------------------------------------------------------------

  async findByGoogleId(googleId: string, tenantId: number): Promise<User | null> {
    return this.db.user.findFirst({ where: { googleId, tenantId } })
  }

  async linkGoogleId(id: number, googleId: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { googleId } })
  }

  async createGoogleUser(data: {
    name:     string
    email:    string
    googleId: string
    tenantId: number
  }): Promise<User> {
    return this.db.user.create({
      data: {
        name:               data.name,
        email:              data.email,
        googleId:           data.googleId,
        role:               'USER',
        canManageHosts:     false,
        licenseConsumed:    true,
        forcePasswordChange: false,
        tenantId:           data.tenantId,
      },
    })
  }

  async findGoogleLinkedUsers(tenantId: number): Promise<User[]> {
    return this.db.user.findMany({
      where: { tenantId, googleId: { not: null } },
    })
  }
}
