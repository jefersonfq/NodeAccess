import { describe, expect, it, vi } from 'vitest'
import { ScimError, ScimService } from './scim.service.js'

function harness(db: Record<string, unknown> = {}) {
  const entitlements = { requireIntegrationProvider: vi.fn().mockResolvedValue(undefined) }
  return { entitlements, service: new ScimService({ scimAuditEvent: { create: vi.fn().mockResolvedValue({}) }, ...db } as never, entitlements as never) }
}

describe('ScimService security contract', () => {
  it('fails closed when SCIM is not licensed', async () => {
    const { service, entitlements } = harness({ scimConfig: { findUnique: vi.fn() } })
    entitlements.requireIntegrationProvider.mockRejectedValue(new Error('not licensed'))
    await expect(service.getAdminConfig(7)).rejects.toThrow('not licensed')
    expect(entitlements.requireIntegrationProvider).toHaveBeenCalledWith(7, 'scim', expect.any(String))
  })

  it('rejects unsupported filters instead of broadening the query', async () => {
    const { service } = harness({ scimUser: { findMany: vi.fn() } })
    await expect(service.listUsers(7, 'displayName co "admin"')).rejects.toMatchObject({ status: 400, scimType: 'invalidFilter' })
  })

  it('requires an email-shaped userName', async () => {
    const { service } = harness({})
    await expect(service.createUser(7, { userName: 'not-an-email', password: 'ignored' })).rejects.toBeInstanceOf(ScimError)
  })

  it('increments session version when SCIM deactivates a user', async () => {
    const update = vi.fn().mockResolvedValue({})
    const db = {
      scimUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', tenantId: 7, userId: 20, user: { active: true } }) },
      user: { update },
    }
    const { service } = harness(db)
    await service.patchUser(7, 'u1', [{ op: 'Replace', path: 'active', value: false }])
    expect(update).toHaveBeenCalledWith({ where: { id: 20 }, data: { active: false, licenseConsumed: false, sessionVersion: { increment: 1 } } })
  })
})
