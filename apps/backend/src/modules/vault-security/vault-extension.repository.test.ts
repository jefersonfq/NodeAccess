import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Prisma, PrismaClient } from '@prisma/client'
import { SqlExtensionLocator, SqlVaultExtension } from './vault-extension.repository.js'

// Statement-recording double. Behaviour against real MySQL lives in vault-extension.mysql.test.ts;
// this pins identity scoping and row mapping, which the coverage run cannot reach without a database.
interface Call { sql: string; values: unknown[] }
function database(rows: unknown[][] = [], changed: number[] = []) {
  const calls: Call[] = []
  const record = (strings: TemplateStringsArray, values: unknown[]): void => { calls.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }) }
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => { record(strings, values); return Promise.resolve(rows.shift() ?? []) },
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => { record(strings, values); return Promise.resolve(changed.shift() ?? 0) },
  }
  return { db, calls }
}
const identity = { tenantId: 7, userId: 11, sessionVersion: 3 }
const now = () => 1_000_000
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const repo = (db: unknown) => new SqlVaultExtension(db as Prisma.TransactionClient, identity, now)

describe('SqlVaultExtension', () => {
  it('requires an enabled grant made and approved by two other people', async () => {
    for (const [row, expected] of [
      [{ enabled: 1, grantedBy: 2, approvedBy: 3 }, true],
      [{ enabled: true, grantedBy: 2, approvedBy: 3 }, true],
      [{ enabled: 1n, grantedBy: 2, approvedBy: 3 }, true],
      [{ enabled: 0, grantedBy: 2, approvedBy: 3 }, false],
      [{ enabled: 1, grantedBy: 2, approvedBy: 2 }, false],
      [{ enabled: 1, grantedBy: 11, approvedBy: 3 }, false],
      [{ enabled: 1, grantedBy: 2, approvedBy: 11 }, false],
    ] as const) {
      const { db, calls } = database([[row]])
      expect(await repo(db).entitled()).toBe(expected)
      expect(calls[0]?.sql).toContain("action='extension' FOR SHARE")
      expect(calls[0]?.values).toEqual([7, 11])
    }
    expect(await repo(database([[]]).db).entitled()).toBe(false)
  })
  it('maps device rows and scopes every device statement to the identity', async () => {
    const created = new Date(5), used = new Date(9)
    const { db, calls } = database([
      [{ jkt: 'j', extensionId: 'e', state: 'ACTIVE', createdAt: created, lastUsedAt: used }],
      [],
      [{ jkt: 'k', extensionId: 'e', state: 'REVOKED', createdAt: created, lastUsedAt: null }, { jkt: 'l', extensionId: 'e', state: 'odd', createdAt: created, lastUsedAt: null }],
    ], [1, 1, 0, 0])
    const r = repo(db)
    expect(await r.device('j')).toEqual({ jkt: 'j', extensionId: 'e', state: 'ACTIVE', createdAt: 5, lastUsedAt: 9 })
    expect(await r.device('missing')).toBeNull()
    expect(await r.devices()).toEqual([
      { jkt: 'k', extensionId: 'e', state: 'REVOKED', createdAt: 5, lastUsedAt: null },
      { jkt: 'l', extensionId: 'e', state: 'REVOKED', createdAt: 5, lastUsedAt: null },
    ])
    await r.activateDevice('j', 'e')
    await r.touchDevice('j')
    expect(await r.revokeDevice('j')).toBe(false)
    expect(calls.map(c => c.sql.split(' ')[0])).toEqual(['SELECT', 'SELECT', 'SELECT', 'INSERT', 'UPDATE', 'UPDATE', 'DELETE'])
    for (const call of calls) {
      const at = call.values.indexOf(7)
      expect(call.values[at + 1]).toBe(11)
      expect(call.sql).toMatch(/tenant_id(=\?)?,? ?(AND )?user_id/)
    }
    expect(calls[3]?.sql).toContain("ON DUPLICATE KEY UPDATE extension_id=VALUES(extension_id),state='ACTIVE',revoked_at=NULL")
    expect(calls[5]?.sql).toContain("AND state='ACTIVE'")
    expect(calls[6]?.sql).toContain('DELETE FROM vault_extension_tokens')
  })
  it('reports a revocation only when an active device changed', async () => {
    expect(await repo(database([], [1, 0]).db).revokeDevice('j')).toBe(true)
  })
  it('stores only token hashes, purges this user’s expired rows first and burns taken tokens', async () => {
    const payload = { sessionVersion: 3 }
    const { db, calls } = database([
      [{ jkt: 'j', payload: JSON.stringify(payload) }],
      [{ jkt: 'j', payload }],
      [],
      [],
    ])
    const r = repo(db)
    await r.put('access', 'secret-token', 'j', payload as never, 2_000_000)
    expect(calls[0]?.sql).toContain('expires_at <=')
    expect(calls[0]?.values).toEqual([7, 11, new Date(1_000_000)])
    expect(calls[1]?.values).toEqual([sha('secret-token'), 'access', 7, 11, 'j', JSON.stringify(payload), new Date(2_000_000)])
    expect(JSON.stringify(calls)).not.toContain('"secret-token"')
    expect(await r.get('access', 'secret-token')).toEqual({ jkt: 'j', value: payload })
    expect(await r.take('code', 'c')).toEqual({ jkt: 'j', value: payload })
    expect(calls.at(-1)?.sql).toBe('DELETE FROM vault_extension_tokens WHERE token_hash=?')
    expect(await r.get('access', 'none')).toBeNull()
    expect(await r.take('code', 'none')).toBeNull()
    for (const call of calls.slice(2)) if (call.sql.startsWith('SELECT')) expect(call.sql).toContain('tenant_id=? AND user_id=?')
  })
})

describe('SqlExtensionLocator', () => {
  it('returns the claimed owner of a live token with a valid session version', async () => {
    const { db, calls } = database([
      [{ tenantId: 7, userId: 11, payload: '{"sessionVersion":3}' }],
      [{ tenantId: 7, userId: 11, payload: { sessionVersion: 'x' } }],
      [{ tenantId: 7, userId: 11, payload: { sessionVersion: 1.5 } }],
      [],
    ])
    const locator = new SqlExtensionLocator(() => db as unknown as PrismaClient, now)
    expect(await locator.locate('access', 't')).toEqual({ tenantId: 7, userId: 11, sessionVersion: 3 })
    expect(await locator.locate('access', 't')).toBeNull()
    expect(await locator.locate('access', 't')).toBeNull()
    expect(await new SqlExtensionLocator(db as unknown as PrismaClient, now).locate('code', 't')).toBeNull()
    expect(calls[0]?.values).toEqual([sha('t'), 'access', new Date(1_000_000)])
  })
})
