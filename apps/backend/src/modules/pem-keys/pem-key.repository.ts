import type { PrismaClient, PemKey } from '@prisma/client'

export class PemKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByUser(createdById: number): Promise<PemKey[]> {
    return this.db.pemKey.findMany({
      where: { createdById },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findAll(): Promise<PemKey[]> {
    return this.db.pemKey.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async findById(id: number): Promise<PemKey | null> {
    return this.db.pemKey.findUnique({ where: { id } })
  }

  async create(data: {
    name:         string
    encryptedKey: string
    iv:           string
    createdById:  number
  }): Promise<PemKey> {
    return this.db.pemKey.create({ data })
  }

  async delete(id: number): Promise<void> {
    await this.db.pemKey.delete({ where: { id } })
  }

  async isUsedByHost(id: number): Promise<boolean> {
    const count = await this.db.host.count({ where: { pemKeyId: id } })
    return count > 0
  }
}
