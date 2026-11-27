import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { SqlVaultDiagnostics } from './vault-diagnostics.repository.js'
import { diag, type VaultDiagnosticsTransaction } from './vault-diagnostics.service.js'
import type { VaultAuthority } from './vault-domain.js'
import { VaultDiagnosticsSchema } from '../../../../../packages/shared/src/schemas/vault-diagnostics.schema.js'

function fixture() {
  const state = { manager: true, item: true, user: true, role: 'USER', active: true, deletedAt: null as Date | null,
    scope: 'TENANT', owner: 3 as number | null, groupId: null as number | null, revokedAt: null as Date | null,
    members: [] as number[], released: true, grants: [{ action: 'reveal', enabled: true, grantedBy: 5, approvedBy: 6 }] }
  const queries: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    await Promise.resolve() // Preserve the asynchronous database boundary.
    const sql = strings.join('?'); queries.push({ sql, values })
    if (sql.includes('FROM vault_managers')) return state.manager ? [{ id: 1 }] : []
    if (sql.includes('FROM secrets')) return state.item ? [{ scope: state.scope, owner: state.owner, groupId: state.groupId, revokedAt: state.revokedAt }] : []
    if (sql.includes('FROM users')) return state.user ? [{ role: state.role, active: state.active, deletedAt: state.deletedAt }] : []
    if (sql.includes('FROM user_groups')) return state.members.includes(values[0] as number) ? [{ userId: values[0] }] : []
    if (sql.includes('FROM vault_entitlements')) return state.grants
    if (sql.includes('FROM vault_web_items')) return [{ enabled: state.released }]
    throw new Error('Unexpected query')
  })
  const authority = { role: 'USER', policy: { reveal: true, copy: false } } as VaultAuthority
  const repo = new SqlVaultDiagnostics({ $queryRaw: query } as unknown as Prisma.TransactionClient,
    { tenantId: 7, userId: 1, sessionVersion: 1 }, authority, () => 1000)
  return { state, queries, query, authority, repo }
}
describe('vault configuration diagnostics', () => {
  it('returns only configuration, with tenant-scoped locking reads and no secret columns', async () => {
    const f = fixture(), result = await f.repo.diagnose(2, 10)
    expect(VaultDiagnosticsSchema.parse(result)).toEqual({ kind: 'configuration', userId: 2, secretId: 10,
      user: { exists: true, active: true, deleted: false }, policy: { reveal: true, copy: false },
      grants: { reveal: true, copy: false }, item: { released: true, revoked: false }, acl: true, runtime: 'not-evaluated' })
    for (const { sql, values } of f.queries) {
      expect(sql).toContain('FOR SHARE'); expect(sql).toContain('tenant_id='); expect(values).toContain(7)
      expect(sql).not.toMatch(/encrypted|\biv\b|username|password|SELECT\s+\*/i)
    }
    expect(f.queries.find(q => q.sql.includes('FROM secrets'))?.values).toEqual([10, 7])
    expect(f.queries.find(q => q.sql.includes('FROM users'))?.values).toEqual([2, 7])
  })
  it.each(['manager', 'item', 'user'] as const)('indistinguishable denial when %s is absent (including foreign tenant)', async field => {
    const f = fixture(); f.state[field] = false
    await expect(f.repo.diagnose(2, 10)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN', status: 403 })
    expect(f.queries.some(q => q.sql.includes('FROM vault_entitlements'))).toBe(false)
  })
  it('does not let tenant ADMIN replace a manager', async () => {
    const f = fixture(); f.authority.role = 'ADMIN'; f.state.manager = false
    await expect(f.repo.diagnose(2, 10)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect(f.query).toHaveBeenCalledTimes(1)
  })
  it('denies actor without item ACL before inspecting target', async () => {
    const f = fixture(); f.state.scope = 'PERSONAL'
    await expect(f.repo.diagnose(2, 10)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' })
    expect(f.queries.some(q => q.sql.includes('FROM users'))).toBe(false)
  })
  it.each(['owner', 'group', 'admin'] as const)('allows actor identification through %s and diagnoses target denial', async mode => {
    const f = fixture(); f.state.scope = 'GROUP'
    if (mode === 'owner') f.state.owner = 1
    if (mode === 'group') { f.state.groupId = 9; f.state.members = [1] }
    if (mode === 'admin') f.authority.role = 'ADMIN'
    expect((await f.repo.diagnose(2, 10)).acl).toBe(false)
  })
  it.each(['owner', 'group', 'admin'] as const)('matches target %s ACL without granting delivery', async mode => {
    const f = fixture(); f.authority.role = 'ADMIN'; f.state.scope = 'GROUP'
    if (mode === 'owner') f.state.owner = 2
    if (mode === 'group') { f.state.groupId = 9; f.state.members = [2] }
    if (mode === 'admin') f.state.role = 'ADMIN'
    expect((await f.repo.diagnose(2, 10)).acl).toBe(true)
  })
  it.each([
    { action: 'reveal', enabled: false, grantedBy: 5, approvedBy: 6 },
    { action: 'reveal', enabled: true, grantedBy: 5, approvedBy: 5 },
    { action: 'reveal', enabled: true, grantedBy: 2, approvedBy: 6 },
    { action: 'reveal', enabled: true, grantedBy: 5, approvedBy: 2 },
  ])('rejects invalid grant %j', async grant => {
    const f = fixture(); f.state.grants = [grant]
    expect((await f.repo.diagnose(2, 10)).grants.reveal).toBe(false)
  })
  it('reports inactive/deleted, revoked/unreleased and missing grants separately', async () => {
    const f = fixture(); Object.assign(f.state, { active: false, deletedAt: new Date(), revokedAt: new Date(), released: false, grants: [] })
    const result = await f.repo.diagnose(2, 10)
    expect(result.user).toEqual({ exists: true, active: false, deleted: true })
    expect(result.item).toEqual({ released: false, revoked: true }); expect(result.grants).toEqual({ reveal: false, copy: false })
  })
  it('fails closed on dependency error', async () => {
    const f = fixture(); f.query.mockRejectedValueOnce(new Error('db unavailable'))
    await expect(f.repo.diagnose(2, 10)).rejects.toThrow('db unavailable')
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid identifiers %s before reading', async id => {
    const f = fixture(); await expect(f.repo.diagnose(id, 10)).rejects.toThrow(); expect(f.query).not.toHaveBeenCalled()
  })
  it('requires explicit manager on confirmed transaction and delegates to its adapter', async () => {
    const diagnose = vi.fn().mockResolvedValue({ kind: 'configuration' }), isManager = vi.fn().mockResolvedValue(false)
    const tx = { administration: { isManager }, diagnostics: { diagnose } } as unknown as VaultDiagnosticsTransaction
    await expect(diag(tx, 2, 10)).rejects.toMatchObject({ code: 'VAULT_FORBIDDEN' }); expect(diagnose).not.toHaveBeenCalled()
    isManager.mockResolvedValue(true); await diag(tx, 2, 10); expect(diagnose).toHaveBeenCalledWith(2, 10)
    await expect(diag({} as VaultDiagnosticsTransaction, 2, 10)).rejects.toThrow()
    await expect(diag({ administration: tx.administration } as VaultDiagnosticsTransaction, 2, 10)).rejects.toThrow()
  })
})
