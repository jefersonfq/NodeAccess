import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIdFor, loadConfig, sourceFiles } from './build-local.mjs'

test('NA-0190: config comes from the environment first, then the local file, with a default version', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vna-local-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'local.json')
  assert.deepEqual(loadConfig({}, file), { portalOrigin: undefined, manifestKey: undefined, version: '0.1.0' })
  writeFileSync(file, JSON.stringify({ portalOrigin: 'https://127.0.0.1:5173', manifestKey: 'K', version: '0.2.0' }))
  assert.deepEqual(loadConfig({}, file), { portalOrigin: 'https://127.0.0.1:5173', manifestKey: 'K', version: '0.2.0' })
  assert.equal(loadConfig({ VAULTNACCESS_PORTAL_ORIGIN: 'https://portal.test', VAULTNACCESS_VERSION: '' }, file).portalOrigin, 'https://portal.test')
  writeFileSync(file, '[]')
  assert.throws(() => loadConfig({}, file), /JSON object/)
})

test('NA-0190: the build id depends only on the sources and the config', () => {
  const config = { portalOrigin: 'https://p.test', manifestKey: undefined, version: '0.1.0' }
  const files = { 'a.ts': 'one', 'b.ts': 'two' }, read = f => files[f]
  const id = buildIdFor(['b.ts', 'a.ts'], read, config)
  assert.match(id, /^[a-f0-9]{12}$/)
  assert.equal(buildIdFor(['a.ts', 'b.ts'], read, config), id)
  assert.notEqual(buildIdFor(['a.ts', 'b.ts'], f => (f === 'a.ts' ? 'changed' : files[f]), config), id)
  assert.notEqual(buildIdFor(['a.ts', 'b.ts'], read, { ...config, portalOrigin: 'https://other.test' }), id)
})

test('NA-0190: sources are the tracked extension and shared files, without tests or build output', () => {
  const files = sourceFiles()
  assert.ok(files.includes('apps/extension/src/popup/App.vue'))
  assert.ok(files.some(f => f.startsWith('packages/shared/src/')))
  assert.ok(files.every(f => !f.endsWith('.test.ts') && !f.includes('/dist')))
})

test('NA-0190: without an origin it does nothing; a broken config fails only outside --soft (dev startup)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vna-main-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const script = fileURLToPath(new URL('./build-local.mjs', import.meta.url))
  const env = { ...process.env, VAULTNACCESS_PORTAL_ORIGIN: '', VAULTNACCESS_LOCAL_CONFIG: join(dir, 'missing.json') }
  const skipped = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
  assert.equal(skipped.status, 0); assert.match(skipped.stdout, /não compilada/)
  writeFileSync(join(dir, 'broken.json'), '[]')
  const broken = { ...env, VAULTNACCESS_LOCAL_CONFIG: join(dir, 'broken.json') }
  const strict = spawnSync(process.execPath, [script], { env: broken, encoding: 'utf8' })
  assert.equal(strict.status, 1); assert.match(strict.stderr, /falha ao compilar/)
  assert.equal(spawnSync(process.execPath, [script, '--soft'], { env: broken, encoding: 'utf8' }).status, 0)
})
