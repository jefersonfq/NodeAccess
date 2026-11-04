import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const { parseHarnessDiagnostic, sanitizeHarnessDiagnostic, readHarnessDiagnostic } = createRequire(import.meta.url)('./harness-diagnostics.cjs')
const scripts = ['sonar-frontend-review.cjs', 'table-review.cjs', 'terminal-experience-playwright.cjs', 'platform-settings-playwright.cjs', 'sonar-flow-coverage.cjs']
test('all allowed script frames yield only class and bounded coordinates', () => {
  for (const name of scripts) {
    const result = parseHarnessDiagnostic(`AssertionError [ERR_ASSERTION]: PRIVATE selector\n    at main (/PRIVATE/${name}:123:45)\n    at /secret/other.cjs:1:1`, `tools/${name}`)
    assert.deepEqual(result, { category: 'ASSERTION', line: 123, column: 45 })
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|selector|secret|\.cjs/)
  }
  assert.deepEqual(parseHarnessDiagnostic('TimeoutError: private\n    at /private/table-review.cjs:8:2', 'table-review.cjs'), { category: 'TIMEOUT', line: 8, column: 2 })
  assert.deepEqual(parseHarnessDiagnostic('TypeError: private\n    at /private/table-review.cjs:8:2', 'table-review.cjs'), { category: 'OTHER', line: 8, column: 2 })
})
test('unexpected names, malformed frames and injected diagnostic fields cannot escape the allowlist', () => {
  for (const frame of ['    at /tmp/evil-table-review.cjs:2:3', '/tmp/table-review.cjs:2:3', '    at /tmp/table-review.cjs:0:3', '    at /tmp/table-review.cjs:9999999:3']) assert.equal(parseHarnessDiagnostic(frame, 'table-review.cjs'), undefined)
  assert.equal(parseHarnessDiagnostic('    at /tmp/secret.cjs:2:3', 'secret.cjs'), undefined)
  for (const value of [null, { category: 'SECRET', line: 1, column: 1 }, { category: 'OTHER', line: 'secret', column: 1 }, { category: 'OTHER', line: 1, column: -1 }]) assert.equal(sanitizeHarnessDiagnostic(value), undefined)
  assert.deepEqual(sanitizeHarnessDiagnostic({ category: 'OTHER', line: 1, column: 2, message: 'SECRET' }), { category: 'OTHER', line: 1, column: 2 })
})
test('bounded reader refuses symlink, directory, absent and excessive logs', t => {
  const root = mkdtempSync(join(tmpdir(), 'harness-diagnostic-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'log'), alias = join(root, 'alias')
  assert.equal(readHarnessDiagnostic(file, scripts[0]), undefined)
  assert.equal(readHarnessDiagnostic(root, scripts[0]), undefined)
  writeFileSync(file, `Error: PRIVATE\n    at /private/${scripts[0]}:3:4`)
  symlinkSync(file, alias); assert.equal(readHarnessDiagnostic(alias, scripts[0]), undefined)
  assert.deepEqual(readHarnessDiagnostic(file, scripts[0]), { category: 'OTHER', line: 3, column: 4 })
  writeFileSync(file, 'x'.repeat(65537)); assert.equal(readHarnessDiagnostic(file, scripts[0]), undefined)
})
test('real failed child assertion stays failed while its stack is safely projected', t => {
  const root = mkdtempSync(join(tmpdir(), 'harness-diagnostic-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, scripts[0]), log = join(root, 'private.log')
  writeFileSync(file, "require('node:assert/strict').equal('PRIVATE-A', 'PRIVATE-B')")
  const child = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 3000 })
  assert.equal(child.status, 1)
  writeFileSync(log, child.stderr, { mode: 0o600 })
  const result = readHarnessDiagnostic(log, scripts[0])
  assert.equal(result.category, 'ASSERTION'); assert.equal(result.line, 1); assert.ok(result.column > 0)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|tmp|assert|\.cjs/)
})
