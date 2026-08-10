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
    const findUnique = vi.fn().mockResolvedValue({ user: activeUser })
    const repository = new ExternalIdentityRepository({ externalIdentity: { findUnique } } as never)

    await expect(repository.findUser(7, 'https://IDP.example.test', 'Subject-A')).resolves.toBe(activeUser)
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_issuerHash_subjectHash: {
        tenantId: 7,
        issuerHash: hash('https://IDP.example.test'),
        subjectHash: hash('Subject-A'),
      } },
      include: { user: true },
    })
    expect(hash('Subject-A')).not.toBe(hash('subject-a'))
  })

  it('does not return a soft-deleted linked user', async () => {
    const db = { externalIdentity: { findUnique: vi.fn().mockResolvedValue({ user: { ...activeUser, deletedAt: new Date() } }) } }
    const repository = new ExternalIdentityRepository(db as never)
    await expect(repository.findUser(7, 'https://idp.example.test', 'subject')).resolves.toBeNull()
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
