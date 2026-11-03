import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nodeCoverageMap, normalizeBranchCounts } from './node-map.mjs'

test('converts real Node ranges and preserves an unexecuted branch without counting outside dependencies', async t => {
  const root = mkdtempSync(join(tmpdir(), 'na0090-node-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = join(root, 'raw'); mkdirSync(directory)
  writeFileSync(join(root, 'code.cjs'), 'function choose(value) { if (value) return 1; return 2 }\nchoose(true)\n')
  const run = spawnSync(process.execPath, [join(root, 'code.cjs')], { env: { ...process.env, NODE_V8_COVERAGE: directory }, encoding: 'utf8' })
  assert.equal(run.status, 0)
  const map = await nodeCoverageMap({ root, directory, files: ['code.cjs'] })
  assert.deepEqual(map.files(), [join(root, 'code.cjs')])
  const summary = map.getCoverageSummary().toJSON()
  assert.ok(summary.branches.covered < summary.branches.total)
  assert.ok(summary.functions.covered > 0)
  await assert.rejects(nodeCoverageMap({ root, directory: join(root, 'missing'), files: [] }))
})
test('rejects coverage offsets that cannot correspond to the current source', async t => {
  const root = mkdtempSync(join(tmpdir(), 'na0090-invalid-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'code.cjs'), 'true')
  writeFileSync(join(root, 'coverage-invalid.json'), JSON.stringify({ result: [{ scriptId: '1', url: new URL('file://' + join(root, 'code.cjs')).href,
    functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 9999, count: 1 }] }] }] }))
  await assert.rejects(nodeCoverageMap({ root, directory: root, files: ['code.cjs'] }), /offsets/)
})

test('records upstream negative implicit-else counts as uncovered without removing branches', async t => {
  const root = mkdtempSync(join(tmpdir(), 'na0090-negative-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = join(root, 'raw'); mkdirSync(directory)
  // Replay the existing real policy suite in a disposable copy. All DNS is injected.
  for (const filename of ['access-policy.js', 'connection-security.js', 'agent-security.test.js']) {
    writeFileSync(join(root, filename), readFileSync(new URL(`../../apps/agent/src/${filename}`, import.meta.url)))
  }
  const run = spawnSync(process.execPath, [join(root, 'agent-security.test.js')], {
    env: { ...process.env, NODE_V8_COVERAGE: directory }, encoding: 'utf8', timeout: 15000,
  })
  assert.equal(run.status, 0)
  const anomalies = []
  const map = await nodeCoverageMap({ root, directory, files: ['access-policy.js'], anomalies })
  assert.ok(anomalies.length > 0, 'real nested callback fixture must reproduce upstream subtraction defect')
  for (const anomaly of anomalies) {
    assert.ok(anomaly.rawCount < 0)
    assert.equal(anomaly.normalized, 0)
    assert.equal(anomaly.converterVersion, 'ast-v8-to-istanbul@1.0.7')
    assert.equal(map.fileCoverageFor(join(root, anomaly.file)).b[anomaly.branchId][anomaly.index], 0)
  }
  const summary = map.getCoverageSummary().toJSON()
  assert.ok(summary.branches.total > summary.branches.covered)
  assert.ok(Object.values(map.fileCoverageFor(join(root, 'access-policy.js')).b).flat().every(count => count >= 0))
})

test('rejects missing artifacts, malformed V8 result and unsupported native transforms', async t => {
  const root = mkdtempSync(join(tmpdir(), 'na0090-v8-invalid-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  await assert.rejects(nodeCoverageMap({ root, directory: root, files: [] }), /not produced/)
  const artifact = join(root, 'coverage-fixture.json')
  writeFileSync(artifact, JSON.stringify({ result: {} }))
  await assert.rejects(nodeCoverageMap({ root, directory: root, files: [] }), /Invalid Node/)
  writeFileSync(join(root, 'source.ts'), 'const typed: number = 1')
  writeFileSync(artifact, JSON.stringify({ result: [{ scriptId: '1', url: new URL('file://' + join(root, 'source.ts')).href,
    functions: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 22, count: 1 }] }] }] }))
  await assert.rejects(nodeCoverageMap({ root, directory: root, files: ['source.ts'] }), /Unsupported native/)
})

test('conservative normalization preserves every branch and all positive/zero counts for either collector', () => {
  const sample = { path: '/project/tools/a.mjs', b: { 0: [2, -1, 0] }, branchMap: { 0: { line: 12 } } }
  const anomalies = []
  const coveredBefore = sample.b[0].filter(count => count > 0).length
  normalizeBranchCounts([sample], '/project', anomalies, 'vitest')
  assert.deepEqual(sample.b[0], [2, 0, 0])
  assert.equal(sample.b[0].filter(count => count > 0).length, coveredBefore)
  assert.deepEqual(anomalies, [{ file: 'tools/a.mjs', line: 12, collector: 'vitest', branchId: '0', index: 1,
    rawCount: -1, normalized: 0, converterVersion: 'ast-v8-to-istanbul@1.0.7' }])
  sample.b[0][0] = NaN
  assert.throws(() => normalizeBranchCounts([sample], '/project', [], 'node'), /Invalid converted/)
})
