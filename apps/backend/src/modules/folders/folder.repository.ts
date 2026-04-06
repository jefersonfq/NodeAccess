import type { PrismaClient } from '@prisma/client'

export class FolderRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(userId: number, tenantId: number) {
    return this.db.folder.findMany({
      where:   { userId, tenantId },
      orderBy: { name: 'asc' },
    })
  }

  async findById(id: number, userId: number) {
    return this.db.folder.findFirst({ where: { id, userId } })
  }

  async create(data: { name: string; userId: number; tenantId: number }) {
    return this.db.folder.create({ data })
  }

  async update(id: number, userId: number, name: string) {
    return this.db.folder.update({ where: { id }, data: { name } })
  }

  async delete(id: number, userId: number) {
    // Desassocia os hosts antes de excluir
    await this.db.host.updateMany({ where: { folderId: id }, data: { folderId: null } })
    await this.db.folder.delete({ where: { id } })
  }

  async existsByName(name: string, userId: number, tenantId: number): Promise<boolean> {
    const count = await this.db.folder.count({ where: { name, userId, tenantId } })
    return count > 0
  }
}
