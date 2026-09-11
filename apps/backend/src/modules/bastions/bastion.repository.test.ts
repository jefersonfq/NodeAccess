import { describe, expect, it } from 'vitest'
import { normalizeMysqlInsertId } from './bastion.repository.js'

describe('normalizeMysqlInsertId', () => {
  it('converts the bigint returned by MySQL LAST_INSERT_ID for Prisma', () => {
    expect(normalizeMysqlInsertId(42n)).toBe(42)
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an unsafe insert id: %s', (id) => {
    expect(() => normalizeMysqlInsertId(id)).toThrow('Invalid bastion insert id')
  })
})
