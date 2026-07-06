import { Prisma, type PrismaClient, type Group } from '@prisma/client'

export interface GroupListFilters {
  page?: number
  limit?: number
  search?: string
}

export class GroupRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(tenantId: number): Promise<Group[]> {
    return this.db.group.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    })
  }

  async findAllForUser(tenantId: number, userId: number): Promise<Group[]> {
    return this.db.group.findMany({
      where: {
        tenantId,
        users: {
          some: { userId },
        },
      },
      orderBy: { name: 'asc' },
    })
  }

  async findPaginated(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    filters: GroupListFilters,
  ): Promise<{ groups: Group[]; total: number }> {
    const page  = Math.max(1, filters.page ?? 1)
    const limit = Math.max(1, Math.min(100, filters.limit ?? 20))
    const search = filters.search?.trim()
    const where: Prisma.GroupWhereInput = {
      tenantId,
      ...(role === 'USER' && {
        users: {
          some: { userId },
        },
      }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { description: { contains: search } },
        ],
      }),
    }

    const [groups, total] = await this.db.$transaction([
      this.db.group.findMany({
        where,
        orderBy: { name: 'asc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      this.db.group.count({ where }),
    ])

    return { groups, total }
  }

  async findById(id: number, tenantId: number): Promise<Group | null> {
    return this.db.group.findFirst({ where: { id, tenantId } })
  }

  async create(data: {
    name: string
    description?: string
    bastionId?: number
    tenantId: number
  }): Promise<Group> {
    return this.db.group.create({ data })
  }

  async update(
    id: number,
    data: { name?: string; description?: string; bastionId?: number | null },
  ): Promise<Group> {
    return this.db.group.update({ where: { id }, data })
  }

  async delete(id: number): Promise<void> {
    await this.db.group.delete({ where: { id } })
  }

  async hasHosts(id: number): Promise<boolean> {
    const count = await this.db.host.count({ where: { groupId: id, deletedAt: null } })
    return count > 0
  }

  async hasUsers(id: number): Promise<boolean> {
    const count = await this.db.userGroup.count({ where: { groupId: id } })
    return count > 0
  }

  async existsByName(name: string, tenantId: number, excludeId?: number): Promise<boolean> {
    const group = await this.db.group.findFirst({
      where: { name, tenantId, ...(excludeId !== undefined && { NOT: { id: excludeId } }) },
      select: { id: true },
    })
    return group !== null
  }

  async bastionExists(id: number, tenantId: number): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*) AS count
        FROM bastion_hosts
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `,
    )
    return Number(rows[0]?.count ?? 0) > 0
  }
}
