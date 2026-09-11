import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
import { SecretService } from './secret.service.js'

const row = {
  id: 9, tenantId: 7, alias: 'ssh-prod', description: null, scope: 'GROUP' as const,
  ownerUserId: null, groupId: 3, createdByUserId: 11, createdByUsername: 'owner',
  source: 'MANUAL' as const, encryptedValue: 'ciphertext', iv: '0'.repeat(32),
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  rotatedAt: null, revokedAt: null,
}

function harness() {
  const repo = {
    findUserGroupIds: vi.fn().mockResolvedValue([3]),
    countConsumers: vi.fn().mockResolvedValue(new Map([[9, 2]])),
    findAccessible: vi.fn().mockResolvedValue([row]),
    findAccessibleById: vi.fn().mockResolvedValue(row),
    findById: vi.fn().mockResolvedValue(row),
    findConsumers: vi.fn().mockResolvedValue({ hostCount: 0, hosts: [], snippetCount: 0, snippets: [] }),
    updateMetadata: vi.fn().mockResolvedValue(row),
    rotate: vi.fn().mockResolvedValue({ ...row, rotatedAt: new Date() }),
    revoke: vi.fn().mockResolvedValue({ ...row, revokedAt: new Date() }),
    delete: vi.fn().mockResolvedValue(undefined),
    groupExistsInTenant: vi.fn().mockResolvedValue(true),
  }
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const license = { requireFeature: vi.fn().mockResolvedValue(undefined) }
  return { repo, logs, service: new SecretService(repo as never, logs as never, license as never) }
}

describe('SecretService security boundaries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists metadata without leaking encrypted material', async () => {
    const { service } = harness()
    const [result] = await service.list(20, 7, 'user')
    expect(result).toMatchObject({ id: 9, alias: 'ssh-prod', scope: 'GROUP' })
    expect(JSON.stringify(result)).not.toContain('ciphertext')
    expect(result).not.toHaveProperty('encryptedValue')
    expect(result).not.toHaveProperty('iv')
  })

  it('allows group members to use but not manage a secret they did not create', async () => {
    const { service, repo } = harness()
    await expect(service.assertAccessibleById(9, 20, 7, 'user')).resolves.toMatchObject({ id: 9 })
    await expect(service.update(9, 20, 7, 'user', { description: 'changed' })).rejects.toMatchObject({ statusCode: 403 })
    expect(repo.updateMetadata).not.toHaveBeenCalled()
  })

  it('allows the group secret creator to manage it', async () => {
    const { service, repo } = harness()
    await service.update(9, 11, 7, 'user', { description: 'changed' })
    expect(repo.updateMetadata).toHaveBeenCalled()
  })

  it('blocks deletion while a host still consumes the secret', async () => {
    const { service, repo } = harness()
    repo.findConsumers.mockResolvedValue({ hostCount: 1, hosts: [{ id: 2, name: 'prod', sshUser: 'ops' }], snippetCount: 0, snippets: [] })
    await expect(service.delete(9, 11, 7, 'user')).rejects.toMatchObject({ statusCode: 409 })
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('blocks deletion while a snippet references the alias', async () => {
    const { service, repo } = harness()
    repo.findConsumers.mockResolvedValue({ hostCount: 0, hosts: [], snippetCount: 1, snippets: [{ id: 4, name: 'Deploy' }] })
    await expect(service.delete(9, 11, 7, 'user')).rejects.toMatchObject({ statusCode: 409 })
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('deletes an unreferenced secret and records a value-free audit event', async () => {
    const { service, repo, logs } = harness()
    await service.delete(9, 11, 7, 'user')
    expect(repo.delete).toHaveBeenCalledWith(7, 9)
    expect(JSON.stringify(logs.logAdminEvent.mock.calls)).not.toContain('ciphertext')
  })

  it('does not disclose consumers to a group member without management rights', async () => {
    const { service, repo } = harness()
    await expect(service.consumers(9, 20, 7, 'user')).rejects.toMatchObject({ statusCode: 403 })
    expect(repo.findConsumers).not.toHaveBeenCalled()
  })
})

describe('secret usage counts', () => {
  it('includes aggregate counts for managers', async () => {
    const { service, repo } = harness()
    expect((await service.list(20, 7, 'admin'))[0].usageCount).toBe(2)
    expect(repo.countConsumers).toHaveBeenCalledWith(7, [row])
  })
  it('does not disclose usage counts to non-managing group members', async () => {
    const { service, repo } = harness()
    expect((await service.list(20, 7, 'user'))[0]).not.toHaveProperty('usageCount')
    expect(repo.countConsumers).not.toHaveBeenCalled()
  })
})
