import type { PrismaClient, Tag } from '@prisma/client'

const TAG_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#ec4899', '#84cc16', '#14b8a6',
]

/** Cor determinística baseada no nome — mesma tag sempre recebe a mesma cor */
function colorForName(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0x7fffffff
  return TAG_COLORS[hash % TAG_COLORS.length] ?? '#6b7280'
}

export class TagRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByTenant(tenantId: number): Promise<Tag[]> {
    return this.db.tag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    })
  }

  async findById(id: number, tenantId: number): Promise<Tag | null> {
    return this.db.tag.findFirst({
      where: { id, tenantId },
    })
  }

  async countHostsByTagId(tagId: number): Promise<number> {
    return this.db.hostTag.count({
      where: { tagId },
    })
  }

  async delete(id: number): Promise<void> {
    await this.db.tag.delete({
      where: { id },
    })
  }

  /**
   * Upsert tags por nome dentro do tenant.
   * Cria se não existe (com cor determinística); retorna todos os IDs.
   */
  async upsertByNames(tenantId: number, names: string[]): Promise<Tag[]> {
    return Promise.all(
      names.map((name) =>
        this.db.tag.upsert({
          where:  { name_tenantId: { name, tenantId } },
          create: { name, color: colorForName(name), tenantId },
          update: {},
        }),
      ),
    )
  }

  /**
   * Substitui as tags de um host: apaga as antigas e cria as novas.
   * Deve ser chamado dentro de uma transação do Prisma.
   */
  async syncHostTags(
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    hostId: number,
    tagIds: number[],
  ): Promise<void> {
    await tx.hostTag.deleteMany({ where: { hostId } })
    if (tagIds.length > 0) {
      await tx.hostTag.createMany({
        data: tagIds.map((tagId) => ({ hostId, tagId })),
      })
    }
  }
}
