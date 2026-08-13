import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '../../shared/errors.js'
import { ExternalIdentityAdminService } from './external-identity-admin.service.js'

function harness(overrides: Record<string, unknown> = {}) {
  const identities = {
    listForAdmin: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue({ userId: 20, changed: true }),
    listLinkRequests: vi.fn().mockResolvedValue([]),
    reviewLinkRequest: vi.fn().mockResolvedValue({ userId: 20, changed: true }),
    ...overrides,
  }
  const users = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  return {
    identities,
    users,
    service: new ExternalIdentityAdminService(identities as never, users as never),
  }
}

describe('ExternalIdentityAdminService', () => {
  it('maps storage booleans without exposing subject hashes', async () => {
    const row = {
      id: 31,
      userId: 20,
      userName: 'External User',
      userEmail: 'user@example.test',
      providerKey: 'oidc',
      issuer: 'https://idp.example.test',
      emailAtLink: 'user@example.test',
      active: 1,
      revokedAt: null,
      createdAt: new Date('2026-08-10T12:00:00.000Z'),
      updatedAt: new Date('2026-08-10T12:00:00.000Z'),
    }
    const { service } = harness({ listForAdmin: vi.fn().mockResolvedValue([row]) })

    await expect(service.list(7)).resolves.toEqual([{
      id: 31,
      user: { id: 20, name: 'External User', email: 'user@example.test' },
      providerKey: 'oidc',
      issuer: 'https://idp.example.test',
      emailAtLink: 'user@example.test',
      active: true,
      revokedAt: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }])
  })

  it('audits a revocation once and preserves idempotency', async () => {
    const { service, users } = harness()

    await expect(service.revoke(31, 7, 11)).resolves.toEqual({ changed: true })
    expect(users.logAdminEvent).toHaveBeenCalledWith({
      adminId: 11,
      action: 'REVOKE_EXTERNAL_IDENTITY',
      targetType: 'ExternalIdentity',
      targetId: 31,
      details: JSON.stringify({ userId: 20 }),
    })
  })

  it('does not duplicate audit events for an already revoked identity', async () => {
    const { service, users } = harness({ revoke: vi.fn().mockResolvedValue({ userId: 20, changed: false }) })

    await expect(service.revoke(31, 7, 11)).resolves.toEqual({ changed: false })
    expect(users.logAdminEvent).not.toHaveBeenCalled()
  })

  it('does not reveal whether an identity exists in another tenant', async () => {
    const { service } = harness({ revoke: vi.fn().mockResolvedValue(null) })

    await expect(service.revoke(31, 7, 11)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('lists pending link requests without sensitive subject data', async () => {
    const row = {
      id: 9, userId: 20, userName: 'Admin', userEmail: 'admin@example.test',
      providerKey: 'oidc', issuer: 'https://idp.example.test', emailAtRequest: 'admin@example.test',
      privileged: 1, status: 'PENDING', reviewedAt: null,
      createdAt: new Date('2026-08-13T10:00:00Z'), updatedAt: new Date('2026-08-13T10:00:00Z'),
    }
    const { service } = harness({ listLinkRequests: vi.fn().mockResolvedValue([row]) })
    const result = await service.listLinkRequests(7)
    expect(result[0]).toMatchObject({ id: 9, privileged: true, status: 'PENDING' })
    expect(result[0]).not.toHaveProperty('subject')
  })

  it('audits approval exactly once', async () => {
    const { service, users } = harness()
    await expect(service.reviewLinkRequest(9, 7, 11, true)).resolves.toEqual({ changed: true })
    expect(users.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'APPROVE_EXTERNAL_IDENTITY_LINK', targetId: 9,
    }))
  })
})
