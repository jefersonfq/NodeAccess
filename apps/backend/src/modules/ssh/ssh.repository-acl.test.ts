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


describe('terminal file access revalidation', () => {
  function fixture() {
    const db = { user: { findFirst: vi.fn().mockResolvedValue({ role: 'USER', sessionVersion: 3 }) }, host: { findFirst: vi.fn().mockResolvedValue({ id: 10 }) } }
    const acl = { findEffectiveHostPermissions: vi.fn().mockResolvedValue([{ hostId: 10, canConnect: true }]) }
    return { db, acl, repo: new SshRepository(db as never, acl as never) }
  }
  it('uses the current role and checks an active user and tenant', async () => {
    const f = fixture()
    expect(await f.repo.canUseSessionFiles(10, 1, 20, 3)).toBe(true)
    expect(f.db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 20, tenantId: 1, active: true, tenant: { active: true } } }))
    expect(f.acl.findEffectiveHostPermissions).toHaveBeenCalled()
  })
  it('rejects changed session version before consulting host permissions', async () => {
    const f = fixture()
    expect(await f.repo.canUseSessionFiles(10, 1, 20, 2)).toBe(false)
    expect(f.acl.findEffectiveHostPermissions).not.toHaveBeenCalled()
  })
  it('rejects deleted hosts even for a current administrator', async () => {
    const f = fixture(); f.db.user.findFirst.mockResolvedValue({ role: 'ADMIN', sessionVersion: 3 }); f.db.host.findFirst.mockResolvedValue(null)
    expect(await f.repo.canUseSessionFiles(10, 1, 20, 3)).toBe(false)
  })
})
