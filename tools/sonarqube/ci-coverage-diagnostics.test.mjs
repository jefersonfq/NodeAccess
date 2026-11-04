import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coverageDiagnostics } from './ci-coverage-diagnostics.mjs'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'coverage-diagnostic-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'coverage'))
  return { root, write: value => writeFileSync(join(root, 'coverage/summary.json'), JSON.stringify(value)) }
}
test('missing, empty and nonregular artifacts are explicit without paths', t => {
  const f = fixture(t)
  assert.deepEqual(coverageDiagnostics(f.root), { artifacts: { lcov: 'missing', summary: 'missing' } })
  writeFileSync(join(f.root, 'coverage/lcov.info'), '')
  symlinkSync('/not-a-report', join(f.root, 'coverage/summary.json'))
  assert.deepEqual(coverageDiagnostics(f.root), { artifacts: { lcov: 'empty', summary: 'not_regular' } })
})
test('collector codes and counts survive while tokens, paths and arbitrary messages do not', t => {
  const f = fixture(t), secret = 'private-token-and-path'
  f.write({ status: 'failed', failures: ['BROWSER_TESTS_FAILED', 'COVERAGE_PIPELINE_FAILED', secret],
    error: `ENOENT: ${secret}`, extra: secret, collectors: {
      vitest: { exitCode: 0, passed: 12, failed: 0, skipped: 1, stdout: secret },
      node: { exitCode: 1, testFiles: 4 }, browser: { exitCode: 1, status: 'failed', harnesses: [{ name: secret, error: secret }] },
      [secret]: { exitCode: 1 },
    } })
  const result = coverageDiagnostics(f.root)
  assert.deepEqual(result.collectors, { vitest: { exitCode: 0, passed: 12, failed: 0, skipped: 1 }, node: { exitCode: 1, testFiles: 4 }, browser: { exitCode: 1, status: 'failed', errorCategory: 'UNCLASSIFIED', harnesses: [] } })
  assert.deepEqual(result.failures, ['BROWSER_TESTS_FAILED', 'COVERAGE_PIPELINE_FAILED'])
  assert.equal(result.hasUnrecognizedFailures, true)
  assert.equal(result.errorCategory, 'FILE_MISSING')
  assert.equal(JSON.stringify(result).includes(secret), false)
})
test('malicious status, numeric strings and error objects never propagate', t => {
  const f = fixture(t)
  f.write({ status: 'secret', failures: 'secret', error: { secret: 'token' }, collectors: { vitest: { exitCode: 256, passed: -1, failed: 'secret', skipped: 1.5, testFiles: 1e100, status: 'secret' } } })
  const result = coverageDiagnostics(f.root)
  assert.equal(result.status, 'unknown'); assert.deepEqual(result.collectors.vitest, {})
  assert.equal(result.errorCategory, 'UNCLASSIFIED'); assert.doesNotMatch(JSON.stringify(result), /secret|token/)
})
for (const [input, expected] of [['EACCES: private-path', 'FILE_ACCESS_DENIED'], ['EPERM: private-path', 'FILE_ACCESS_DENIED'], ['Chromium coverage was not produced', 'BROWSER_COVERAGE_MISSING'], ['Chromium capture provenance invalid', 'BROWSER_PROVENANCE_INVALID'], ['arbitrary token', 'UNCLASSIFIED']]) {
  test(`diagnostic maps known error category ${expected}`, t => {
    const f = fixture(t); f.write({ status: 'passed', error: input })
    assert.equal(coverageDiagnostics(f.root).errorCategory, expected)
  })
}
test('invalid or excessive JSON does not publish bytes or block cleanup', t => {
  const f = fixture(t), file = join(f.root, 'coverage/summary.json')
  writeFileSync(file, 'secret invalid JSON'); assert.equal(coverageDiagnostics(f.root).summaryRead, 'invalid')
  writeFileSync(file, 's'.repeat(2 * 1024 * 1024 + 1)); assert.equal(coverageDiagnostics(f.root).summaryRead, 'too_large')
  writeFileSync(file, 'null'); assert.equal(coverageDiagnostics(f.root).status, 'unknown')
})

test('browser phases and five known harnesses retain actionable facts without free text', t => {
  const f = fixture(t)
  f.write({ collectors: { browser: { phase: 'harness', error: 'Browser coverage harness failed: frontend',
    harnesses: [{ name: 'frontend', exitCode: 1, timedOut: false, error: 'private-token' },
      { name: 'unknown-private-path', exitCode: 2 }, { name: 'terminal', exitCode: 0, timedOut: true },
      { name: 'frontend', exitCode: 99 }, { name: 'flows', exitCode: 'secret', timedOut: 'secret' }] } } })
  const result = coverageDiagnostics(f.root).collectors.browser
  assert.deepEqual(result, { phase: 'harness', errorCategory: 'BROWSER_HARNESS_FAILED', harnesses: [
    { name: 'frontend', exitCode: 1, timedOut: false }, { name: 'terminal', exitCode: 0, timedOut: true }, { name: 'flows' }] })
  assert.doesNotMatch(JSON.stringify(result), /private|secret|99/)
  f.write({ collectors: { browser: { phase: 'private-path', error: 'Browser coverage harness failed: private-token', harnesses: [null] } } })
  assert.deepEqual(coverageDiagnostics(f.root).collectors.browser, { errorCategory: 'UNCLASSIFIED', harnesses: [] })
})
for (const [error, category] of [
  ['Browser fixture dependencies did not become ready', 'BROWSER_DEPENDENCIES_NOT_READY'],
  ['Browser fixture must bind loopback', 'BROWSER_BIND_NOT_LOOPBACK'],
  ['Browser fixture cleanup failed', 'BROWSER_CLEANUP_FAILED'],
]) test(`browser error maps exact category ${category}`, t => {
  const f = fixture(t); f.write({ collectors: { browser: { error } } })
  assert.equal(coverageDiagnostics(f.root).collectors.browser.errorCategory, category)
})

test('flow failure retains only known stage and class through CI projection', t => {
  const f = fixture(t)
  f.write({ collectors: { browser: { harnesses: [{ name: 'flows', exitCode: 1, timedOut: false, failure: { stage: 'hosts-destination', category: 'ASSERTION', message: 'PRIVATE', stack: 'PRIVATE' } }] } } })
  assert.deepEqual(coverageDiagnostics(f.root).collectors.browser.harnesses, [{ name: 'flows', exitCode: 1, timedOut: false, failure: { stage: 'hosts-destination', category: 'ASSERTION' } }])
  f.write({ collectors: { browser: { harnesses: [{ name: 'flows', failure: { stage: 'PRIVATE', category: 'OTHER' } }, { name: 'frontend', failure: { stage: 'setup', category: 'OTHER' } }] } } })
  assert.deepEqual(coverageDiagnostics(f.root).collectors.browser.harnesses, [{ name: 'frontend' }, { name: 'flows' }])
})
