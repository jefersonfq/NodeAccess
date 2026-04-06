import type { PrismaClient, BastionHost } from '@prisma/client'

export class BastionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAll(): Promise<BastionHost[]> {
    return this.db.bastionHost.findMany({ orderBy: { name: 'asc' } })
  }

  async findById(id: number): Promise<BastionHost | null> {
    return this.db.bastionHost.findUnique({ where: { id } })
  }

  async create(data: {
    name:              string
    ip:                string
    port:              number
    sshUser:           string
    authType:          'PEM' | 'PASSWORD'
    pemKeyId?:         number
    passwordEncrypted?: string
  }): Promise<BastionHost> {
    return this.db.bastionHost.create({ data })
  }

  async update(
    id: number,
    data: {
      name?:              string
      ip?:                string
      port?:              number
      sshUser?:           string
      authType?:          'PEM' | 'PASSWORD'
      pemKeyId?:          number | null
      passwordEncrypted?: string | null
    },
  ): Promise<BastionHost> {
    return this.db.bastionHost.update({ where: { id }, data })
  }

  async delete(id: number): Promise<void> {
    await this.db.bastionHost.delete({ where: { id } })
  }

  async createPemKey(data: { name: string; encryptedKey: string; iv: string }): Promise<number> {
    const key = await this.db.bastionPemKey.create({ data })
    return key.id
  }

  async deletePemKey(id: number): Promise<void> {
    await this.db.bastionPemKey.delete({ where: { id } })
  }

  async isUsedByGroupOrHost(id: number): Promise<boolean> {
    const [groups, hosts] = await Promise.all([
      this.db.group.count({ where: { bastionId: id } }),
      this.db.host.count({ where: { bastionId: id } }),
    ])
    return groups > 0 || hosts > 0
  }
}
