import { describe, expect, it, vi } from 'vitest'
import { PrismaVaultSecretRewrapRepository } from './vault-secret-rewrap.repository.js'

describe('PrismaVaultSecretRewrapRepository', () => {
  it('paginates without loading secret metadata or plaintext', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 8, encryptedValue: 'cipher', iv: 'iv' }])
    const repository = new PrismaVaultSecretRewrapRepository({ secret: { findMany } } as never)

    await expect(repository.listAfter(7, 100)).resolves.toEqual([
      { id: 8, payload: { encrypted: 'cipher', iv: 'iv' } },
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { gt: 7 } }, orderBy: { id: 'asc' }, take: 100,
      select: { id: true, encryptedValue: true, iv: true },
    })
  })

  it('uses ciphertext and IV as optimistic update conditions inside a transaction', async () => {
    const operation = Promise.resolve({ count: 1 })
    const updateMany = vi.fn().mockReturnValue(operation)
    const transaction = vi.fn().mockResolvedValue([{ count: 1 }])
    const repository = new PrismaVaultSecretRewrapRepository({
      secret: { updateMany }, $transaction: transaction,
    } as never)

    await expect(repository.updateBatch([{
      id: 8,
      expected: { encrypted: 'old', iv: 'old-iv' },
      replacement: { encrypted: 'new', iv: 'new-iv' },
    }])).resolves.toBe(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 8, encryptedValue: 'old', iv: 'old-iv' },
      data: { encryptedValue: 'new', iv: 'new-iv' },
    })
    expect(transaction).toHaveBeenCalledWith([operation])
  })
})
