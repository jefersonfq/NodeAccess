import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { SqlVaultAdministration } from './vault-administration.repository.js'

// NA-0183 read side of the two-manager administration and approval by stored reference.
// Statement-recording double; the approval rules themselves are covered in vault.repository.test.ts and MySQL.
interface Call { sql: string; values: unknown[] }
function database(answer: (sql: string) => unknown[]) {
  const calls: Call[] = []
  const record = (strings: TemplateStringsArray, values: unknown[]): string => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push({ sql, values }); return sql
  }
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(answer(record(strings, values))),
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => { record(strings, values); return Promise.resolve(1) },
  }
  return { db, calls }
}
const actor = { tenantId: 7, userId: 1, sessionVersion: 3 }
const admin = (db: unknown) => new SqlVaultAdministration(db as Prisma.TransactionClient, actor, () => 1_000)
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('vault administration reads', () => {
  it('reports whether the actor manages the vault', async () => {
    expect(await admin(database(sql => (sql.includes('vault_managers') ? [{ id: 1 }] : [])).db).isManager()).toBe(true)
    expect(await admin(database(() => []).db).isManager()).toBe(false)
  })
  it('refuses the overview to a non-manager before reading anything else', async () => {
    const { db, calls } = database(() => [])
    await expect(admin(db).overview()).rejects.toMatchObject({ status: 403 })
    expect(calls).toHaveLength(1)
  })
  it('lists tenant users with their grants and the live proposals, all scoped to the tenant', async () => {
    const reference = sha('proposal')
    const { db, calls } = database(sql => {
      if (sql.includes('vault_managers')) return [{ id: 1 }]
      if (sql.includes('FROM users')) return [{ id: 1, name: 'Ana', email: 'ana@example.test' }, { id: 2, name: 'Bruno', email: 'bruno@example.test' }]
      if (sql.includes('vault_entitlements')) return [
        { userId: 2, action: 'extension', enabled: 1 }, { userId: 2, action: 'reveal', enabled: 0 }, { userId: 2, action: 'copy', enabled: true },
        { userId: 1, action: 'reveal', enabled: 1n }, { userId: 9, action: 'copy', enabled: 1 }, { userId: 2, action: 'fill', enabled: 1 },
      ]
      if (sql.includes('vault_proposals')) return [
        { reference, proposedBy: 3, name: 'Carla', payload: JSON.stringify({ kind: 'grant', userId: 2, action: 'extension', enabled: false }), expiresAt: new Date(60_000),
          beneficiaryId: 2, beneficiaryName: 'Bruno', beneficiaryEmail: 'bruno@example.test' },
        { reference: sha('mine'), proposedBy: 1, name: null, payload: { kind: 'item', secretId: 4, enabled: true }, expiresAt: new Date(90_000), beneficiaryId: null, beneficiaryName: null, beneficiaryEmail: null },
      ]
      return []
    })
    expect(await admin(db).overview()).toEqual({
      serverNow: 1_000,
      users: [
        { id: 1, name: 'Ana', email: 'ana@example.test', grants: { reveal: true, copy: false, extension: false } },
        { id: 2, name: 'Bruno', email: 'bruno@example.test', grants: { reveal: false, copy: true, extension: true } },
      ],
      proposals: [
        { reference, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: 60_000, change: { kind: 'grant', userId: 2, action: 'extension', enabled: false },
          beneficiary: { id: 2, name: 'Bruno', email: 'bruno@example.test' } },
        { reference: sha('mine'), proposedBy: { id: 1, name: '' }, mine: true, expiresAt: 90_000, change: { kind: 'item', secretId: 4, enabled: true }, beneficiary: null },
      ],
    })
    const reads = calls.slice(1)
    expect(reads.map(c => c.values[0])).toEqual([7, 7, 7])
    expect(reads[0]?.sql).toContain('active=TRUE AND deleted_at IS NULL')
    expect(reads[2]?.sql).toContain('p.expires_at >')
    expect(reads[2]?.sql).toContain('b.tenant_id=p.tenant_id')
    expect(reads[2]?.values).toEqual([7, new Date(1_000)])
  })
  it('NA-0186: applies the confirmation time through the two-manager flow and bumps the policy version', async () => {
    const { db, calls } = database(sql => {
      if (sql.includes('vault_managers')) return [{ id: 1 }]
      if (sql.includes('vault_proposals')) return [{ proposedBy: 2, payload: { kind: 'confirmation', seconds: 300 }, expiresAt: new Date(5_000) }]
      return []
    })
    expect(await admin(db).approve(sha('p'), true)).toEqual({ change: { kind: 'confirmation', seconds: 300 }, proposedBy: 2 })
    const update = calls.find(c => c.sql.includes('$.confirmationSeconds'))
    expect(update?.values).toEqual([300, 7])
    expect(calls.some(c => c.sql.includes('version=version+1'))).toBe(true)
  })
  it.each([59, 901, 120.5, 90])('NA-0186: refuses a confirmation time of %s at proposal and approval', async seconds => {
    const { db, calls } = database(sql => {
      if (sql.includes('vault_managers')) return [{ id: 1 }]
      if (sql.includes('vault_proposals')) return [{ proposedBy: 2, payload: { kind: 'confirmation', seconds }, expiresAt: new Date(5_000) }]
      return []
    })
    await expect(admin(db).propose('x', { kind: 'confirmation', seconds })).rejects.toMatchObject({ status: 403 })
    await expect(admin(db).approve(sha('p'), true)).rejects.toMatchObject({ status: 403 })
    expect(calls.some(c => c.sql.startsWith('INSERT') || c.sql.includes('version=version+1'))).toBe(false)
  })
  it('approves by stored reference without hashing it again, and by id with the hash', async () => {
    for (const [id, byReference, key] of [[sha('p'), true, sha('p')], ['p', false, sha('p')]] as const) {
      const { db, calls } = database(sql => {
        if (sql.includes('vault_managers')) return [{ id: 1 }]
        if (sql.includes('vault_proposals')) return [{ proposedBy: 2, payload: { kind: 'item', secretId: 4, enabled: true }, expiresAt: new Date(5_000) }]
        if (sql.includes('FROM secrets')) return [{ id: 4 }]
        return []
      })
      expect(await admin(db).approve(id, byReference)).toEqual({ change: { kind: 'item', secretId: 4, enabled: true }, proposedBy: 2 })
      const lookup = calls.find(c => c.sql.includes('FROM vault_proposals'))
      const removal = calls.find(c => c.sql.startsWith('DELETE FROM vault_proposals'))
      expect(lookup?.values).toEqual([7, key]); expect(removal?.values).toEqual([7, key])
    }
  })
})
