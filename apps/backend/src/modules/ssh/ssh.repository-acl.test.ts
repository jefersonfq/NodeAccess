import { describe, expect, it, vi } from 'vitest'
import { SshRepository } from './ssh.repository.js'
import type { InventoryAclRepository } from '../inventory/inventory-acl.repository.js'

function makeRepository(rows: Awaited<ReturnType<InventoryAclRepository['findEffectiveHostPermissions']>>) {
  const inventoryAclRepo = {
    findEffectiveHostPermissions: vi.fn().mockResolvedValue(rows),
  }
  const db = {
    host: { count: vi.fn() },
  }
  return {
    repo: new SshRepository(db as never, inventoryAclRepo as unknown as InventoryAclRepository),
    inventoryAclRepo,
  }
}

describe('SshRepository ACL facade', () => {
  it('allows view without allowing connect', async () => {
    const { repo, inventoryAclRepo } = makeRepository([
      { hostId: 10, canView: true, canConnect: false, canEdit: false, canAdmin: false },
    ])

    await expect(repo.hasEffectiveHostPermission(10, 1, 20, 'view', 'USER')).resolves.toBe(true)
    await expect(repo.hasEffectiveHostPermission(10, 1, 20, 'connect', 'USER')).resolves.toBe(false)
    expect(inventoryAclRepo.findEffectiveHostPermissions).toHaveBeenCalledWith([10], 1, 20)
  })

  it('returns false permissions when ACL rows are absent for a user', async () => {
    const { repo } = makeRepository([])

    await expect(repo.getEffectiveHostPermissionSet(10, 1, 20, 'USER')).resolves.toEqual({
      view: false,
      connect: false,
      edit: false,
      admin: false,
    })
    await expect(repo.getEffectiveHostPermissionSets([10], 1, 20, 'USER')).resolves.toEqual(new Map())
  })

  it('uses inherited effective permissions returned by inventory ACL repository', async () => {
    const { repo } = makeRepository([
      { hostId: 10, canView: true, canConnect: true, canEdit: false, canAdmin: false },
    ])

    await expect(repo.hasEffectiveHostPermission(10, 1, 20, 'connect', 'USER')).resolves.toBe(true)
  })

  it('filters host id batches when a group gains or loses access', async () => {
    const { repo, inventoryAclRepo } = makeRepository([
      { hostId: 10, canView: true, canConnect: true, canEdit: false, canAdmin: false },
      { hostId: 11, canView: true, canConnect: false, canEdit: false, canAdmin: false },
    ])

    await expect(repo.findHostIdsWithEffectivePermission([10, 11, 10], 1, 20, 'connect', 'USER'))
      .resolves.toEqual(new Set([10]))
    expect(inventoryAclRepo.findEffectiveHostPermissions).toHaveBeenCalledWith([10, 11], 1, 20)
  })

  it('keeps admin operational access without ACL rows', async () => {
    const { repo, inventoryAclRepo } = makeRepository([])

    await expect(repo.hasEffectiveHostPermission(10, 1, 1, 'admin', 'ADMIN')).resolves.toBe(true)
    await expect(repo.findHostIdsWithEffectivePermission([10, 11], 1, 1, 'connect', 'ADMIN'))
      .resolves.toEqual(new Set([10, 11]))
    expect(inventoryAclRepo.findEffectiveHostPermissions).not.toHaveBeenCalled()
  })
})
