import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrap, configuration, disable, maintenance, origin } from './manage.mjs'
const config = { tenantId: 5, origin: 'https://vault.test', managerIds: [3, 4], allowLocalReauthentication: true }
function dbFixture() {
  const statements = []; const state = { tenant: true, trial: false, existing: false, manager: true }
  const db = {
    $queryRaw: async strings => {
      const q = strings.join('?')
      if (q.includes('FROM tenants')) return state.tenant ? [{ id: 5 }] : []
      if (q.includes('FROM trial_registrations')) return state.trial ? [{ id: 1 }] : []
      if (q.includes('$.origin')) return state.existing ? [{ origin: 'https://127.0.0.1:5173' }] : []
      if (q.includes('FROM vault_policies')) return state.existing ? [{ tenant_id: 5 }] : []
      return state.manager ? [{ id: 3 }] : []
    },
    $executeRaw: async (strings, ...values) => { statements.push({ query: strings.join('?'), values }); return 1 },
    $transaction: async fn => fn(db),
  }
  return { db, statements, state }
}
test('bootstrap requires exact HTTPS, explicit fallback and two distinct managers', () => {
  for (const patch of [{ tenantId: 0 }, { origin: 'http://vault.test' }, { origin: 'https://vault.test/path' }, { managerIds: [3, 3] }, { managerIds: [3] }, { managerIds: [3, -1] }, { allowLocalReauthentication: false }, { extra: true }]) {
    assert.throws(() => configuration({ ...config, ...patch }))
  }
  assert.deepEqual(configuration(config), config)
})
test('dry-run performs checks without granting access', async () => {
  const f = dbFixture(); assert.deepEqual(await bootstrap(f.db, config), { applied: false, managers: 2, extractionEnabled: false }); assert.equal(f.statements.length, 0)
})
test('bootstrap never enables extraction or marks items eligible', async () => {
  const f = dbFixture(); await bootstrap(f.db, config, true)
  assert.equal(f.statements.filter(s => s.query.includes('INSERT INTO vault_managers')).length, 2)
  assert.equal(f.statements.some(s => s.query.includes('vault_entitlements') || s.query.includes('vault_web_items')), false)
  const policy = JSON.parse(f.statements.find(s => s.query.includes('vault_policies')).values[1])
  assert.equal(policy.reveal, false); assert.equal(policy.copy, false)
  assert.equal(f.statements.some(s => s.query.includes('vault_audit')), true)
})
for (const kind of ['tenant', 'trial', 'existing', 'manager']) test(`bootstrap denies invalid ${kind}`, async () => {
  const f = dbFixture(); f.state[kind] = kind === 'trial' || kind === 'existing'
  await assert.rejects(bootstrap(f.db, config, true)); assert.equal(f.statements.length, 0)
})
test('maintenance is explicit and bounded, never deletes audit', async () => {
  const f = dbFixture(); await maintenance(f.db); assert.equal(f.statements.length, 0)
  assert.deepEqual(await maintenance(f.db, true), { applied: true, records: 1, proposals: 1 })
  assert.ok(f.statements.every(s => s.query.includes('LIMIT 1000') && !s.query.includes('vault_audit')))
})
test('disable increments generation and audits; invalid IDs and dry-run never mutate', async () => {
  const f = dbFixture(); await assert.rejects(disable(f.db, 0, true)); await disable(f.db, 5); assert.equal(f.statements.length, 0)
  await disable(f.db, 5, true); assert.ok(f.statements[0].query.includes('version=version+1')); assert.ok(f.statements[1].query.includes('vault_audit'))
})

test('NA-0198 origin: exact HTTPS only, dry-run by default, version bump and audit on apply', async () => {
  const f = dbFixture()
  for (const bad of ['http://localhost:5173', 'https://localhost:5173/', 'https://localhost:5173/vault', 'localhost', '']) await assert.rejects(origin(f.db, 5, bad, true))
  await assert.rejects(origin(f.db, 0, 'https://localhost:5173', true))
  await assert.rejects(origin(f.db, 5, 'https://localhost:5173', true), /not configured/)
  f.state.existing = true
  assert.deepEqual(await origin(f.db, 5, 'https://localhost:5173'), { applied: false, current: 'https://127.0.0.1:5173', next: 'https://localhost:5173' })
  assert.equal(f.statements.length, 0)
  assert.deepEqual(await origin(f.db, 5, 'https://127.0.0.1:5173', true), { applied: false, current: 'https://127.0.0.1:5173', next: 'https://127.0.0.1:5173' })
  assert.deepEqual(await origin(f.db, 5, 'https://localhost:5173', true), { applied: true, current: 'https://127.0.0.1:5173', next: 'https://localhost:5173' })
  assert.ok(f.statements[0].query.includes('version=version+1')); assert.deepEqual(f.statements[0].values, ['https://localhost:5173', 5])
  assert.ok(f.statements[1].query.includes('DEPLOYMENT_ORIGIN_CHANGED'))
  const metadata = JSON.parse(f.statements[1].values.at(-1))
  assert.match(metadata.from, /^[a-f0-9]{64}$/); assert.match(metadata.to, /^[a-f0-9]{64}$/); assert.notEqual(metadata.from, metadata.to)
  assert.ok(!f.statements[1].values.some(v => String(v).includes('localhost')))
})
