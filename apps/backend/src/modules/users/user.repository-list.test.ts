import type { Prisma, PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { UserRepository } from './user.repository.js'

function fixture(managerIds: number[] = [7, 9]) {
  const rows = [{ id: 9 }]
  const tx = {
    $queryRaw: vi.fn((_sql: TemplateStringsArray, ..._parameters: unknown[]) => Promise.resolve(managerIds.map(id => ({ id })))),
    user: {
      findMany: vi.fn((_args: Prisma.UserFindManyArgs) => Promise.resolve(rows)),
      count: vi.fn((_args: Prisma.UserCountArgs) => Promise.resolve(2)),
    },
  }
  const db = { $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)) }
  return { repo: new UserRepository(db as unknown as PrismaClient), db, tx, rows }
}

describe('UserRepository list database boundary', () => {
  it('binds the tenant and batches managers once before using the same predicate for page and total', async () => {
    const { repo, db, tx, rows } = fixture()
    const result = await repo.findAll(22, { vaultManager: true, search: 'needle', role: 'USER', active: true, page: 3, limit: 1 })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    const [sql, ...parameters] = tx.$queryRaw.mock.calls[0]!
    expect(parameters).toEqual([22])
    const statement = sql.join('?')
    expect(statement).toContain('u.tenant_id = m.tenant_id')
    expect(statement).toContain('m.tenant_id = ?')
    expect(statement).toContain('m.enabled = TRUE AND u.active = TRUE AND u.deleted_at IS NULL')
    const page = tx.user.findMany.mock.calls[0]![0]
    const count = tx.user.count.mock.calls[0]![0]
    expect(page).toEqual({ where: { tenantId: 22, role: 'USER', active: true, deletedAt: null,
      OR: [{ name: { contains: 'needle' } }, { email: { contains: 'needle' } }], id: { in: [7, 9] } },
      skip: 2, take: 1, orderBy: { createdAt: 'desc' } })
    expect(count.where).toBe(page.where)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.user.findMany.mock.invocationCallOrder[0]!)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.user.count.mock.invocationCallOrder[0]!)
    expect(result).toEqual({ users: rows, total: 2, vaultManagerIds: [7, 9] })
  })
  it.each([
    { filter: true, ids: [], predicate: { in: [] } },
    { filter: false, ids: [7], predicate: { notIn: [7] } },
    { filter: false, ids: [], predicate: { notIn: [] } },
    { filter: undefined, ids: [7], predicate: undefined },
  ])('keeps the database predicate for filter $filter and IDs $ids', async ({ filter, ids, predicate }) => {
    const { repo, tx } = fixture(ids)
    await repo.findAll(33, { includeDeleted: true, ...(filter === undefined ? {} : { vaultManager: filter }) })
    const page = tx.user.findMany.mock.calls[0]![0]
    expect(page).toMatchObject({ where: { tenantId: 33 }, skip: 0, take: 20 })
    expect(page.where?.id).toEqual(predicate)
    expect(page.where).not.toHaveProperty('deletedAt')
    expect(tx.user.count.mock.calls[0]![0].where).toBe(page.where)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
  })
  it('propagates manager lookup failure without fetching a page or reporting false indicators', async () => {
    const { repo, tx } = fixture()
    const failure = new Error('database unavailable')
    tx.$queryRaw.mockRejectedValueOnce(failure)
    await expect(repo.findAll(22, {})).rejects.toBe(failure)
    expect(tx.user.findMany).not.toHaveBeenCalled()
    expect(tx.user.count).not.toHaveBeenCalled()
  })
})
