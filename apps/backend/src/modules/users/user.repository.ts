import { Prisma, type PrismaClient, type User, type Tenant, type AuthEventType } from '@prisma/client'

export interface UserFilters {
  search?: string
  role?: 'ADMIN' | 'USER'
  active?: boolean
  includeDeleted?: boolean
  page?: number
  limit?: number
}

export interface UserInventoryAccessRow {
  aclEntryId: number
  inventoryNodeId: number
  inventoryNodeName: string
  inventoryNodeType: 'ROOT' | 'FOLDER' | 'HOST'
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: number
  principalName: string
  canView: boolean | number
  canConnect: boolean | number
  canEdit: boolean | number
  canAdmin: boolean | number
  inheritToChildren: boolean | number
  hostCount: bigint | number
  updatedAt: Date
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

  async findAvatarMetadata(id: number, tenantId: number): Promise<{ mimeType: string | null; avatarUpdatedAt: Date | null } | null> {
    const rows = await this.db.$queryRaw<Array<{ mimeType: string | null; avatarUpdatedAt: Date | null }>>`
      SELECT avatar_mime_type AS mimeType, avatar_updated_at AS avatarUpdatedAt
      FROM users
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async findAvatarMetadataByUsers(userIds: number[]): Promise<Map<number, { mimeType: string | null; avatarUpdatedAt: Date | null }>> {
    if (userIds.length === 0) return new Map()
    const rows = await this.db.$queryRaw<Array<{ id: number; mimeType: string | null; avatarUpdatedAt: Date | null }>>`
      SELECT id, avatar_mime_type AS mimeType, avatar_updated_at AS avatarUpdatedAt
      FROM users
      WHERE id IN (${Prisma.join(userIds)})
    `
    return new Map(rows.map((row) => [row.id, { mimeType: row.mimeType, avatarUpdatedAt: row.avatarUpdatedAt }]))
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

  async findInventoryAccessSources(userId: number, tenantId: number): Promise<UserInventoryAccessRow[]> {
    return this.db.$queryRaw<UserInventoryAccessRow[]>(Prisma.sql`
      SELECT
        acl.id AS aclEntryId,
        node.id AS inventoryNodeId,
        node.name AS inventoryNodeName,
        node.type AS inventoryNodeType,
        acl.principal_type AS principalType,
        acl.principal_id AS principalId,
        COALESCE(
          principal_user.name,
          principal_group.name,
          CASE acl.principal_id WHEN 1 THEN 'All users' WHEN 2 THEN 'Tenant admins' END,
          CONCAT('#', acl.principal_id)
        ) AS principalName,
        acl.can_view AS canView,
        acl.can_connect AS canConnect,
        acl.can_edit AS canEdit,
        acl.can_admin AS canAdmin,
        acl.inherit_to_children AS inheritToChildren,
        (
          SELECT COUNT(*)
          FROM inventory_nodes host_node
          WHERE host_node.tenant_id = node.tenant_id
            AND host_node.deleted_at IS NULL
            AND host_node.type = 'HOST'
            AND host_node.path LIKE CONCAT(node.path, '%')
        ) AS hostCount,
        acl.updated_at AS updatedAt
      FROM users target_user
      INNER JOIN resource_acl_entries acl
        ON acl.tenant_id = target_user.tenant_id
       AND (
          (acl.principal_type = 'USER' AND acl.principal_id = target_user.id)
          OR (
            acl.principal_type = 'GROUP'
            AND EXISTS (
              SELECT 1
              FROM user_groups ug
              INNER JOIN \`groups\` g
                ON g.id = ug.group_id
               AND g.tenant_id = target_user.tenant_id
              WHERE ug.user_id = target_user.id
                AND ug.group_id = acl.principal_id
            )
          )
          OR (
            acl.principal_type = 'ROLE'
            AND (
              acl.principal_id = 1
              OR (acl.principal_id = 2 AND target_user.role = 'ADMIN')
            )
          )
       )
      INNER JOIN inventory_nodes node
        ON node.id = acl.inventory_node_id
       AND node.tenant_id = target_user.tenant_id
       AND node.deleted_at IS NULL
      LEFT JOIN users principal_user
        ON acl.principal_type = 'USER'
       AND principal_user.id = acl.principal_id
       AND principal_user.tenant_id = target_user.tenant_id
      LEFT JOIN \`groups\` principal_group
        ON acl.principal_type = 'GROUP'
       AND principal_group.id = acl.principal_id
       AND principal_group.tenant_id = target_user.tenant_id
      WHERE target_user.id = ${userId}
        AND target_user.tenant_id = ${tenantId}
        AND target_user.deleted_at IS NULL
      ORDER BY node.depth ASC, node.name ASC, acl.principal_type ASC, acl.id ASC
    `)
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
    await this.db.$executeRaw`
      UPDATE users
      SET active = ${active},
          license_consumed = ${active},
          session_version = session_version + ${active ? 0 : 1},
          updated_at = ${new Date()}
      WHERE id = ${id}
    `
  }

  async findSessionVersion(id: number, tenantId: number): Promise<number | null> {
    const rows = await this.db.$queryRaw<Array<{ sessionVersion: number }>>`
      SELECT session_version AS sessionVersion
      FROM users
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
      LIMIT 1
    `
    return rows[0]?.sessionVersion ?? null
  }

  async incrementSessionVersion(id: number, tenantId: number): Promise<number | null> {
    const changed = await this.db.$executeRaw`
      UPDATE users
      SET session_version = session_version + 1
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
    `
    if (changed !== 1) return null
    return this.findSessionVersion(id, tenantId)
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

  async updateAvatarMetadata(id: number, mimeType: string, avatarUpdatedAt: Date): Promise<void> {
    await this.db.$executeRaw`
      UPDATE users
      SET avatar_mime_type = ${mimeType},
          avatar_updated_at = ${avatarUpdatedAt}
      WHERE id = ${id}
    `
  }

  async clearAvatarMetadata(id: number): Promise<void> {
    await this.db.$executeRaw`
      UPDATE users
      SET avatar_mime_type = NULL,
          avatar_updated_at = NULL
      WHERE id = ${id}
    `
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

  async resetMfa(id: number): Promise<void> {
    await this.db.user.update({
      where: { id },
      data: {
        mfaSecret: null,
        mfaEnabled: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })
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
    await this.db.$executeRaw`
      UPDATE users
      SET deleted_at = ${new Date()},
          active = false,
          license_consumed = false,
          session_version = session_version + 1,
          updated_at = ${new Date()}
      WHERE id = ${id}
    `
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

  async createLdapUser(data: {
    name:     string
    email:    string
    tenantId: number
  }): Promise<User> {
    return this.db.user.create({
      data: {
        name:                data.name,
        email:               data.email,
        role:                'USER',
        canManageHosts:      false,
        licenseConsumed:     true,
        forcePasswordChange: false,
        tenantId:            data.tenantId,
      },
    })
  }

  async findGoogleLinkedUsers(tenantId: number): Promise<User[]> {
    return this.db.user.findMany({
      where: { tenantId, googleId: { not: null } },
    })
  }
}
