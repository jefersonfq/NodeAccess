import type { PrismaClient } from '@prisma/client'

export class FolderRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(userId: number, tenantId: number) {
    return this.db.folder.findMany({
      where:   { userId, tenantId },
      orderBy: { name: 'asc' },
    })
  }

  async findById(id: number, userId: number, tenantId: number) {
    return this.db.folder.findFirst({ where: { id, userId, tenantId } })
  }

  async create(data: { name: string; userId: number; tenantId: number; parentId: number | null }) {
    return this.db.folder.create({ data: { ...data, parentKey: data.parentId ?? 0 } })
  }

  async update(id: number, userId: number, name: string) {
    return this.db.folder.update({ where: { id }, data: { name } })
  }

  async delete(id: number, _userId: number) {
    // Desassocia os hosts antes de excluir
    await this.db.host.updateMany({ where: { folderId: id }, data: { folderId: null } })
    await this.db.folder.delete({ where: { id } })
  }

  async countChildren(id: number, userId: number, tenantId: number): Promise<number> {
    return this.db.folder.count({ where: { parentId: id, userId, tenantId } })
  }

  async existsByName(name: string, userId: number, tenantId: number, parentId: number | null, excludeId?: number): Promise<boolean> {
    const count = await this.db.folder.count({
      where: {
        name,
        userId,
        tenantId,
        parentId,
        ...(excludeId !== undefined ? { id: { not: excludeId } } : {}),
      },
    })
    return count > 0
  }
}
