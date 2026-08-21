import { describe, expect, it, vi } from 'vitest'
import { SessionsRepository } from './sessions.repository.js'

function fakeDatabase() {
  const sql: string[] = []
  const values: unknown[][] = []
  const db = {
    $queryRaw: vi.fn((query: { sql: string; values: unknown[] }) => {
      sql.push(query.sql)
      values.push(query.values)
      return Promise.resolve(sql.length % 2 === 1 ? [] : [{ total: 0 }])
    }),
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  }
  return { db, sql, values }
}

describe('SessionsRepository list query', () => {
  it('filters by tenant/user and orders remotely with a stable id tie-breaker', async () => {
    const { db, sql, values } = fakeDatabase()
    const repository = new SessionsRepository(db as never)

    await repository.findAll(7, { userId: 42, sortBy: 'user', sortDirection: 'asc', page: 2, limit: 20 })

    expect(sql[0]).toContain('s.user_id = ?')
    expect(sql[0]).toContain('ORDER BY u.name ASC, s.id DESC')
    expect(values[0]).toEqual(expect.arrayContaining([7, 42, 20]))
  })

  it('keeps the newest session ordering as the default', async () => {
    const { db, sql } = fakeDatabase()
    const repository = new SessionsRepository(db as never)
    await repository.findAll(7, {})
    expect(sql[0]).toContain('ORDER BY s.started_at DESC, s.id DESC')
  })
})
