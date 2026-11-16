import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PemKeyPublicSchema } from '@nodeaccess/shared'
import { PemKeyRepository } from './pem-key.repository.js'
import { PemKeyService } from './pem-key.service.js'
import type { LogRepository } from '../logs/log.repository.js'

const row = {
  id: 3, name: 'gateway', createdById: 41, createdAt: new Date('2026-11-16T12:00:00Z'),
  encryptedKey: 'synthetic-ciphertext', iv: 'synthetic-iv', encryptedPassphrase: 'synthetic-passphrase', passphraseIv: 'synthetic-passphrase-iv',
  createdBy: { name: 'operator', email: 'synthetic@example.invalid', passwordHash: 'synthetic-hash' },
}

describe('PEM list owner metadata', () => {
  it.each([false, true])('preserves user/tenant filters and projects only name for admin=%s', async isAdmin => {
    const findMany = vi.fn(() => Promise.resolve([row]))
    const repository = new PemKeyRepository({ pemKey: { findMany } } as unknown as PrismaClient)
    const service = new PemKeyService(repository, {} as LogRepository)
    const result = await service.list(41, 7, isAdmin)
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: isAdmin ? { createdBy: { tenantId: 7 } } : { createdById: 41 },
      orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } } },
    })
    expect(result).toEqual([{ id: 3, name: 'gateway', createdById: 41, createdByName: 'operator', createdAt: row.createdAt, hasPassphrase: true }])
    expect(PemKeyPublicSchema.array().parse(result)).toEqual(result)
    const serialized = JSON.stringify(result)
    for (const material of [row.encryptedKey, row.iv, row.encryptedPassphrase, row.passphraseIv, row.createdBy.email, row.createdBy.passwordHash]) expect(serialized).not.toContain(material)
    expect(result[0]).not.toHaveProperty('createdBy')
  })
  it('keeps legacy public payloads valid and strips unrelated user or secret fields', () => {
    const legacy = { id: 3, name: 'gateway', createdById: 41, createdAt: row.createdAt, hasPassphrase: false }
    expect(PemKeyPublicSchema.parse(legacy)).toEqual(legacy)
    expect(PemKeyPublicSchema.parse({ ...row, hasPassphrase: true, createdByName: 'operator' })).toEqual({ ...legacy, hasPassphrase: true, createdByName: 'operator' })
  })
})
