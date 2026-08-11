import type { PrismaClient } from '@prisma/client'
import type { VaultSecretCipherRow, VaultSecretCipherUpdate, VaultSecretRewrapRepository } from './vault-secret-rewrap.service.js'

export class PrismaVaultSecretRewrapRepository implements VaultSecretRewrapRepository {
  constructor(private readonly db: PrismaClient) {}

  async listAfter(cursor: number, limit: number): Promise<VaultSecretCipherRow[]> {
    const rows = await this.db.secret.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, encryptedValue: true, iv: true },
    })
    return rows.map((row) => ({ id: row.id, payload: { encrypted: row.encryptedValue, iv: row.iv } }))
  }

  async updateBatch(items: VaultSecretCipherUpdate[]): Promise<number> {
    if (items.length === 0) return 0
    const results = await this.db.$transaction(items.map((item) => this.db.secret.updateMany({
      where: { id: item.id, encryptedValue: item.expected.encrypted, iv: item.expected.iv },
      data: { encryptedValue: item.replacement.encrypted, iv: item.replacement.iv },
    })))
    return results.reduce((total, result) => total + result.count, 0)
  }
}
