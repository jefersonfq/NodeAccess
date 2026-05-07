import { Prisma, type PrismaClient, type PemKey } from '@prisma/client'

export class PemKeyRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByUser(createdById: number): Promise<PemKey[]> {
    return this.db.pemKey.findMany({
      where: { createdById },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findAll(tenantId: number): Promise<PemKey[]> {
    return this.db.pemKey.findMany({
      where: { createdBy: { tenantId } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findById(id: number, tenantId: number): Promise<PemKey | null> {
    return this.db.pemKey.findFirst({ where: { id, createdBy: { tenantId } } })
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

  async isUsedByHost(id: number, tenantId: number): Promise<boolean> {
    const [hosts, bastionRows] = await Promise.all([
      this.db.host.count({ where: { pemKeyId: id, tenantId, deletedAt: null } }),
      this.db.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`
          SELECT COUNT(*) AS count
          FROM bastion_hosts
          WHERE system_pem_key_id = ${id}
          AND tenant_id = ${tenantId}
        `,
      ),
    ])
    const bastions = Number(bastionRows[0]?.count ?? 0)
    return hosts > 0 || bastions > 0
  }
}
