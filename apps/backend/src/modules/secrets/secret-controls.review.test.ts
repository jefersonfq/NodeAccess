import { describe, expect, it, vi } from 'vitest'
vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
import { encrypt } from '../../shared/crypto.js'
import { SecretService } from './secret.service.js'

function fixture() {
  const payload = encrypt('disposable-value-one')
  const row = { id: 9, tenantId: 7, alias: 'review', description: null, scope: 'GROUP', ownerUserId: null,
    groupId: 3, createdByUserId: 11, encryptedValue: payload.encrypted, iv: payload.iv, revokedAt: null as Date | null }
  const repo = { findUserGroupIds: vi.fn().mockResolvedValue([3]), findAccessibleById: vi.fn().mockResolvedValue(row) }
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const service = new SecretService(repo as never, logs as never, { requireFeature: vi.fn().mockResolvedValue(undefined) } as never)
  const resolve = () => service.resolveValueById(9, 20, 7, 'user', { resourceType: 'ReviewFixture' })
  return { row, repo, logs, resolve }
}

describe('Cofre diagnostic controls: service boundary, repository authorization stubbed', () => {
  it('passes tenant, user and current memberships on every resolution and denies removed access', async () => {
    const { repo, logs, resolve } = fixture()
    await expect(resolve()).resolves.toBe('disposable-value-one')
    expect(repo.findAccessibleById).toHaveBeenLastCalledWith({ id: 9, tenantId: 7, userId: 20, groupIds: [3], isAdmin: false })
    repo.findUserGroupIds.mockResolvedValue([])
    repo.findAccessibleById.mockResolvedValue(null)
    await expect(resolve()).rejects.toMatchObject({ statusCode: 403 })
    expect(repo.findAccessibleById).toHaveBeenLastCalledWith({ id: 9, tenantId: 7, userId: 20, groupIds: [], isAdmin: false })
    expect(logs.logAdminEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects a revoked value before publishing a use event', async () => {
    const { row, logs, resolve } = fixture()
    row.revokedAt = new Date()
    await expect(resolve()).rejects.toMatchObject({ code: 'SECRET_REVOKED' })
    expect(logs.logAdminEvent).not.toHaveBeenCalled()
  })

  it('reads the rotated value on the next resolution without retaining the previous value', async () => {
    const { row, resolve } = fixture()
    await expect(resolve()).resolves.toBe('disposable-value-one')
    const payload = encrypt('disposable-value-two')
    row.encryptedValue = payload.encrypted
    row.iv = payload.iv
    await expect(resolve()).resolves.toBe('disposable-value-two')
  })

  it('documents best-effort audit without putting plaintext or ciphertext into the event', async () => {
    const { row, logs, resolve } = fixture()
    logs.logAdminEvent.mockRejectedValue(new Error('audit unavailable'))
    await expect(resolve()).resolves.toBe('disposable-value-one')
    const event = JSON.stringify(logs.logAdminEvent.mock.calls)
    expect(event).not.toContain('disposable-value-one')
    expect(event).not.toContain(row.encryptedValue)
    expect(event).not.toContain(row.iv)
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'USE_SECRET', targetId: 9 }))
  })
})
