/** Opt-in: refuses any DSN other than the disposable local security lab. */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { UserRepository } from '../../apps/backend/src/modules/users/user.repository.js'
import { TenantRepository } from '../../apps/backend/src/modules/tenants/tenant.repository.js'
const url = process.env.HARDENING_DATABASE_URL
if (!url?.startsWith('mysql://root:hardening-test-only@127.0.0.1:3308/hardening')) throw new Error('Disposable database required')
const db = new PrismaClient({ datasources: { db: { url } } })
const users = new UserRepository(db)
const tenants = new TenantRepository(db)
const cases: Record<string, unknown>[] = []
async function tenant() { return db.tenant.create({ data: { name: 'Quota lab', slug: `quota-${randomUUID()}`, license: { create: { maxUsers: 1 } } } }) }
async function count(tenantId: number) { return db.user.count({ where: { tenantId, active: true, licenseConsumed: true, deletedAt: null } }) }
try {
  const t = await tenant()
  const creations = await Promise.allSettled(Array.from({ length: 24 }, (_, i) => {
    const input = { name: `User ${i}`, email: `${i}@example.invalid`, tenantId: t.id }
    if (i % 4 === 0) return users.create({ ...input, passwordHash: 'lab-only', role: 'USER', canManageHosts: false, canViewLiveSessions: false, groupIds: [] })
    if (i % 4 === 1) return users.createGoogleUser({ ...input, googleId: randomUUID() })
    if (i % 4 === 2) return users.createLdapUser(input)
    return tenants.createAdmin(t.id, { ...input, passwordHash: 'lab-only' })
  }))
  assert.equal(creations.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(await count(t.id), 1)
  cases.push({ case: '24 mixed concurrent creations / 1 slot', passed: true })
  for (const restore of [false, true]) {
    const t = await tenant()
    const inactive = await Promise.all(Array.from({ length: 12 }, (_, i) => db.user.create({ data: { tenantId: t.id, name: 'Inactive', email: `${i}@example.invalid`, active: false, licenseConsumed: false, ...(restore ? { deletedAt: new Date() } : {}) } })))
    const results = await Promise.allSettled(inactive.map(user => restore ? users.restore(user.id) : users.setActive(user.id, true)))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(await count(t.id), 1)
    await assert.rejects(() => tenants.update(t.id, { maxUsers: 0 }))
    cases.push({ case: restore ? '12 concurrent restores / 1 slot' : '12 concurrent activations / 1 slot', passed: true, licenseReductionRejected: true })
  }
  const result = { success: true, cases }
  await writeFile('/tmp/nodeaccess-0043-quota-real.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await db.$disconnect() }
