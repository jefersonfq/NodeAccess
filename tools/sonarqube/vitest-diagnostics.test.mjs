import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vitestDiagnostics } from './vitest-diagnostics.mjs'
import { coverageDiagnostics } from './ci-coverage-diagnostics.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vitest-diagnostic-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'coverage'))
  mkdirSync(join(root, 'apps'), { recursive: true })
  const source = 'apps/example.test.ts'
  writeFileSync(join(root, source), "import { test, expect } from 'vitest'; test('static name', () => expect(1).toBe(2))")
  execFileSync('git', ['init', '--quiet', root])
  execFileSync('git', ['-C', root, 'add', source])
  return { root, source, report: join(root, 'coverage/vitest-tests.json'),
    write: value => writeFileSync(join(root, 'coverage/vitest-tests.json'), JSON.stringify(value)) }
}
function report(name, assertions = [{ status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2'] }]) {
  return { success: false, numFailedTests: assertions.length, testResults: [{ name, assertionResults: assertions }] }
}

test('failed assertion is actionable through tracked source and report ordinal', t => {
  const f = fixture(t)
  f.write(report(join(f.root, f.source), [{ status: 'passed' }, { status: 'failed', title: 'dynamic PRIVATE', failureMessages: ['AssertionError: PRIVATE'] }]))
  const expected = { reportRead: 'parsed', failures: [{ source: f.source, sourceVerified: true, suiteIndex: 1, testIndex: 2, errorCategory: 'ASSERTION' }], truncated: false }
  assert.deepEqual(vitestDiagnostics(f.root), expected)
  writeFileSync(join(f.root, 'coverage/summary.json'), JSON.stringify({ failures: ['VITEST_TESTS_FAILED'], collectors: { vitest: { failed: 1 } } }))
  assert.deepEqual(coverageDiagnostics(f.root).vitest, expected)
})

test('dynamic titles, suite names, messages, stack, values and credentials never escape', t => {
  const f = fixture(t), secret = 'PRIVATE-credential-123'
  f.write({ ...report(f.source, [{ status: 'failed', title: secret, fullName: secret, ancestorTitles: [secret],
    failureMessages: [`TypeError: ${secret}`], failureDetails: [{ stack: secret, expected: secret, actual: secret }], location: { line: secret } }]), [secret]: secret })
  const result = vitestDiagnostics(f.root)
  assert.equal(result.failures[0].errorCategory, 'TYPE_ERROR')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|credential|stack|expected|actual|title|fullName|ancestorTitles/)
  for (const name of [`/private/${secret}.test.ts`, `apps/${secret}.test.ts`, '../apps/example.test.ts', 'apps/../apps/example.test.ts', `${f.root}/../PRIVATE.test.ts`]) {
    f.write(report(name))
    assert.deepEqual(vitestDiagnostics(f.root).failures, [{ sourceVerified: false, suiteIndex: 1, testIndex: 1, errorCategory: 'ASSERTION' }])
  }
})

test('missing, linked, directory and oversized reports fail closed', t => {
  const f = fixture(t)
  assert.equal(vitestDiagnostics(f.root).reportRead, 'missing')
  symlinkSync(join(f.root, f.source), f.report)
  assert.equal(vitestDiagnostics(f.root).reportRead, 'not_regular')
  rmSync(f.report)
  mkdirSync(f.report)
  assert.equal(vitestDiagnostics(f.root).reportRead, 'not_regular')
  rmSync(f.report, { recursive: true })
  writeFileSync(f.report, 'PRIVATE'.repeat(1200000))
  assert.equal(vitestDiagnostics(f.root).reportRead, 'too_large')
  rmSync(join(f.root, 'coverage'), { recursive: true })
  symlinkSync(join(f.root, 'apps'), join(f.root, 'coverage'))
  assert.equal(vitestDiagnostics(f.root).reportRead, 'not_regular')
})

for (const input of ['{"testResults": [', 'PRIVATE', 'null', '{}', '{"testResults":{}}']) {
  test('invalid and truncated reports publish no content', t => {
    const f = fixture(t)
    writeFileSync(f.report, input)
    assert.deepEqual(vitestDiagnostics(f.root), { reportRead: 'invalid' })
  })
}

test('only fixed categories survive and malformed assertions are ignored', t => {
  const f = fixture(t)
  f.write(report(f.source, [null, { status: 'PRIVATE' }, ...['ReferenceError: PRIVATE', 'SyntaxError: PRIVATE', 'Error: PRIVATE', 'AssertionErrorPRIVATE: secret'].map(message => ({ status: 'failed', failureMessages: [message] })), { status: 'failed', failureMessages: { 0: {} } }]))
  assert.deepEqual(vitestDiagnostics(f.root).failures.map(entry => entry.errorCategory), ['REFERENCE_ERROR', 'SYNTAX_ERROR', 'UNCLASSIFIED', 'UNCLASSIFIED', 'UNCLASSIFIED'])
})

test('bounded output reports truncation and unavailable git metadata never trusts report paths', t => {
  const f = fixture(t)
  f.write(report(f.source, Array.from({ length: 51 }, () => ({ status: 'failed' }))))
  let result = vitestDiagnostics(f.root)
  assert.equal(result.failures.length, 50)
  assert.equal(result.truncated, true)
  rmSync(join(f.root, '.git'), { recursive: true })
  f.write(report(f.source))
  result = vitestDiagnostics(f.root)
  assert.equal(result.failures[0].sourceVerified, false)
  assert.equal(result.failures[0].source, undefined)
})

test('report scanning is capped even without failures', t => {
  const f = fixture(t)
  f.write(report(f.source, Array.from({ length: 50001 }, () => ({ status: 'passed' }))))
  assert.deepEqual(vitestDiagnostics(f.root), { reportRead: 'parsed', failures: [], truncated: true })
  f.write({ testResults: Array.from({ length: 10001 }, () => ({})) })
  assert.equal(vitestDiagnostics(f.root).truncated, true)
})


test('suite loading failures retain source identity without error messages', t => {
  const f = fixture(t)
  f.write({ testResults: [{ name: f.source, status: 'failed', message: 'PRIVATE', assertionResults: [] }] })
  assert.deepEqual(vitestDiagnostics(f.root).failures, [{ source: f.source, sourceVerified: true, suiteIndex: 1, errorCategory: 'SUITE_FAILED' }])
})
