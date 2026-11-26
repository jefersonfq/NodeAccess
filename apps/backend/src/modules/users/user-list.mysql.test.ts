import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UserRepository } from './user.repository.js'

describe.skipIf(process.env.RUN_VAULT_MYSQL !== 'true')('User list disposable SQL manager filtering', () => {
  let db: PrismaClient
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '')
    if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/na0178_') || !/^[a-f0-9]{24}$/.test(process.env.VAULT_DISPOSABLE_NONCE ?? '')) throw new Error('Disposable database required')
    db = new PrismaClient()
    await db.$connect()
  })
  afterAll(async () => { await db?.$disconnect() })
  it('filters before pagination/count, joins tenant identity, and excludes disabled/inactive/deleted nominations', async () => {
    const suffix = randomUUID()
    const tenant = await db.tenant.create({ data: { name: 'List fixture', slug: `users-${suffix}` } })
    const other = await db.tenant.create({ data: { name: 'Other', slug: `other-${suffix}` } })
    const create = (name: string, options = {}) => db.user.create({ data: { name, email: `${name}-${suffix}@example.test`, tenantId: tenant.id, ...options } })
    const manager = await create('Manager')
    const manager2 = await create('ManagerTwo')
    const admin = await create('Admin', { role: 'ADMIN' })
    const disabled = await create('Disabled')
    const inactive = await create('Inactive', { active: false })
    const deleted = await create('Deleted', { deletedAt: new Date() })
    const foreign = await create('Foreign', { tenantId: other.id })
    for (const user of [manager, manager2, inactive, deleted, foreign]) {
      await db.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${tenant.id},${user.id},TRUE)`
    }
    await db.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${tenant.id},${disabled.id},FALSE)`
    // A nomination for a local user under a foreign tenant must not mark the local user.
    await db.$executeRaw`INSERT INTO vault_managers(tenant_id,user_id,enabled) VALUES(${other.id},${admin.id},TRUE)`
    const repo = new UserRepository(db)
    const first = await repo.findAll(tenant.id, { vaultManager: true, limit: 1, page: 1 })
    const second = await repo.findAll(tenant.id, { vaultManager: true, limit: 1, page: 2 })
    expect(first.total).toBe(2); expect(second.total).toBe(2)
    expect(new Set([...first.users, ...second.users].map(u => u.id))).toEqual(new Set([manager.id, manager2.id]))
    expect(first.vaultManagerIds.sort((a, b) => a - b)).toEqual([manager.id, manager2.id])
    expect((await repo.findAll(tenant.id, { vaultManager: true, search: 'ManagerTwo' })).users.map(u => u.id)).toEqual([manager2.id])
    expect((await repo.findAll(tenant.id, { vaultManager: true, role: 'ADMIN' })).total).toBe(0)
    expect((await repo.findAll(tenant.id, { vaultManager: true, active: false, includeDeleted: true })).total).toBe(0)
    const nonmanagers = await repo.findAll(tenant.id, { vaultManager: false, includeDeleted: true })
    expect(new Set(nonmanagers.users.map(u => u.id))).toEqual(new Set([admin.id, disabled.id, inactive.id, deleted.id]))
    expect(nonmanagers.total).toBe(4)
    const all = await repo.findAll(tenant.id, {})
    expect(all.total).toBe(5)
    expect(all.users.every(u => u.tenantId === tenant.id)).toBe(true)
    const noManagers = await repo.findAll(other.id, { vaultManager: true })
    expect(noManagers.users).toEqual([]); expect(noManagers.total).toBe(0)
    expect((await repo.findAll(other.id, { vaultManager: false })).users.map(u => u.id)).toEqual([foreign.id])
  })
})
