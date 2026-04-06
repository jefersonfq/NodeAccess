import type { PrismaClient, Group } from '@prisma/client'

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
    const count = await this.db.host.count({ where: { groupId: id } })
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
}
