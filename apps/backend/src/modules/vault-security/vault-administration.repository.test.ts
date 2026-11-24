import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Prisma } from '@prisma/client'
import { SqlVaultAdministration } from './vault-administration.repository.js'
import type { VaultChange } from './vault-domain.js'

// NA-0183 read side of the two-manager administration and approval by stored reference.
// Statement-recording double; the approval rules themselves are covered in vault.repository.test.ts and MySQL.
interface Call { sql: string; values: unknown[] }
function database(answer: (sql: string, values: unknown[]) => unknown[]) {
  const calls: Call[] = []
  const record = (strings: TemplateStringsArray, values: unknown[]): string => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push({ sql, values }); return sql
  }
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(answer(record(strings, values), values)),
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
      if (sql.includes('vault_managers')) return [{ id: 1 }, { id: 3 }]
      if (sql.includes('FROM users')) return [{ id: 1, name: 'Ana', email: 'ana@example.test' }, { id: 2, name: 'Bruno', email: 'bruno@example.test' }]
      if (sql.includes('vault_entitlements')) return [
        { userId: 2, action: 'extension', enabled: 1 }, { userId: 2, action: 'reveal', enabled: 0 }, { userId: 2, action: 'copy', enabled: true },
        { userId: 1, action: 'reveal', enabled: 1n }, { userId: 9, action: 'copy', enabled: 1 }, { userId: 2, action: 'fill', enabled: 1 },
      ]
      if (sql.includes('vault_proposals')) return [
        { reference, proposedBy: 3, name: 'Carla', payload: JSON.stringify({ kind: 'grant', userId: 2, action: 'extension', enabled: false }), expiresAt: new Date(60_000),
          beneficiaryId: 2, beneficiaryName: 'Bruno', beneficiaryEmail: 'bruno@example.test', itemId: null, itemAlias: null },
        { reference: sha('mine'), proposedBy: 1, name: null, payload: { kind: 'item', secretId: 4, enabled: true }, expiresAt: new Date(90_000), beneficiaryId: null, beneficiaryName: null, beneficiaryEmail: null,
          itemId: 4, itemAlias: 'db-prod' },
        // NA-0196: releasing an item that no longer exists is hidden (approval would refuse it).
        { reference: sha('gone'), proposedBy: 3, name: 'Carla', payload: { kind: 'item', secretId: 99, enabled: true }, expiresAt: new Date(90_000), beneficiaryId: null, beneficiaryName: null, beneficiaryEmail: null,
          itemId: null, itemAlias: null },
      ]
      if (sql.includes('vault_web_items')) return [{ id: 4, alias: 'db-prod' }]
      return []
    })
    expect(await admin(db).overview()).toEqual({
      serverNow: 1_000,
      users: [
        { id: 1, name: 'Ana', email: 'ana@example.test', manager: true, grants: { reveal: true, copy: false, extension: false } },
        { id: 2, name: 'Bruno', email: 'bruno@example.test', manager: false, grants: { reveal: false, copy: true, extension: true } },
      ],
      proposals: [
        { reference, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: 60_000, change: { kind: 'grant', userId: 2, action: 'extension', enabled: false },
          beneficiary: { id: 2, name: 'Bruno', email: 'bruno@example.test' }, item: null },
        { reference: sha('mine'), proposedBy: { id: 1, name: '' }, mine: true, expiresAt: 90_000, change: { kind: 'item', secretId: 4, enabled: true }, beneficiary: null,
          item: { id: 4, alias: 'db-prod' } },
      ],
      items: [{ id: 4, alias: 'db-prod' }],
    })
    const reads = calls.slice(1)
    expect(reads.map(c => c.values[0])).toEqual([7, 7, 7, 7, 7])
    expect(reads[4]?.sql).toContain('w.enabled=TRUE AND s.revoked_at IS NULL')
    expect(reads[2]?.sql).toContain('s.tenant_id=p.tenant_id')
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

// NA-0188: manager set changed by two managers, tenant proposal validity, impossible proposals refused, pending count.
type Row = { proposedBy: number; payload: unknown; expiresAt: Date }
function tenant(managers: number[], proposal?: Row, extra: (sql: string) => unknown[] | undefined = () => undefined) {
  return database((sql, values) => {
    if (sql.includes('vault_managers')) return sql.includes('m.user_id=') ? (managers.includes(values[1] as number) ? [{ id: values[1] }] : []) : managers.map(id => ({ id }))
    if (sql.includes('vault_proposals')) return proposal ? [proposal] : []
    return extra(sql) ?? []
  })
}
const writes = (calls: Call[]) => calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql))
describe('NA-0188 vault managers and proposal validity', () => {
  it('summary: managers get the ids and the count of live proposals they can approve; others get nothing', async () => {
    const rows = [
      { proposedBy: 2, payload: { kind: 'manager', userId: 4, enabled: true } },
      { proposedBy: 2, payload: JSON.stringify({ kind: 'grant', userId: 1, action: 'copy', enabled: true }) },
      { proposedBy: 3, payload: { kind: 'proposalWindow', seconds: 3600 } },
      { proposedBy: 9, payload: { kind: 'confirmation', seconds: 300 } },
      { proposedBy: 2, payload: { kind: 'item', secretId: 4, enabled: true }, itemId: 4 },
      // NA-0196: a change for a revoked or removed Secret would be refused, so it is not counted.
      { proposedBy: 2, payload: { kind: 'item', secretId: 5, enabled: false }, itemId: null },
    ]
    const { db, calls } = database(sql => sql.includes('vault_managers') ? [{ id: 1 }, { id: 2 }, { id: 3 }] : rows)
    // NA-0196: item and policy proposals are approved on screen too.
    expect(await admin(db).summary()).toEqual({ manager: true, pending: 3, managers: [1, 2, 3] })
    const query = calls.find(c => c.sql.includes('FROM vault_proposals'))
    expect(query?.sql).toContain('expires_at >'); expect(query?.sql).toContain('s.revoked_at IS NULL'); expect(query?.values).toEqual([7, new Date(1_000), 1])
    const outsider = tenant([2, 3])
    expect(await admin(outsider.db).summary()).toEqual({ manager: false, pending: 0, managers: [] })
    expect(outsider.calls.some(c => c.sql.includes('vault_proposals'))).toBe(false)
  })
  it('propose: stores the tenant validity and refuses invalid windows', async () => {
    const { db, calls } = tenant([1, 2])
    await admin(db).propose('p', { kind: 'proposalWindow', seconds: 3600 }, 86_400)
    expect(calls.find(c => c.sql.startsWith('INSERT INTO vault_proposals'))?.values.at(-1)).toEqual(new Date(1_000 + 86_400_000))
    await admin(db).propose('q', { kind: 'confirmation', seconds: 120 })
    expect(calls.filter(c => c.sql.startsWith('INSERT INTO vault_proposals')).at(-1)?.values.at(-1)).toEqual(new Date(121_000))
    for (const seconds of [60, 150, 86_460]) {
      await expect(admin(db).propose('x', { kind: 'proposalWindow', seconds })).rejects.toMatchObject({ status: 403 })
      await expect(admin(db).propose('x', { kind: 'confirmation', seconds: 300 }, seconds)).rejects.toMatchObject({ status: 403 })
    }
    expect(calls.filter(c => c.sql.startsWith('INSERT'))).toHaveLength(2)
  })
  it('propose: nobody proposes a manager change for themselves', async () => {
    const { db, calls } = tenant([1, 2, 3])
    await expect(admin(db).propose('x', { kind: 'manager', userId: 1, enabled: false })).rejects.toMatchObject({ status: 403 })
    expect(writes(calls)).toHaveLength(0)
  })
  it.each([
    ['grant for the only other manager', [1, 2], { kind: 'grant', userId: 2, action: 'reveal', enabled: true }],
    ['manager change for the only other manager', [1, 2], { kind: 'manager', userId: 2, enabled: false }],
    ['any change without a second manager', [1], { kind: 'confirmation', seconds: 300 }],
  ] as const)('propose: refuses %s as impossible to approve (VAULT_NO_APPROVER)', async (_name, managers, change) => {
    const { db, calls } = tenant([...managers])
    await expect(admin(db).propose('x', change as VaultChange)).rejects.toMatchObject({ status: 409, code: 'VAULT_NO_APPROVER' })
    expect(writes(calls)).toHaveLength(0)
  })
  it('propose: accepts a grant for a manager when a third manager can approve', async () => {
    const { db, calls } = tenant([1, 2, 3])
    await admin(db).propose('x', { kind: 'grant', userId: 2, action: 'reveal', enabled: true })
    expect(writes(calls)).toHaveLength(1)
  })
  it('removing a manager needs a third one (proposer + approver stay), checked again at approval under FOR UPDATE', async () => {
    const proposal = { proposedBy: 2, payload: { kind: 'manager', userId: 3, enabled: false }, expiresAt: new Date(5_000) }
    const three = tenant([1, 2, 3], proposal, sql => sql.includes('FROM users') ? [{ id: 3 }] : undefined)
    await admin(three.db).propose('x', { kind: 'manager', userId: 3, enabled: false })
    expect(await admin(three.db).approve(sha('p'), true)).toEqual({ change: proposal.payload, proposedBy: 2 })
    expect(three.calls.find(c => c.sql.startsWith('INSERT INTO vault_managers'))?.values).toEqual([7, 3, false])
    expect(three.calls.some(c => c.sql.includes('version=version+1'))).toBe(true)
    const sets = three.calls.filter(c => c.sql.startsWith('SELECT') && c.sql.includes('vault_managers') && !c.sql.includes('m.user_id='))
    expect(sets).toHaveLength(2); expect(sets.every(c => c.sql.endsWith('FOR UPDATE OF m'))).toBe(true)
    // The removed manager's open proposals are dropped with the role.
    expect(three.calls.find(c => c.sql.includes('DELETE FROM vault_proposals WHERE tenant_id=? AND proposed_by=?'))?.values).toEqual([7, 3])
    // Disabling someone who is not a user of this tenant is refused (no stray rows).
    const stranger = tenant([1, 2, 3], { ...proposal, payload: { kind: 'manager', userId: 99, enabled: false } })
    await expect(admin(stranger.db).approve(sha('p'), true)).rejects.toMatchObject({ status: 403 })
    expect(writes(stranger.calls)).toHaveLength(0)
    // Another removal approved meanwhile: only proposer and target remain, so nobody may approve.
    const two = tenant([2, 3], proposal)
    await expect(admin(two.db).approve(sha('p'), true)).rejects.toBeDefined()
    expect(writes(two.calls)).toHaveLength(0)
  })
  it('approve: adds an active tenant user as manager, never the proposer or the approver', async () => {
    const add = (userId: number, proposedBy = 2) => ({ proposedBy, payload: { kind: 'manager', userId, enabled: true }, expiresAt: new Date(5_000) })
    const ok = tenant([1, 2], add(5), sql => sql.includes('FROM users') ? [{ id: 5 }] : undefined)
    await admin(ok.db).approve(sha('p'), true)
    const insert = ok.calls.find(c => c.sql.startsWith('INSERT INTO vault_managers'))
    expect(insert?.sql).toContain('ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)'); expect(insert?.values).toEqual([7, 5, true])
    for (const [proposal, status] of [[add(5), 403], [add(2), 403], [add(1), 403]] as const) {
      const { db, calls } = tenant([1, 2], proposal)
      await expect(admin(db).approve(sha('p'), true)).rejects.toMatchObject({ status })
      expect(writes(calls)).toHaveLength(0)
    }
  })
  it('approve: stores the proposal validity as an integer and bumps the policy version', async () => {
    const { db, calls } = tenant([1, 2], { proposedBy: 2, payload: { kind: 'proposalWindow', seconds: 3600 }, expiresAt: new Date(5_000) })
    await admin(db).approve(sha('p'), true)
    expect(calls.find(c => c.sql.includes('$.proposalSeconds'))?.values).toEqual([3600, 7])
    // Open proposals are clamped to the new validity, never extended.
    expect(calls.find(c => c.sql.includes('SET expires_at=LEAST(expires_at,'))?.values).toEqual([new Date(1_000 + 3_600_000), 7])
    expect(calls.some(c => c.sql.includes('version=version+1'))).toBe(true)
    const bad = tenant([1, 2], { proposedBy: 2, payload: { kind: 'proposalWindow', seconds: 90 }, expiresAt: new Date(5_000) })
    await expect(admin(bad.db).approve(sha('p'), true)).rejects.toMatchObject({ status: 403 })
    expect(writes(bad.calls)).toHaveLength(0)
  })
  it('overview marks which users are managers', async () => {
    const { db } = tenant([1, 2], undefined, sql => sql.includes('FROM users') ? [{ id: 1, name: 'Ana', email: 'a@example.test' }, { id: 3, name: 'Carla', email: 'c@example.test' }] : undefined)
    const view = await admin(db).overview()
    expect(view.users.map(u => [u.id, u.manager])).toEqual([[1, true], [3, false]])
  })
  it('overview hides proposals approval would refuse: proposer no longer a manager, inactive person to grant or promote', async () => {
    const row = (reference: string, proposedBy: number, payload: object, beneficiaryId: number | null) => ({ reference, proposedBy, name: 'x', payload, expiresAt: new Date(60_000),
      beneficiaryId, beneficiaryName: beneficiaryId ? 'b' : null, beneficiaryEmail: beneficiaryId ? 'b@example.test' : null })
    const rows = [
      row(sha('ok'), 2, { kind: 'grant', userId: 4, action: 'copy', enabled: true }, 4),
      row(sha('demoted'), 9, { kind: 'grant', userId: 4, action: 'copy', enabled: true }, 4),
      row(sha('inactive'), 2, { kind: 'grant', userId: 5, action: 'copy', enabled: true }, null),
      row(sha('promote-inactive'), 2, { kind: 'manager', userId: 5, enabled: true }, null),
      row(sha('remove-inactive'), 2, { kind: 'manager', userId: 5, enabled: false }, null),
      row(sha('window'), 2, { kind: 'proposalWindow', seconds: 600 }, null),
    ]
    const { db, calls } = database(sql => sql.includes('vault_managers') ? [{ id: 1 }, { id: 2 }] : sql.includes('FROM vault_proposals') ? rows : [])
    const view = await admin(db).overview()
    expect(view.proposals.map(p => p.reference)).toEqual([sha('ok'), sha('remove-inactive'), sha('window')])
    expect(calls.find(c => c.sql.includes('FROM vault_proposals'))?.sql).toContain('b.active=TRUE AND b.deleted_at IS NULL')
  })
})
