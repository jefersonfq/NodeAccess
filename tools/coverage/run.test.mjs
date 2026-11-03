import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sourceInventory, sourceFingerprint } from './inventory.mjs'
import { requiredBrowserHarnesses } from './browser.mjs'
import { runCoverage, argumentsForCoverage } from './run.mjs'


function fileCoverage(path, hits = 1) {
  return { path, statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } } }, s: { 0: hits },
    fnMap: { 0: { name: 'fixture', decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } }, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } } } }, f: { 0: hits },
    branchMap: { 0: { type: 'if', line: 1, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } }, locations: [{ start: { line: 1, column: 0 }, end: { line: 1, column: 15 } }, { start: { line: 1, column: 16 }, end: { line: 1, column: 30 } }] } }, b: { 0: [hits, hits] } }
}
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'na0090-pipeline-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = 'apps/backend/src/modules/demo/demo.service.ts'
  mkdirSync(join(root, 'apps/backend/src/modules/demo'), { recursive: true }); mkdirSync(join(root, 'tools'))
  const browserFile = 'apps/frontend/src/example.ts', browserSource = 'export const browser = 1\n'
  mkdirSync(join(root, 'apps/frontend/src'), { recursive: true }); writeFileSync(join(root, browserFile), browserSource)
  writeFileSync(join(root, source), 'export function fixture() { return 1 }\n')
  writeFileSync(join(root, 'tools/demo.test.mjs'), '// Test fixture only\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '-qm', 'fixture'], { cwd: root })
  const calls = []
  const execute = (_root, args, env) => {
    calls.push(args)
    assert.equal(env.SONAR_TOKEN, undefined); assert.equal(env.SONAR_REVIEW_TOKEN, undefined)
    if (args.includes('--coverage')) {
      assert.equal(env.NODEACCESS_COVERAGE_COLLECT, '1')
      mkdirSync(join(root, 'coverage/vitest'), { recursive: true })
      writeFileSync(join(root, 'coverage/vitest/coverage-final.json'), JSON.stringify({ [join(root, browserFile)]: fileCoverage(join(root, browserFile)), [join(root, source)]: fileCoverage(join(root, source), options.lowCoverage ? 0 : 1), ...(options.jsonData ? { [join(root, 'tools/data.json')]: fileCoverage(join(root, 'tools/data.json')) } : {}) }))
      writeFileSync(join(root, 'coverage/vitest-tests.json'), JSON.stringify({ success: true, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, ...options.report }))
      return options.vitestFailure ? 1 : 0
    }
    assert.equal(env.NODE_V8_COVERAGE, join(root, 'coverage/node-v8'))
    if (args[0].endsWith('/tools/coverage/browser.mjs')) {
      mkdirSync(join(root, 'coverage/browser/chromium-v8'), { recursive: true })
      const sourceMap = { version: 3, sources: ['example.ts'], sourcesContent: [browserSource], names: [], mappings: 'AAAA' }
      const code = browserSource + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(sourceMap)).toString('base64')
      const capture = { captureRunId: '00000000-0000-4000-8000-000000000001', origin: 'http://127.0.0.1:1234', startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: new Date(Date.now() + 1000).toISOString() }
      writeFileSync(join(root, 'coverage/browser/chromium-v8/chromium-a.json'), JSON.stringify({ ...capture, root, schemaVersion: 1, fingerprint: sourceFingerprint(root, sourceInventory(root)), capturedAt: new Date().toISOString(), excluded: {}, scripts: [{ url: capture.origin + '/src/example.ts', source: code, codeSha256: createHash('sha256').update(code).digest('hex'), functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }] }] }] }))
      writeFileSync(join(root, 'coverage/browser/summary.json'), JSON.stringify({ ...capture, status: options.browserFailure ? 'failed' : 'passed',
        harnesses: options.invalidBrowser ? [] : requiredBrowserHarnesses.map(([name]) => ({ name, exitCode: 0, timedOut: false })) }))
      return options.browserFailure ? 1 : 0
    }
    writeFileSync(join(root, 'coverage/node-v8/coverage-fixture.json'), JSON.stringify({ result: [] }))
    if (options.sourceDrift) writeFileSync(join(root, source), 'changed after collection\n')
    return options.nodeFailure ? 1 : 0
  }
  return { root, execute, calls, source }
}
test('aggregate pipeline writes fresh LCOV, preserves legacy gates and strips Sonar credentials', async t => {
  const f = fixture(t)
  const result = await runCoverage({ ...f, env: { SONAR_TOKEN: 'synthetic-a', SONAR_REVIEW_TOKEN: 'synthetic-b' } })
  assert.equal(result.status, 'passed'); assert.equal(result.legacy.passed, true)
  assert.equal(result.newCoverage.status, 'not_requested'); assert.equal(f.calls.length, 3)
  assert.match(readFileSync(join(f.root, 'coverage/lcov.info'), 'utf8'), /SF:apps\/backend/)
  assert.equal(JSON.parse(readFileSync(join(f.root, 'coverage/summary.json'))).head, result.head)
})
for (const [scenario, options, expected] of [
  ['Vitest failure', { vitestFailure: true }, 'VITEST_TESTS_FAILED'],
  ['Node failure', { nodeFailure: true }, 'NODE_TESTS_FAILED'],
  ['browser failure', { browserFailure: true }, 'BROWSER_TESTS_FAILED'],
  ['unverified browser result', { invalidBrowser: true }, 'BROWSER_RESULT_NOT_VERIFIED'],
  ['source drift', { sourceDrift: true }, 'SOURCE_CHANGED_DURING_COVERAGE'],
  ['legacy deficit', { lowCoverage: true }, 'LEGACY_LINES_BELOW_70'],
]) test(`aggregate never overrides ${scenario}`, async t => {
  const f = fixture(t, options), result = await runCoverage(f)
  assert.equal(result.status, 'failed'); assert.ok(result.failures.includes(expected))
})
test('invalid base is rejected before collectors and command options cannot override thresholds', async t => {
  const f = fixture(t), result = await runCoverage({ ...f, base: 'deadbee' })
  assert.equal(result.status, 'failed'); assert.equal(f.calls.length, 0)
  assert.deepEqual(argumentsForCoverage([]), {})
  assert.deepEqual(argumentsForCoverage(['--base', 'deadbee']), { base: 'deadbee' })
  assert.throws(() => argumentsForCoverage(['--threshold', '0']))
})

for (const report of [{ success: false }, { numPassedTests: 0 }, { numPassedTests: null }]) {
  test(`rejects unverifiable test results ${JSON.stringify(report)}`, async t => {
    const f = fixture(t, { report }), result = await runCoverage(f)
    assert.equal(result.status, 'failed'); assert.ok(result.failures.includes('VITEST_RESULT_NOT_VERIFIED'))
  })
}
test('base-aware run fails on uncovered additions and records a verified passing diff', async t => {
  const f = fixture(t)
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim()
  let result = await runCoverage({ ...f, base })
  assert.equal(result.status, 'passed'); assert.equal(result.newCoverage.percent, 100)
  writeFileSync(join(f.root, 'tools/missing.mjs'), 'export const untested = true')
  result = await runCoverage({ ...f, base })
  assert.equal(result.status, 'failed'); assert.ok(result.failures.includes('NEW_COVERAGE_BELOW_80_OR_INCOMPLETE'))
  assert.deepEqual(result.newCoverage.missing, ['tools/missing.mjs'])
})
test('missing Node suites and corrupted artifacts fail closed', async t => {
  const f = fixture(t)
  rmSync(join(f.root, 'tools/demo.test.mjs'))
  let result = await runCoverage(f)
  assert.equal(result.status, 'failed'); assert.match(result.error, /No Node test/)
  const g = fixture(t)
  result = await runCoverage({ ...g, execute(...args) {
    const code = g.execute(...args)
    if (args[1].includes('--test')) writeFileSync(join(g.root, 'coverage/node-v8/coverage-fixture.json'), '{broken')
    return code
  } })
  assert.equal(result.status, 'failed'); assert.ok(result.failures.includes('COVERAGE_PIPELINE_FAILED'))
})
test('real subprocess collector failures remain visible and produce a failure summary', async t => {
  const f = fixture(t)
  // No fake Vitest executable exists: the actual Node subprocess must fail.
  const result = await runCoverage({ root: f.root })
  assert.equal(result.status, 'failed'); assert.equal(result.collectors.vitest.exitCode, 1)
  assert.ok(result.failures.includes('VITEST_TESTS_FAILED'))
  assert.match(readFileSync(join(f.root, 'coverage/vitest.log'), 'utf8'), /MODULE_NOT_FOUND/)
})

test('Vite JSON import data is explicitly listed separately, while every executable source remains required', async t => {
  const f = fixture(t, { jsonData: true }), result = await runCoverage(f)
  assert.equal(result.status, 'passed')
  assert.deepEqual(result.dataArtifacts, ['tools/data.json'])
  assert.equal(result.inventory.count, result.inventory.reportedCount)
  assert.deepEqual(result.inventory.missing, [])
  assert.doesNotMatch(readFileSync(join(f.root, 'coverage/lcov.info'), 'utf8'), /data.json/)
})
