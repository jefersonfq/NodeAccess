import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { UserRepository } from './user.repository.js'

type Update = { name?: string; role?: 'ADMIN' | 'USER'; canManageHosts?: boolean; canViewLiveSessions?: boolean; sessionVersion?: { increment: number } }
function fixture() {
  const persisted = { id: 7, tenantId: 2, name: 'Synthetic', active: true, deletedAt: null as Date | null,
    sessionVersion: 4, role: 'ADMIN' as 'ADMIN' | 'USER', isPlatformAdmin: true,
    canManageHosts: true, canViewLiveSessions: true }
  const order: string[] = []
  let locked = false
  const tx = {
    $queryRaw: vi.fn((query: TemplateStringsArray, ...parameters: unknown[]) => {
      expect(query.join('?')).toContain('FOR UPDATE')
      expect(parameters).toEqual([7])
      order.push('lock'); locked = true
      return Promise.resolve([{ id: 7 }])
    }),
    user: {
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: number } }) => {
        expect(locked).toBe(true); expect(where.id).toBe(7); order.push('read')
        return Promise.resolve({ ...persisted })
      }),
      update: vi.fn(({ where, data }: { where: { id: number }; data: Update }) => {
        expect(locked).toBe(true); expect(where.id).toBe(7); order.push('write')
        if (data.name !== undefined) persisted.name = data.name
        if (data.role !== undefined) persisted.role = data.role
        if (data.canManageHosts !== undefined) persisted.canManageHosts = data.canManageHosts
        if (data.canViewLiveSessions !== undefined) persisted.canViewLiveSessions = data.canViewLiveSessions
        persisted.sessionVersion += data.sessionVersion?.increment ?? 0
        return Promise.resolve({ ...persisted })
      }),
    },
  }
  const db = {
    $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<typeof persisted>) => {
      order.push('begin')
      try { return await operation(tx) } finally { locked = false; order.push('end') }
    }),
    user: { findUnique: vi.fn(() => Promise.resolve<({ tenant: { active: boolean } } & typeof persisted) | null>({ ...persisted, tenant: { active: true } })) },
    tenant: { findUnique: vi.fn(() => Promise.resolve<{ active: boolean } | null>({ active: true })) },
    $executeRaw: vi.fn((query: TemplateStringsArray, ...parameters: unknown[]) => {
      expect(query.join('?')).toContain('AND session_version = ?')
      expect(query.join('?')).toContain('AND deleted_at IS NULL')
      const [id, tenantId, expectedVersion] = parameters
      if (id !== persisted.id || tenantId !== persisted.tenantId || expectedVersion !== persisted.sessionVersion || persisted.deletedAt) return Promise.resolve(0)
      persisted.sessionVersion += 1
      return Promise.resolve(1)
    }),
  }
  return { repo: new UserRepository(db as unknown as PrismaClient), db, tx, persisted, order }
}

describe('UserRepository persisted session contracts', () => {
  it.each<Update>([{ role: 'USER' }, { canManageHosts: false }, { canViewLiveSessions: false }])('revokes once for an effective privilege change %o, preserving a repeated no-op', async change => {
    const { repo, persisted, order } = fixture()
    const first = await repo.update(7, change)
    expect(first.sessionVersion).toBe(5)
    expect(persisted).toMatchObject(change)
    const repeated = await repo.update(7, change)
    expect(repeated.sessionVersion).toBe(5)
    expect(order).toEqual(['begin', 'lock', 'read', 'write', 'end', 'begin', 'lock', 'read', 'write', 'end'])
  })
  it('changes multiple privileges together with one version increment', async () => {
    const { repo, persisted } = fixture()
    await repo.update(7, { role: 'USER', canManageHosts: false, canViewLiveSessions: false })
    expect(persisted).toMatchObject({ role: 'USER', canManageHosts: false, canViewLiveSessions: false, sessionVersion: 5 })
  })
  it('preserves the current session for a name edit and explicit unchanged privileges', async () => {
    const { repo, persisted } = fixture()
    await repo.update(7, { name: 'Renamed', role: 'ADMIN', canManageHosts: true, canViewLiveSessions: true })
    expect(persisted).toMatchObject({ name: 'Renamed', sessionVersion: 4 })
  })
  it('does not write privileges if the transaction cannot obtain its row lock', async () => {
    const { repo, tx, persisted } = fixture()
    tx.$queryRaw.mockRejectedValueOnce(new Error('lock unavailable'))
    await expect(repo.update(7, { role: 'USER' })).rejects.toThrow('lock unavailable')
    expect(tx.user.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(persisted).toMatchObject({ role: 'ADMIN', sessionVersion: 4 })
  })
  it('returns no session identity for an absent user without resolving a target tenant', async () => {
    const { repo, db } = fixture()
    db.user.findUnique.mockResolvedValueOnce(null)
    expect(await repo.findCurrentSessionState(7, 9)).toBeNull()
    expect(db.tenant.findUnique).not.toHaveBeenCalled()
  })
  it('reads the home tenant state without a separate target lookup', async () => {
    const { repo, db } = fixture()
    expect(await repo.findCurrentSessionState(7, 2)).toMatchObject({ tenantId: 2, tenantActive: true, targetTenantActive: true, sessionVersion: 4, role: 'ADMIN' })
    expect(db.tenant.findUnique).not.toHaveBeenCalled()
  })
  it.each([{ active: true }, { active: false }, null])('distinguishes delegated target state %o from the home tenant', async target => {
    const { repo, db } = fixture()
    db.tenant.findUnique.mockResolvedValueOnce(target)
    expect(await repo.findCurrentSessionState(7, 9)).toMatchObject({ tenantId: 2, tenantActive: true, targetTenantActive: target?.active === true })
    expect(db.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { active: true } })
  })
  it('retains disabled and deleted identity state for revocation consumers', async () => {
    const { repo, db, persisted } = fixture()
    db.user.findUnique.mockResolvedValueOnce({ ...persisted, active: false, deletedAt: new Date(0), tenant: { active: false } })
    expect(await repo.findCurrentSessionState(7, 2)).toMatchObject({ active: false, deletedAt: new Date(0), tenantActive: false, targetTenantActive: false })
  })
  it('only advances the matching current principal and rejects replay or cross-tenant CAS', async () => {
    const { repo, persisted } = fixture()
    expect(await repo.incrementSessionVersion(7, 9, 4)).toBeNull()
    expect(await repo.incrementSessionVersion(8, 2, 4)).toBeNull()
    expect(await repo.incrementSessionVersion(7, 2, 4)).toBe(5)
    expect(await repo.incrementSessionVersion(7, 2, 4)).toBeNull()
    expect(persisted.sessionVersion).toBe(5)
    persisted.deletedAt = new Date(0)
    expect(await repo.incrementSessionVersion(7, 2, 5)).toBeNull()
    expect(persisted.sessionVersion).toBe(5)
  })
})
