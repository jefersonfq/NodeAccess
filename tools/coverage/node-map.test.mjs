import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { nodeCoverageMap, normalizeBranchCounts, nativeTypeScriptProvenance } from './node-map.mjs'

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
  await assert.rejects(nodeCoverageMap({ root, directory: root, files: ['source.ts'] }), /producer identity missing/)
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


async function typedFixture(t, { source, extension = 'mts', flags = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'na0203-native-ts-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const directory = join(root, 'raw'); mkdirSync(directory)
  const file = 'typed.' + extension
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(join(root, file), source ?? [
    'type Label = "😀" | "no"',
    'export function choose(value: boolean): number {',
    '  if (value) return 1',
    '  return 2',
    '}',
    'choose(true)',
    '',
  ].join('\r\n'))
  const nativeTypeScript = await nativeTypeScriptProvenance(root, [file])
  const manifest = join(root, 'manifest.json'); writeFileSync(manifest, JSON.stringify(nativeTypeScript))
  const env = { ...process.env, NODE_V8_COVERAGE: directory, NODEACCESS_NATIVE_TS_PROVENANCE: manifest,
    NODE_OPTIONS: `--import=${new URL('./native-ts-source.mjs', import.meta.url).href}` }
  const run = spawnSync(process.execPath, [...flags, join(root, file)], { env, encoding: 'utf8', timeout: 15000 })
  assert.equal(run.status, 0, run.stderr)
  const artifact = readdirSync(directory).find(name => /^coverage-.*\.json$/.test(name))
  const artifactPath = join(directory, artifact)
  const data = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const script = data.result.find(entry => entry.url === pathToFileURL(join(root, file)).href)
  assert.ok(script, 'real V8 must include the typed module')
  return { root, directory, files: [file], nativeTypeScript, data, script, artifactPath, sourcePath: join(root, file) }
}

for (const extension of ['ts', 'mts']) test(`converts native ${extension} erasure with UTF-16/CRLF positions and an uncovered branch`, async t => {
  const f = await typedFixture(t, { extension })
  const map = await nodeCoverageMap(f), coverage = map.fileCoverageFor(f.sourcePath)
  const lines = coverage.getLineCoverage()
  assert.ok(lines[3] > 0); assert.equal(lines[4], 0)
  assert.equal(lines[1], undefined, 'erased type is not executable')
  assert.ok(Object.values(coverage.f).some(count => count > 0))
  const summary = map.getCoverageSummary().toJSON()
  assert.ok(summary.branches.covered < summary.branches.total)
  assert.ok(Object.values(coverage.statementMap).every(location => location.end.line <= 6), 'sourceURL suffix cannot become executable')
})

test('native TS rejects missing provenance, foreign runtime, transform mode and same-length stale source', async t => {
  const f = await typedFixture(t)
  await assert.rejects(nodeCoverageMap({ ...f, nativeTypeScript: undefined }), /executed source proof invalid/)
  await assert.rejects(nodeCoverageMap({ ...f, nativeTypeScript: { ...f.nativeTypeScript, nodeVersion: '24.22.0' } }), /executed source proof invalid/)
  await assert.rejects(nodeCoverageMap({ ...f, nativeTypeScript: { ...f.nativeTypeScript, mode: 'transform' } }), /Unsupported native/)
  const original = readFileSync(f.sourcePath, 'utf8')
  writeFileSync(f.sourcePath, original.replace('return 1', 'return 9'))
  assert.equal(readFileSync(f.sourcePath, 'utf8').length, original.length)
  await assert.rejects(nodeCoverageMap(f), /source provenance mismatch/)
})

test('rejects real transformed enum coverage instead of assigning generated offsets to TS', async t => {
  const f = await typedFixture(t, { source: 'enum State { Ready, Done }\nconsole.log(State.Ready)\n', flags: ['--experimental-transform-types'] })
  await assert.rejects(nodeCoverageMap(f), /Unsupported native/)
})

test('rejects unknown source maps and corrupt TS offsets in any artifact before merging', async t => {
  const f = await typedFixture(t)
  const save = data => writeFileSync(f.artifactPath, JSON.stringify(data))
  const original = JSON.stringify(f.data)
  f.data['source-map-cache'] = { [f.script.url]: { data: { version: 3, mappings: '' } } }
  save(f.data); await assert.rejects(nodeCoverageMap(f), /Unsupported native/)
  save(JSON.parse(original))
  // A second corrupt process must fail even when the first process has valid ranges.
  const bad = JSON.parse(original), script = bad.result.find(entry => entry.url === f.script.url)
  script.functions[0].ranges[0].endOffset--
  const corruptPath = f.artifactPath.replace(/-(\d+)-(\d+)\.json$/, (_, stamp, thread) => `-${Number(stamp) + 1}-${thread}.json`)
  writeFileSync(corruptPath, JSON.stringify(bad))
  await assert.rejects(nodeCoverageMap(f), /root offsets mismatch/)
  rmSync(corruptPath)
  script.functions[0].ranges[0].endOffset++
  script.functions[1].ranges[0].endOffset = script.functions[0].ranges[0].endOffset
  save(bad); await assert.rejects(nodeCoverageMap(f), /offsets\/counts invalid/)
})

test('rejects a modified sourceURL suffix shape even with otherwise matching source provenance', async t => {
  const f = await typedFixture(t)
  f.script.functions[0].ranges[0].endOffset += 1
  writeFileSync(f.artifactPath, JSON.stringify(f.data))
  await assert.rejects(nodeCoverageMap(f), /root offsets mismatch/)
})


test('rejects typed ranges without an executed native strip loader in that producer artifact', async t => {
  const f = await typedFixture(t)
  f.data.result = f.data.result.filter(script => script.url !== 'node:internal/modules/typescript')
  writeFileSync(f.artifactPath, JSON.stringify(f.data))
  await assert.rejects(nodeCoverageMap(f), /Unsupported native/)
})
