import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { vaultSiteUrl, VaultSiteCreateSchema, VaultSiteUpdateSchema } from '@nodeaccess/shared'
import { SqlVaultSites, type VaultSitesAccess } from './vault-sites.repository.js'
import { decrypt } from '../../shared/crypto.js'

const identity = { tenantId: 3, userId: 7, sessionVersion: 1 }
const login = () => VaultSiteCreateSchema.parse({ kind: 'login', label: 'Example', username: 'tester', password: 'synthetic-only', origins: ['https://example.test'] })
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 10, tenantId: 3, kind: 'login', label: 'Example', scope: 'PERSONAL', ownerUserId: 7, groupId: null,
  createdByUserId: 7, username: 'tester', origins: ['https://example.test'], url: null, hostId: null,
  allowFill: false, version: 2, revokedAt: null, deletedAt: null, ...overrides,
})
function fixture(options: { role?: 'admin' | 'user'; channel?: 'portal' | 'extension'; sharedWrite?: boolean } = {}) {
  const reads: unknown[] = []
  const statements: Array<{ text: string; values: unknown[] }> = []
  function sql(args: unknown[]) {
    const first = args[0] as Prisma.Sql | TemplateStringsArray
    return Array.isArray(first) ? { text: first.join('?'), values: args.slice(1) }
      : { text: (first as Prisma.Sql).sql, values: (first as Prisma.Sql).values }
  }
  const query = vi.fn((...args: unknown[]) => { statements.push(sql(args)); return Promise.resolve(reads.shift() ?? []) })
  const execute = vi.fn((...args: unknown[]) => { statements.push(sql(args)); return Promise.resolve(1) })
  const db = { $queryRaw: query, $executeRaw: execute } as unknown as Prisma.TransactionClient
  const host = vi.fn<VaultSitesAccess['visibleHost']>().mockResolvedValue(null)
  const access = { channel: options.channel ?? 'extension', sharedWrite: options.sharedWrite ?? false, visibleHost: host }
  return { sites: new SqlVaultSites(db, identity, options.role ?? 'user', access), reads, statements, query, execute, host, db }
}

describe('site schemas and exact origin matching', () => {
  it('normalizes Unicode, case and standard ports without adding subdomains', () => {
    expect(vaultSiteUrl('https://BÜCHER.example:443/', true)).toBe('https://xn--bcher-kva.example')
    expect(vaultSiteUrl('https://example.test:8443', true)).toBe('https://example.test:8443')
    expect(vaultSiteUrl('https://example.test/path?q=1#part')).toBe('https://example.test/path?q=1#part')
  })
  it.each(['http://example.test', 'javascript:alert(1)', 'https://u:p@example.test', 'https://example.test/path',
    'https://example.test?', 'https://example.test#', 'https://example.test/?q=1', 'https://example.test/#x',
    'https://example.test\\@evil.test', 'https://exa\nmple.test', 'https:example.test', '//example.test', 'https://@example.test'])('rejects unsafe origin %s', value => {
    expect(() => vaultSiteUrl(value, true)).toThrow()
  })
  it('defaults fill off, deduplicates origins and bounds inputs', () => {
    const parsed = login()
    expect(parsed.kind === 'login' && parsed.allowFill).toBe(false)
    expect(VaultSiteCreateSchema.parse({ ...parsed, origins: ['https://example.test/', 'https://EXAMPLE.test'] })).toMatchObject({ origins: ['https://example.test'] })
    expect(VaultSiteCreateSchema.safeParse({ ...parsed, origins: Array(9).fill('https://example.test') }).success).toBe(false)
    expect(VaultSiteCreateSchema.safeParse({ ...parsed, scope: 'GROUP' }).success).toBe(false)
    expect(VaultSiteCreateSchema.safeParse({ ...parsed, groupId: 9 }).success).toBe(false)
    expect(VaultSiteUpdateSchema.safeParse({ id: 10, version: 2 }).success).toBe(false)
    expect(VaultSiteUpdateSchema.safeParse({ id: 10, version: 2, scope: 'TENANT' }).success).toBe(false)
  })
  it('URL-only items cannot carry credentials or fill eligibility', () => {
    const url = { kind: 'url', label: 'Docs', url: 'https://example.test/docs' }
    expect(VaultSiteCreateSchema.safeParse(url).success).toBe(true)
    for (const extra of [{ username: 'x' }, { password: 'x' }, { allowFill: true }]) {
      expect(VaultSiteCreateSchema.safeParse({ ...url, ...extra }).success).toBe(false)
    }
  })
})

describe('transactional site domain', () => {
  it('encrypts creation, audits in the supplied tx, and defaults fill off', async () => {
    const f = fixture(); f.reads.push([{ id: 10n }])
    expect(await f.sites.create(login())).toEqual({ id: 10, version: 1 })
    const insert = f.statements[0]!
    expect(insert.values).not.toContain('synthetic-only')
    expect(decrypt({ encrypted: insert.values.at(-2) as string, iv: insert.values.at(-1) as string })).toBe('synthetic-only')
    expect(insert.values).toContain(false)
    expect(f.statements.at(-1)!.text).toContain('INSERT INTO vault_audit')
    expect(f.statements.at(-1)!.values).not.toContain('tester')
  })
  it('preserves ciphertext in metadata edits and increments version', async () => {
    const f = fixture(); f.reads.push([row()])
    expect(await f.sites.update({ id: 10, version: 2, label: 'New' })).toEqual({ id: 10, version: 3 })
    const update = f.statements.find(s => s.text.startsWith('UPDATE'))!
    expect(update.text).not.toMatch(/encrypted_value|\biv\b/)
    expect(update.text).toContain('version=version+1')
    expect(update.text).toContain('tenant_id=?')
  })
  it('rotates password only when supplied and binds changes to the version', async () => {
    const f = fixture(); f.reads.push([row()])
    await f.sites.update({ id: 10, version: 2, password: 'replacement-fixture' })
    const update = f.statements.find(s => s.text.startsWith('UPDATE'))!
    expect(update.text).toContain('encrypted_value=?')
    expect(update.values).not.toContain('replacement-fixture')
    expect(update.values.slice(-3)).toEqual([3, 10, 2])
  })
  it.each([row({ version: 3 }), row({ revokedAt: new Date() })])('rejects stale or revoked writes', async current => {
    const f = fixture(); f.reads.push([current])
    await expect(f.sites.update({ id: 10, version: 2, label: 'New' })).rejects.toMatchObject({ code: 'VAULT_SITE_CONFLICT' })
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('rejects a concurrent affected-row mismatch', async () => {
    const f = fixture(); f.reads.push([row()]); f.execute.mockResolvedValueOnce(0)
    await expect(f.sites.update({ id: 10, version: 2, label: 'New' })).rejects.toMatchObject({ code: 'VAULT_SITE_CONFLICT' })
    expect(f.execute).toHaveBeenCalledTimes(1)
  })
  it('does not swallow mandatory audit failure', async () => {
    const f = fixture(); f.reads.push([row()]); f.execute.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(f.sites.update({ id: 10, version: 2, label: 'New' })).rejects.toThrow('audit unavailable')
  })
  it('fails identically for absent/foreign/invisible rows, with tenant and ACL in the locked query', async () => {
    const f = fixture(); f.reads.push([])
    await expect(f.sites.update({ id: 10, version: 2, label: 'New' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(f.statements[0]!.text).toContain('s.tenant_id=?')
    expect(f.statements[0]!.text).toContain('g.tenant_id=?')
    expect(f.statements[0]!.text).toContain('user_groups')
    expect(f.statements[0]!.text).toContain('FOR UPDATE')
    expect(f.statements[0]!.values[0]).toBe(3)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('requires shared-write on extension shared creates, including administrators', async () => {
    for (const role of ['user', 'admin'] as const) {
      const f = fixture({ role })
      await expect(f.sites.create({ ...login(), scope: 'GROUP', groupId: 9 })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(f.query).not.toHaveBeenCalled()
    }
  })
  it('preserves portal group creation without the extension grant, checking tenant membership', async () => {
    const f = fixture({ channel: 'portal' }); f.reads.push([{ id: 9 }], [{ id: 9 }], [{ id: 10 }])
    await f.sites.create({ ...login(), scope: 'GROUP', groupId: 9 })
    expect(f.statements[0]!.text).toContain('g.tenant_id=?')
    expect(f.statements[0]!.text).toContain('ug.user_id=?')
  })
  it('denies foreign groups and non-admin tenant creation even with the grant', async () => {
    const f = fixture({ sharedWrite: true }); f.reads.push([])
    await expect(f.sites.create({ ...login(), scope: 'GROUP', groupId: 9 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(f.sites.create({ ...login(), scope: 'TENANT' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('a group member cannot edit another creator even with shared-write', async () => {
    const f = fixture({ sharedWrite: true }); f.reads.push([row({ scope: 'GROUP', groupId: 9, ownerUserId: null, createdByUserId: 8 })], [{ id: 9 }])
    await expect(f.sites.update({ id: 10, version: 2, label: 'New' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('creator and admin may edit shared items with the grant', async () => {
    for (const role of ['user', 'admin'] as const) {
      const f = fixture({ role, sharedWrite: true }); f.reads.push([row({ scope: 'GROUP', ownerUserId: null, groupId: 9 })])
      if (role === 'user') f.reads.push([{ id: 9 }])
      await expect(f.sites.update({ id: 10, version: 2, label: 'New' })).resolves.toEqual({ id: 10, version: 3 })
    }
  })
  it('rechecks and locks group membership before allowing delivery after catalog access', async () => {
    const f = fixture(); f.reads.push([row({ scope: 'GROUP', ownerUserId: null, groupId: 9, allowFill: true })], [])
    await expect(f.sites.delivery({ id: 10, version: 2, origin: 'https://example.test' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(f.statements[1]!.text).toContain('FOR SHARE')
    expect(f.statements[1]!.values).toEqual([3, 9, 7])
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('creates a URL without cipher and updates its path and matching origin together', async () => {
    const f = fixture(); f.reads.push([{ id: 10 }])
    await f.sites.create({ kind: 'url', label: 'Documentation', url: 'https://example.test/docs', scope: 'PERSONAL' })
    expect(f.statements[0]!.values.slice(-2)).toEqual([null, null])
    f.reads.push([row({ kind: 'url', username: null, url: 'https://example.test/docs' })])
    await f.sites.update({ id: 10, version: 2, url: 'https://other.test/help', hostId: null })
    const update = f.statements.find(s => s.text.startsWith('UPDATE'))!
    expect(update.values).toContain('https://other.test/help')
    expect(update.values).toContain('["https://other.test"]')
    expect(update.text).not.toContain('encrypted_value')
  })
  it('updates username, origins and explicit fill option without resubmitting password', async () => {
    const f = fixture(); f.reads.push([row()])
    await f.sites.update({ id: 10, version: 2, username: 'new-user', origins: ['https://other.test'], allowFill: true })
    const update = f.statements.find(s => s.text.startsWith('UPDATE'))!
    expect(update.text).not.toContain('encrypted_value')
    expect(update.values).toContain('new-user')
    expect(update.values).toContain('["https://other.test"]')
    expect(update.values).toContain(true)
  })
  it('metadata list never selects cipher, exact origin filter and pagination stay inside ACL', async () => {
    const f = fixture(); f.reads.push([row({ hostId: 44 }), row({ id: 11 })])
    const result = await f.sites.list({ origin: 'https://EXAMPLE.test/', limit: 1, q: '%_test' })
    expect(result.next).toBe(10); expect(result.items[0]!.host).toBeNull()
    expect(f.statements[0]!.text).not.toMatch(/encrypted_value|\biv\b|SELECT \*/)
    expect(f.statements[0]!.text).toContain('JSON_CONTAINS')
    expect(f.statements[0]!.values).toContain('"https://example.test"')
    expect(f.statements[0]!.values).toContain('%_test')
    expect(f.host).toHaveBeenCalledWith(f.db, identity, 44)
  })
  it('validates explicit host association and returns only sanitized visible host metadata', async () => {
    const f = fixture()
    await expect(f.sites.create({ ...login(), hostId: 44 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    f.host.mockResolvedValue({ id: 44, name: 'Server', ...{ sshUser: 'excluded' } })
    f.reads.push([row({ hostId: 44 })])
    expect((await f.sites.list()).items[0]!.host).toEqual({ id: 44, name: 'Server' })
  })
  it.each(['revoke', 'delete'] as const)('%s wipes cipher and makes outstanding operations stale', async method => {
    const f = fixture(); f.reads.push([row()])
    expect(await f.sites[method]({ id: 10, version: 2 })).toEqual({ id: 10, version: 3 })
    expect(f.statements[1]!.text).toContain('encrypted_value=NULL,iv=NULL')
    expect(f.statements[1]!.text).toContain('allow_fill=FALSE,version=version+1')
  })
  it('allows deletion of a revoked row but rejects incompatible metadata for URL items', async () => {
    const f = fixture(); f.reads.push([row({ revokedAt: new Date() })])
    await f.sites.delete({ id: 10, version: 2 })
    f.reads.push([row({ kind: 'url' })])
    await expect(f.sites.update({ id: 10, version: 2, password: 'fixture' })).rejects.toMatchObject({ code: 'VAULT_SITE_KIND' })
  })
  it.each([
    { allowFill: false }, { kind: 'url' }, { revokedAt: new Date() }, { version: 3 },
    { origins: ['https://sub.example.test'] }, { origins: ['https://example.test.evil.test'] }, { origins: ['https://example.test:8443'] },
  ])('refuses delivery without an active exact matching eligible login %j', async overrides => {
    const f = fixture(); f.reads.push([row({ allowFill: true, ...overrides })])
    await expect(f.sites.delivery({ id: 10, version: 2, origin: 'https://example.test' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(f.query).toHaveBeenCalledTimes(1)
  })
  it('delivery returns encrypted VaultSecret only after fresh ACL/version/origin checks and audit', async () => {
    const f = fixture(); f.reads.push([row({ allowFill: 1n })], [{ encrypted: 'fixture-cipher', iv: 'fixture-iv' }])
    expect(await f.sites.delivery({ id: 10, version: 2, origin: 'https://example.test' })).toEqual({
      secret: { encrypted: 'fixture-cipher', iv: 'fixture-iv', version: '2' }, username: 'tester', origins: ['https://example.test'], version: 2,
    })
    expect(f.statements[1]!.values).toEqual([3, 10, 2])
    expect(f.statements[2]!.values).toContain('site.delivery.checked')
  })
})
