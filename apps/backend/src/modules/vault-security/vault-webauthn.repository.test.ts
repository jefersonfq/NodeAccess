import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { SqlVaultWebauthn } from './vault-webauthn.repository.js'

// NA-0198 — statement-recording double; the SQL itself also runs against MySQL in vault.mysql.test.ts.
interface Call { sql: string; values: unknown[] }
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
function database(rows: unknown[] = [], affected = 1) {
  const calls: Call[] = []
  const record = (strings: TemplateStringsArray, values: unknown[]): void => { calls.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values }) }
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => { record(strings, values); return Promise.resolve(rows) },
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => { record(strings, values); return Promise.resolve(affected) },
  }
  return { db: db as unknown as Prisma.TransactionClient, calls }
}
const identity = { tenantId: 7, userId: 3, sessionVersion: 1 }
const row = { id: 'cred', publicKey: new Uint8Array([1, 2]), counter: 5n, transports: 'internal,hybrid', name: 'Notebook', createdAt: new Date(10), lastUsedAt: null }

describe('NA-0198 WebAuthn credential repository', () => {
  it('lists and finds only the identity credentials of the current credential version', async () => {
    const f = database([row]), repo = new SqlVaultWebauthn(f.db, identity, () => 99, 'v'.repeat(64))
    expect(await repo.list()).toEqual([{ id: 'cred', publicKey: new Uint8Array([1, 2]), counter: 5, transports: ['internal', 'hybrid'], name: 'Notebook', createdAt: 10, lastUsedAt: null }])
    expect(f.calls[0]!.sql).toContain('credential_version=?'); expect(f.calls[0]!.values).toEqual([7, 3, 'v'.repeat(64)])
    expect(await repo.find('cred')).toMatchObject({ id: 'cred', counter: 5 })
    expect(f.calls[1]!.values).toEqual([hash('cred'), 7, 3, 'v'.repeat(64)]); expect(f.calls[1]!.sql).toContain('FOR UPDATE')
    const empty = new SqlVaultWebauthn(database([{ ...row, transports: '', lastUsedAt: new Date(20) }]).db, identity, () => 0, 'v')
    expect((await empty.list())[0]).toMatchObject({ transports: [], lastUsedAt: 20 })
    expect(await new SqlVaultWebauthn(database([]).db, identity, () => 0, 'v').find('cred')).toBeNull()
  })
  it('rejects malformed ids without touching the database', async () => {
    const f = database([row]), repo = new SqlVaultWebauthn(f.db, identity, () => 0, 'v')
    for (const bad of ['', 'a/b', 'x'.repeat(1401)]) { expect(await repo.find(bad)).toBeNull(); expect(await repo.remove(bad)).toBe(false) }
    expect(f.calls).toEqual([])
  })
  it('adds with the credential version, reports a duplicate as false, never lowers the counter and removes own rows', async () => {
    const f = database([], 1), repo = new SqlVaultWebauthn(f.db, identity, () => 1234, 'v1')
    expect(await repo.add({ id: 'cred', publicKey: new Uint8Array([9]), counter: 0, transports: ['internal'], name: 'Notebook' })).toBe(true)
    expect(f.calls[0]!.sql).toContain('INSERT IGNORE'); expect(f.calls[0]!.values).toContain('v1'); expect(f.calls[0]!.values).toContain('internal')
    expect(await new SqlVaultWebauthn(database([], 0).db, identity, () => 0, 'v1').add({ id: 'cred', publicKey: new Uint8Array([9]), counter: 0, transports: [], name: 'x' })).toBe(false)
    await repo.used('cred', 8)
    expect(f.calls[1]!.sql).toContain('GREATEST(sign_count,?)'); expect(f.calls[1]!.values).toEqual([8, new Date(1234), hash('cred'), 7, 3])
    expect(await repo.remove('cred')).toBe(true); expect(f.calls[2]!.values).toEqual([hash('cred'), 7, 3])
    expect(await new SqlVaultWebauthn(database([], 0).db, identity, () => 0, 'v1').remove('cred')).toBe(false)
  })
})
