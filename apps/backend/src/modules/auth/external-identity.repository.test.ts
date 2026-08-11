import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})

import { ExternalIdentityRepository } from './external-identity.repository.js'

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const activeUser = { id: 20, tenantId: 7, email: 'user@example.test', deletedAt: null }

describe('ExternalIdentityRepository', () => {
  it('looks up an identity with tenant-scoped, case-sensitive issuer and subject hashes', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ userId: 20 }])
    const findFirst = vi.fn().mockResolvedValue(activeUser)
    const repository = new ExternalIdentityRepository({ $queryRaw: queryRaw, user: { findFirst } } as never)

    await expect(repository.findUser(7, 'https://IDP.example.test', 'Subject-A')).resolves.toBe(activeUser)
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      7,
      hash('https://IDP.example.test'),
      hash('Subject-A'),
    ])
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 20, tenantId: 7, deletedAt: null } })
    expect(hash('Subject-A')).not.toBe(hash('subject-a'))
  })

  it('does not return a soft-deleted linked user', async () => {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ userId: 20 }]),
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    }
    const repository = new ExternalIdentityRepository(db as never)
    await expect(repository.findUser(7, 'https://idp.example.test', 'subject')).resolves.toBeNull()
  })

  it('keeps a revoked subject distinguishable from an identity that was never linked', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ found: 1 }])
    const repository = new ExternalIdentityRepository({ $queryRaw: queryRaw } as never)

    await expect(repository.isRevoked(7, 'https://idp.example.test', 'subject')).resolves.toBe(true)
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      7,
      hash('https://idp.example.test'),
      hash('subject'),
    ])
  })

  it('revokes the identity and all renewable sessions in the same transaction', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ userId: 20, active: 1 }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    }
    const db = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) }
    const repository = new ExternalIdentityRepository(db as never)

    await expect(repository.revoke(7, 31)).resolves.toEqual({ userId: 20, changed: true })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    expect(tx.$queryRaw.mock.calls[0]?.slice(1)).toEqual([31, 7])
  })

  it('treats repeated revocation as idempotent without incrementing sessions again', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ userId: 20, active: 0 }]),
      $executeRaw: vi.fn(),
    }
    const db = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) }
    const repository = new ExternalIdentityRepository(db as never)

    await expect(repository.revoke(7, 31)).resolves.toEqual({ userId: 20, changed: false })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it('checks the tenant again inside the linking transaction', async () => {
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue(activeUser) },
      externalIdentity: { create: vi.fn().mockResolvedValue({}) },
    }
    const db = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) }
    const repository = new ExternalIdentityRepository(db as never)

    await repository.link({
      tenantId: 7, userId: 20, providerKey: 'oidc', issuer: 'https://idp.example.test',
      subject: 'subject-1', email: 'user@example.test',
    })
    expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { id: 20, tenantId: 7, deletedAt: null } })
    expect(tx.externalIdentity.create).toHaveBeenCalledWith({ data: {
      tenantId: 7,
      userId: 20,
      providerKey: 'oidc',
      issuer: 'https://idp.example.test',
      issuerHash: hash('https://idp.example.test'),
      subject: 'subject-1',
      subjectHash: hash('subject-1'),
      emailAtLink: 'user@example.test',
    } })
  })

  it('serializes JIT provisioning and rejects a tenant at its license limit', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(2),
        create: vi.fn(),
      },
      license: { findUnique: vi.fn().mockResolvedValue({ maxUsers: 2 }) },
      externalIdentity: { create: vi.fn() },
    }
    const db = { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) }
    const repository = new ExternalIdentityRepository(db as never)

    await expect(repository.createJit({
      tenantId: 7, providerKey: 'oidc', issuer: 'https://idp.example.test', subject: 'subject-1',
      email: 'user@example.test', name: 'External User',
    })).rejects.toThrow('Limite de usuários do tenant atingido')
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.user.create).not.toHaveBeenCalled()
    expect(tx.externalIdentity.create).not.toHaveBeenCalled()
  })
})
