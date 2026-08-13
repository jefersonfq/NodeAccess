import { describe, expect, it, vi } from 'vitest'
import { normalizeGroup, OidcGroupMappingRepository } from './oidc-group-mapping.repository.js'

describe('OidcGroupMappingRepository', () => {
  it('normalizes provider groups consistently', () => {
    expect(normalizeGroup('  NodeAccess-OPS  ')).toBe('nodeaccess-ops')
  })

  it('preserves an existing manual membership while synchronizing OIDC groups', async () => {
    const executeRaw = vi.fn().mockResolvedValue(0)
    const tx = {
      $executeRaw: executeRaw,
      userGroup: { findUnique: vi.fn().mockResolvedValue({ userId: 7, groupId: 9 }) },
    }
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 3, groupId: 9 }]),
      $transaction: vi.fn(async (callback) => callback(tx)),
    }
    await new OidcGroupMappingRepository(db as never).sync({ tenantId: 1, userId: 7, identityId: 11, externalGroups: ['OPS'] })
    expect(tx.userGroup.findUnique).toHaveBeenCalled()
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it('removes only OIDC memberships owned by the current external identity when no claim matches', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1)
    const tx = { $executeRaw: executeRaw, userGroup: { findUnique: vi.fn() } }
    const db = { $transaction: vi.fn(async (callback) => callback(tx)) }
    await new OidcGroupMappingRepository(db as never).sync({ tenantId: 1, userId: 7, identityId: 11, externalGroups: [] })
    const call = executeRaw.mock.calls[0]!
    expect(call[0].join(' ')).toContain("source = 'OIDC'")
    expect(call.slice(1)).toEqual([7, 11])
  })
})
