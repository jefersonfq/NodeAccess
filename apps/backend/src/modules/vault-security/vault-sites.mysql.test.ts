import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { compactDecrypt, exportJWK, generateKeyPair } from 'jose'
import { SqlVaultStore } from './vault.repository.js'
import { VaultSiteFill, type FillAccess } from './vault-site-fill.js'
import { JweVaultEnvelope } from './vault-envelope.js'
import type { SqlVaultSites } from './vault-sites.repository.js'
import type { VaultIdentity } from './vault-domain.js'
import type { VaultTransaction } from './vault-ports.js'
import { decrypt } from '../../shared/crypto.js'

const enabled = process.env.RUN_VAULT_MYSQL === 'true'
const entropy = { token: () => randomBytes(32).toString('base64url'), digest: (s: string) => createHash('sha256').update(s).digest('hex') }
const origin = 'https://site.example.test'
const input = { kind: 'login' as const, label: 'Synthetic login', username: 'synthetic', password: 'only-disposable-fixture',
  origins: [origin], scope: 'PERSONAL' as const, allowFill: true }

describe.skipIf(!enabled)('NA0203 sites real SQL and additive migration', () => {
  let db: PrismaClient
  let store: SqlVaultStore
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL ?? '')
    if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/na0178_') || !/^[a-f0-9]{24}$/.test(process.env.VAULT_DISPOSABLE_NONCE ?? '')) {
      throw new Error('Refusing a database outside the disposable vault harness')
    }
    db = new PrismaClient(); await db.$connect(); store = new SqlVaultStore(db)
    await store.rotateSiteFillGeneration(entropy.token())
  })
  afterAll(async () => { await db?.$disconnect() })
  async function fixture() {
    const suffix = randomUUID()
    const tenant = await db.tenant.create({ data: { name: 'Sites test', slug: `sites-${suffix}` } })
    const other = await db.tenant.create({ data: { name: 'Other tenant', slug: `other-${suffix}` } })
    for (const t of [tenant, other]) {
      await db.license.create({ data: { tenantId: t.id, maxUsers: 10, featureEntitlementsJson: { secrets: true } } })
      await db.tenantAuthPolicy.create({ data: { tenantId: t.id } })
      await db.$executeRaw`INSERT INTO vault_policies(tenant_id,version,config) VALUES(${t.id},1,
        ${JSON.stringify({ unlock: true, reveal: true, copy: true, localReauth: true, origin: 'https://vault.example.test', tenantQuota: 300 })})`
    }
    async function user(label: string, tenantId = tenant.id, role: 'ADMIN' | 'USER' = 'USER') {
      return db.user.create({ data: { name: label, email: `${label}-${suffix}@example.test`, tenantId, role,
        mfaEnabled: true, mfaSecret: randomBytes(20).toString('hex'), forcePasswordChange: false, sessionVersion: 1 } })
    }
    const owner = await user('owner'), peer = await user('peer'), outsider = await user('outsider', other.id)
    const manager1 = await user('manager1', tenant.id, 'ADMIN'), manager2 = await user('manager2', tenant.id, 'ADMIN')
    const group = await db.group.create({ data: { tenantId: tenant.id, name: 'Operations' } })
    for (const u of [owner, peer]) await db.userGroup.create({ data: { userId: u.id, groupId: group.id } })
    const identity = (u = owner): VaultIdentity => ({ tenantId: u.tenantId, userId: u.id, sessionVersion: 1 })
    const run = <T>(u: typeof owner, fn: (sites: SqlVaultSites) => Promise<T>, channel: 'portal' | 'extension' = 'extension') =>
      store.transaction(identity(u), async tx => fn(await tx.sites!(channel)))
    async function grant(action: 'shared-write' | 'fill', u = owner) {
      await db.$executeRaw`INSERT INTO vault_entitlements(tenant_id,user_id,action,granted_by,approved_by,enabled)
        VALUES(${tenant.id},${u.id},${action},${manager1.id},${manager2.id},TRUE)`
    }
    return { tenant, other, owner, peer, outsider, manager1, manager2, group, identity, run, grant }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  async function raw(id: number) {
    const rows = await db.$queryRaw<Array<{ encrypted: string | null; iv: string | null; version: number; revoked: Date | null; deleted: Date | null }>>`
      SELECT encrypted_value AS encrypted,iv,version,revoked_at AS revoked,deleted_at AS deleted FROM vault_site_items WHERE id=${id}`
    return rows[0]!
  }
  async function audits(f: Fixture, type: string) {
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM vault_audit WHERE tenant_id=${f.tenant.id} AND event_type=${type}`
    return Number(rows[0]!.n)
  }

  it('encrypts login values, lists metadata only and preserves cipher on metadata edit', async () => {
    const f = await fixture(), item = await f.run(f.owner, s => s.create(input))
    const before = await raw(item.id)
    expect(before.encrypted).not.toContain(input.password)
    expect(decrypt({ encrypted: before.encrypted!, iv: before.iv! })).toBe(input.password)
    const list = await f.run(f.owner, s => s.list({ origin }))
    expect(list.items.map(i => i.id)).toEqual([item.id])
    expect(JSON.stringify(list)).not.toContain(input.password)
    expect(JSON.stringify(list)).not.toContain(before.encrypted)
    await f.run(f.owner, s => s.update({ ...item, username: 'changed', label: 'Renamed' }))
    const after = await raw(item.id)
    expect(after.encrypted).toBe(before.encrypted); expect(after.iv).toBe(before.iv); expect(after.version).toBe(2)
    expect(await audits(f, 'site.created')).toBe(1); expect(await audits(f, 'site.updated')).toBe(1)
  })
  it('rolls back both the changed ciphertext/version and audit when SQL audit insertion fails', async () => {
    const f = await fixture(), item = await f.run(f.owner, s => s.create(input)), before = await raw(item.id)
    const constraint = `sites_audit_${randomBytes(6).toString('hex')}`
    // Only generated identifiers and a database-issued integer are interpolated; target is a verified disposable DB.
    await db.$executeRawUnsafe(`ALTER TABLE vault_audit ADD CONSTRAINT ${constraint}
      CHECK (tenant_id <> ${f.tenant.id} OR event_type <> 'site.updated')`)
    try {
      await expect(f.run(f.owner, s => s.update({ ...item, password: 'synthetic-rotation' }))).rejects.toThrow()
    } finally { await db.$executeRawUnsafe(`ALTER TABLE vault_audit DROP CHECK ${constraint}`) }
    expect(await raw(item.id)).toEqual(before)
    expect(await audits(f, 'site.updated')).toBe(0)
  })
  it('isolates tenants and personal owners for list, update and credential delivery', async () => {
    const f = await fixture(), item = await f.run(f.owner, s => s.create(input))
    for (const user of [f.peer, f.outsider]) {
      expect((await f.run(user, s => s.list())).items).toEqual([])
      await expect(f.run(user, s => s.update({ ...item, label: 'Denied' }))).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(f.run(user, s => s.delivery({ ...item, origin }))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
  })
  it('uses group membership and creator ACL, preserves portal writes and enforces extension grant', async () => {
    const f = await fixture(), shared = { ...input, scope: 'GROUP' as const, groupId: f.group.id }
    await expect(f.run(f.owner, s => s.create(shared))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const item = await f.run(f.owner, s => s.create(shared), 'portal')
    await f.grant('shared-write'); await f.grant('shared-write', f.peer)
    expect((await f.run(f.peer, s => s.list())).items.map(i => i.id)).toEqual([item.id])
    await expect(f.run(f.peer, s => s.update({ ...item, label: 'Denied' }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const changed = await f.run(f.owner, s => s.update({ ...item, label: 'Creator edited' }))
    await db.userGroup.delete({ where: { userId_groupId: { userId: f.owner.id, groupId: f.group.id } } })
    await expect(f.run(f.owner, s => s.delivery({ ...changed, origin }))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const foreign = await db.group.create({ data: { tenantId: f.other.id, name: 'Foreign' } })
    await expect(f.run(f.owner, s => s.create({ ...shared, groupId: foreign.id }))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('enforces tenant-scope admin writes even with a valid shared-write grant', async () => {
    const f = await fixture(); await f.grant('shared-write')
    await expect(f.run(f.owner, s => s.create({ ...input, scope: 'TENANT' }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const item = await f.run(f.manager1, s => s.create({ ...input, scope: 'TENANT' }), 'portal')
    expect((await f.run(f.owner, s => s.list())).items.map(i => i.id)).toEqual([item.id])
    await expect(f.run(f.owner, s => s.update({ ...item, label: 'Denied' }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('serializes concurrent updates: only one version wins and one audit is committed', async () => {
    const f = await fixture(), item = await f.run(f.owner, s => s.create(input))
    const results = await Promise.allSettled(['First', 'Second'].map(label => f.run(f.owner, s => s.update({ ...item, label }))))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect((await raw(item.id)).version).toBe(2)
    expect(await audits(f, 'site.updated')).toBe(1)
  })
  it('revokes and deletes without leaving decryptable values or visible catalog entries', async () => {
    const f = await fixture(), item = await f.run(f.owner, s => s.create(input))
    const revoked = await f.run(f.owner, s => s.revoke(item))
    expect(await raw(item.id)).toMatchObject({ encrypted: null, iv: null, version: 2 })
    expect((await f.run(f.owner, s => s.list())).items).toEqual([])
    await expect(f.run(f.owner, s => s.delivery({ ...revoked, origin }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await f.run(f.owner, s => s.delete(revoked))
    expect((await raw(item.id)).deleted).toBeInstanceOf(Date)
    expect(await audits(f, 'site.revoked')).toBe(1); expect(await audits(f, 'site.deleted')).toBe(1)
  })
  it('uses explicit host association, rejects invisible/foreign hosts and redacts revoked host access', async () => {
    const f = await fixture()
    const host = await db.host.create({ data: { tenantId: f.tenant.id, name: 'Visible', ip: '192.0.2.10', sshUser: 'fixture', authType: 'PASSWORD', scope: 'PERSONAL', ownerId: f.owner.id } })
    const invisible = await db.host.create({ data: { tenantId: f.tenant.id, name: 'Hidden', ip: '192.0.2.11', sshUser: 'fixture', authType: 'PASSWORD', scope: 'PERSONAL', ownerId: f.peer.id } })
    const foreign = await db.host.create({ data: { tenantId: f.other.id, name: 'Foreign', ip: '192.0.2.12', sshUser: 'fixture', authType: 'PASSWORD', scope: 'PERSONAL', ownerId: f.outsider.id } })
    const node = await db.inventoryNode.create({ data: { tenantId: f.tenant.id, hostId: host.id, type: 'HOST', name: host.name, path: `/${host.id}` } })
    const acl = await db.resourceAclEntry.create({ data: { tenantId: f.tenant.id, inventoryNodeId: node.id, principalType: 'USER', principalId: f.owner.id,
      canView: true, canConnect: false, createdById: f.manager1.id } })
    for (const id of [invisible.id, foreign.id]) await expect(f.run(f.owner, s => s.create({ ...input, hostId: id }))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await f.run(f.owner, s => s.create({ ...input, hostId: host.id }))
    expect((await f.run(f.owner, s => s.list())).items[0]!.host).toEqual({ id: host.id, name: 'Visible' })
    await db.resourceAclEntry.delete({ where: { id: acl.id } })
    expect((await f.run(f.owner, s => s.list())).items[0]!.host).toBeNull()
  })
  it('stores URL-only items without credentials, matches exact origins and rejects delivery', async () => {
    const f = await fixture(), item = await f.run(f.owner, s => s.create({ kind: 'url', label: 'Documentation', scope: 'PERSONAL', url: `${origin}/help` }))
    expect(await raw(item.id)).toMatchObject({ encrypted: null, iv: null })
    expect((await f.run(f.owner, s => s.list({ origin }))).items).toHaveLength(1)
    for (const candidate of ['https://sub.site.example.test', 'https://site.example.test.evil.test', `${origin}:8443`]) {
      expect((await f.run(f.owner, s => s.list({ origin: candidate }))).items).toEqual([])
    }
    await expect(f.run(f.owner, s => s.delivery({ ...item, origin }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  it('filters username before pagination and never leaks foreign matches', async () => {
    const f = await fixture()
    await f.run(f.owner, s => s.create({ ...input, label: 'Unrelated', username: 'unrelated' }))
    const match = await f.run(f.owner, s => s.create({ ...input, label: 'Other label', username: 'needle-account' }))
    await f.run(f.peer, s => s.create({ ...input, label: 'Hidden', username: 'needle-account' }))
    const page = await f.run(f.owner, s => s.list({ q: 'needle', limit: 1 }))
    expect(page.items.map(i => i.id)).toEqual([match.id]); expect(page.next).toBeNull()
  })

  async function fillFixture(beforeSeal: () => Promise<void> = () => Promise.resolve()) {
    const f = await fixture(); await f.grant('fill')
    const item = await f.run(f.owner, s => s.create(input))
    const keys = await generateKeyPair('RSA-OAEP-256', { modulusLength: 2048 }), jwk = await exportJWK(keys.publicKey)
    const recipient = { kty: 'RSA' as const, n: jwk.n!, e: 'AQAB' as const }
    const binding = { mode: 'both' as 'username' | 'password' | 'both', origin, tabId: 1, frameId: 0 as const, documentId: 'synthetic-document' }
    const ctx: FillAccess = { identity: f.identity(), jkt: entropy.token(), token: entropy.token(),
      access: { sessionVersion: 1, extensionId: 'a'.repeat(32), origin: null, policyVersion: 1, expiresAt: Date.now() + 120_000, proofAt: Date.now() } }
    let active = true
    const envelope = new JweVaultEnvelope()
    const service = new VaultSiteFill(() => active, entropy, { validate: key => envelope.validate(key),
      seal: async (key, context, secret) => { await beforeSeal(); return envelope.seal(key, context, secret) } })
    const authorized = <T>(fn: (tx: VaultTransaction, sites: SqlVaultSites) => Promise<T>) =>
      store.transaction(f.identity(), async tx => fn(tx, await tx.sites!('extension')))
    const authorize = () => authorized((tx, sites) => service.authorize(tx, ctx, { siteId: item.id, siteVersion: item.version, binding, recipient },
      () => tx.extension!.granted('fill'), (id, version, siteOrigin) => sites.delivery({ id, version, origin: siteOrigin })))
    const consume = (operation: string, selectedBinding = binding) => authorized((tx, sites) => service.consume(tx, ctx, { operation, binding: selectedBinding },
      () => tx.extension!.granted('fill'), (id, version, siteOrigin) => sites.delivery({ id, version, origin: siteOrigin })))
    return { ...f, item, keys, binding, ctx, authorize, consume, disable: () => { active = false } }
  }
  it('E7 username-only succeeds with an undecryptable stored password and no envelope', async () => {
    const f = await fillFixture(() => { throw new Error('must never decrypt') }); f.binding.mode = 'username'
    await db.$executeRaw`UPDATE vault_site_items SET encrypted_value=${'invalid-ciphertext'},iv=${'invalid-iv'} WHERE id=${f.item.id} AND tenant_id=${f.tenant.id}`
    const op = await f.authorize(), reply = await f.consume(op.operation)
    expect(reply).toMatchObject({ mode: 'username', username: input.username, binding: f.binding })
    expect(reply).not.toHaveProperty('envelope'); expect(reply).not.toHaveProperty('password')
    await expect(f.consume(op.operation)).rejects.toThrow()
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(1)
  })
  it('E7 mode is immutable and each next document needs its own operation', async () => {
    const f = await fillFixture(); f.binding.mode = 'username'
    const first = await f.authorize()
    await expect(f.consume(first.operation, { ...f.binding, mode: 'password' })).rejects.toThrow()
    expect((await f.consume(first.operation)).mode).toBe('username')
    f.binding.mode = 'password'; f.binding.documentId = 'second-document'
    await expect(f.consume(first.operation)).rejects.toThrow()
    const next = await f.authorize(), reply = await f.consume(next.operation)
    if (reply.mode !== 'password') throw new Error('wrong mode')
    expect(reply.context.itemRef).toBe(`site:${f.item.id}:password`)
    expect(new TextDecoder().decode((await compactDecrypt(reply.envelope, f.keys.privateKey)).plaintext)).toBe(input.password)
  })
  it('E7 commits exactly one encrypted delivery during a concurrent consume and rejects replay', async () => {
    const f = await fillFixture(), op = await f.authorize()
    const results = await Promise.allSettled([f.consume(op.operation), f.consume(op.operation)])
    const successes = results.filter(r => r.status === 'fulfilled')
    expect(successes).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    const reply = successes[0]!.value
    if (reply.mode === 'username') throw new Error('wrong mode')
    const opened = await compactDecrypt(reply.envelope, f.keys.privateKey)
    expect(new TextDecoder().decode(opened.plaintext)).toBe(input.password)
    expect(reply.context.action).toBe('fill'); expect(reply.username).toBe(input.username)
    await expect(f.consume(op.operation)).rejects.toThrow()
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(1)
  })
  it('E7 rejects pending operations after another API boot rotates the durable generation', async () => {
    const f = await fillFixture(), op = await f.authorize()
    const replica = new SqlVaultStore(db)
    await replica.rotateSiteFillGeneration(entropy.token())
    await expect(f.consume(op.operation)).rejects.toThrow('SITE_FILL_UNAVAILABLE')
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(0)
    const fresh = await f.authorize()
    await expect(f.consume(fresh.operation)).resolves.toMatchObject({ username: input.username })
  })
  function barrier() {
    let release!: () => void
    const promise = new Promise<void>(resolve => { release = resolve })
    return { promise, release }
  }
  async function waitForItemLock(id: number) {
    const deadline = Date.now() + 1400
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
        JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID AND b.ENGINE=w.ENGINE
        WHERE b.OBJECT_SCHEMA=DATABASE() AND b.OBJECT_NAME='vault_site_items' AND b.INDEX_NAME='PRIMARY' AND b.LOCK_DATA=${String(id)}`
      if (Number(rows[0]!.n) > 0) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Expected a real wait on this site item row, not a timing assumption')
  }
  it('E7 committed rotation wins before consumption and invalidates the waiting operation', async () => {
    const f = await fillFixture(), op = await f.authorize(), entered = barrier(), release = barrier()
    const rotation = db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE vault_fill_generation SET generation=${entropy.token()} WHERE id=1`
      entered.release(); await release.promise
    })
    const rotated = Promise.allSettled([rotation]); await entered.promise
    const consumed = Promise.allSettled([f.consume(op.operation)])
    let observed = false
    try {
      const deadline = Date.now() + 1400
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID AND b.ENGINE=w.ENGINE
          WHERE b.OBJECT_SCHEMA=DATABASE() AND b.OBJECT_NAME='vault_fill_generation'`
        if (Number(rows[0]!.n) > 0) { observed = true; break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    } finally { release.release(); await rotated; await consumed }
    expect(observed).toBe(true)
    expect((await rotated)[0].status).toBe('fulfilled')
    expect((await consumed)[0].status).toBe('rejected')
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(0)
  })
  it('E7 rotation waits for an admitted consume to commit before becoming effective', async () => {
    const entered = barrier(), release = barrier()
    const f = await fillFixture(async () => { entered.release(); await release.promise }), op = await f.authorize()
    const consumed = Promise.allSettled([f.consume(op.operation)])
    await entered.promise
    const rotated = Promise.allSettled([new SqlVaultStore(db).rotateSiteFillGeneration(entropy.token())])
    let observed = false
    try {
      const deadline = Date.now() + 1400
      while (Date.now() < deadline) {
        const rows = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w
          JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID AND b.ENGINE=w.ENGINE
          WHERE b.OBJECT_SCHEMA=DATABASE() AND b.OBJECT_NAME='vault_fill_generation'`
        if (Number(rows[0]!.n) > 0) { observed = true; break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    } finally { release.release(); await consumed; await rotated }
    expect(observed).toBe(true)
    expect((await consumed)[0].status).toBe('fulfilled')
    expect((await rotated)[0].status).toBe('fulfilled')
    await expect(f.consume(op.operation)).rejects.toThrow()
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(1)
  })
  it('E7 revocation by another actor wins the item lock: waiting consumption releases nothing', async () => {
    const f = await fillFixture(), op = await f.authorize(), entered = barrier(), release = barrier()
    const revoke = f.run(f.manager1, async sites => {
      const result = await sites.revoke(f.item); entered.release(); await release.promise; return result
    }, 'portal')
    const revoked = Promise.allSettled([revoke])
    await Promise.race([entered.promise, revoke.then(() => { throw new Error('Revocation finished before barrier') })])
    const consumed = Promise.allSettled([f.consume(op.operation)])
    try { await waitForItemLock(f.item.id) } finally { release.release(); await revoked; await consumed }
    expect((await revoked)[0].status).toBe('fulfilled')
    expect((await consumed)[0].status).toBe('rejected')
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(0)
    expect((await raw(f.item.id)).revoked).toBeInstanceOf(Date)
    await expect(f.consume(op.operation)).rejects.toThrow()
  })
  it('E7 consumption wins the item lock: concurrent revocation waits, then blocks every later delivery', async () => {
    const entered = barrier(), release = barrier()
    const f = await fillFixture(async () => { entered.release(); await release.promise }), op = await f.authorize()
    const consume = f.consume(op.operation), consumed = Promise.allSettled([consume])
    await Promise.race([entered.promise, consume.then(() => { throw new Error('Consumption finished before barrier') })])
    const revoked = Promise.allSettled([f.run(f.manager1, sites => sites.revoke(f.item), 'portal')])
    try { await waitForItemLock(f.item.id) } finally { release.release(); await consumed; await revoked }
    const result = (await consumed)[0]
    expect(result.status).toBe('fulfilled'); expect((await revoked)[0].status).toBe('fulfilled')
    if (result.status !== 'fulfilled') throw result.reason
    if (result.value.mode === 'username') throw new Error('wrong mode')
    expect(new TextDecoder().decode((await compactDecrypt(result.value.envelope, f.keys.privateKey)).plaintext)).toBe(input.password)
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(1)
    expect((await raw(f.item.id)).revoked).toBeInstanceOf(Date)
    await expect(f.consume(op.operation)).rejects.toThrow()
  })
  it('E7 rolls back consumed state when the release audit fails and permits one later successful consume', async () => {
    const f = await fillFixture(), op = await f.authorize()
    const constraint = `sites_release_${randomBytes(6).toString('hex')}`
    await db.$executeRawUnsafe(`ALTER TABLE vault_audit ADD CONSTRAINT ${constraint}
      CHECK (tenant_id <> ${f.tenant.id} OR event_type <> 'SITE_FILL_RELEASE_COMMITTED')`)
    try { await expect(f.consume(op.operation)).rejects.toThrow() }
    finally { await db.$executeRawUnsafe(`ALTER TABLE vault_audit DROP CHECK ${constraint}`) }
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(0)
    const reply = await f.consume(op.operation)
    if (reply.mode === 'username') throw new Error('wrong mode')
    expect(new TextDecoder().decode((await compactDecrypt(reply.envelope, f.keys.privateKey)).plaintext)).toBe(input.password)
    await expect(f.consume(op.operation)).rejects.toThrow()
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(1)
  })
  it.each(['version', 'revoke', 'grant', 'kill', 'document'] as const)('E7 rechecks %s before real SQL consumption', async change => {
    const f = await fillFixture(), op = await f.authorize()
    if (change === 'version') await f.run(f.owner, s => s.update({ ...f.item, label: 'Changed after authorization' }))
    if (change === 'revoke') await f.run(f.owner, s => s.revoke(f.item))
    if (change === 'grant') await db.$executeRaw`UPDATE vault_entitlements SET enabled=FALSE WHERE tenant_id=${f.tenant.id} AND user_id=${f.owner.id} AND action='fill'`
    if (change === 'kill') f.disable()
    await expect(f.consume(op.operation, change === 'document' ? { ...f.binding, documentId: 'other-document' } : f.binding)).rejects.toThrow()
    expect(await audits(f, 'SITE_FILL_RELEASE_COMMITTED')).toBe(0)
  })
})
