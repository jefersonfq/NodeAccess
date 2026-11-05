import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { transformWithEsbuild } from 'vite'
import libCoverage from 'istanbul-lib-coverage'
import { convertBrowserScript, overlayBrowserCoverage, browserCoverageRecords } from './browser-map.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'browser-map-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = 'apps/frontend/src/example.ts', source = 'export function choose(value: boolean) { return value ? 1 : 0 }\n'
  await mkdir(join(root, 'apps/frontend/src'), { recursive: true }); await writeFile(join(root, file), source)
  const generated = await transformWithEsbuild(source, join(root, file), { sourcemap: 'external' })
  const sourceMap = generated.map
  const code = generated.code + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(sourceMap)).toString('base64')
  const script = { url: 'http://127.0.0.1:1234/src/example.ts', source: code, codeSha256: createHash('sha256').update(code).digest('hex'),
    functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }], isBlockCoverage: true }] }
  return { root, origin: 'http://127.0.0.1:1234', script, files: [file], file, source, sourceMap, generated }
}
function replaceMap(f, edit) {
  edit(f.sourceMap)
  f.script.source = f.generated.code + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(f.sourceMap)).toString('base64')
  f.script.codeSha256 = createHash('sha256').update(f.script.source).digest('hex')
  f.script.functions[0].ranges[0].endOffset = f.script.source.length
}
test('maps executed generated JS to the exact local TS content with provenance', async t => {
  const f = await fixture(t), result = await convertBrowserScript(f)
  assert.equal(result.coverages[0].path, join(f.root, f.file)); assert.ok(Object.keys(result.coverages[0].s).length)
  assert.equal(result.provenance[0].sha256, createHash('sha256').update(f.source).digest('hex'))
})
for (const [name, edit] of [
  ['foreign origin', f => { f.script.url = 'http://127.0.0.1:4321/src/example.ts' }],
  ['traversal', f => { f.script.url = f.origin + '/src/%2e%2e/%2e%2e/secret.ts' }],
  ['hash mismatch', f => { f.script.source += ' ' }],
  ['invalid offset', f => { f.script.functions[0].ranges[0].endOffset = 1e9 }],
  ['negative hit', f => { f.script.functions[0].ranges[0].count = -1 }],
  ['missing map', f => { f.script.source = 'console.log(1)'; f.script.codeSha256 = createHash('sha256').update(f.script.source).digest('hex'); f.script.functions[0].ranges[0].endOffset = f.script.source.length }],
  ['foreign mapped path', f => replaceMap(f, map => { map.sources[0] = '/etc/passwd' })],
  ['mapped URL', f => replaceMap(f, map => { map.sources[0] = 'https://example.test/file.ts' })],
  ['sourceRoot', f => replaceMap(f, map => { map.sourceRoot = '../../' })],
  ['source content mismatch', f => replaceMap(f, map => { map.sourcesContent[0] += ' ' })],
]) test(`rejects ${name} without granting coverage`, async t => {
  const f = await fixture(t); edit(f); await assert.rejects(convertBrowserScript(f))
})
test('rejects symlinked local source and stale capture fingerprint', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'source.ts'); await writeFile(target, f.source); await rm(join(f.root, f.file)); await symlink(target, join(f.root, f.file))
  await assert.rejects(convertBrowserScript(f), /symlinked/)
  const directory = join(f.root, 'captures'); await mkdir(directory)
  await writeFile(join(directory, 'chromium-a.json'), JSON.stringify({ schemaVersion: 1, root: f.root, origin: f.origin, fingerprint: 'stale', scripts: [] }))
  await assert.rejects(browserCoverageRecords({ ...f, directory, fingerprint: 'fresh' }), /provenance/)
})
const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } }
function coverage(path, hit = 0) { return { path, statementMap: { 0: structuredClone(loc) }, s: { 0: hit },
  fnMap: { 0: { name: 'same', decl: structuredClone(loc), loc: structuredClone(loc) } }, f: { 0: hit },
  branchMap: { 0: { type: 'if', loc: structuredClone(loc), line: 1, locations: [structuredClone(loc), { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } }] } }, b: { 0: [hit, 0] } } }
test('overlay credits only matching original descriptors and preserves every authoritative denominator and zero', () => {
  const baseline = coverage('/root/first.vue'), untouched = coverage('/root/never.vue'), map = libCoverage.createCoverageMap({ [baseline.path]: baseline, [untouched.path]: untouched })
  const totals = map.getCoverageSummary().toJSON(), source = coverage(baseline.path, 1)
  source.statementMap[1] = { start: { line: 20, column: 0 }, end: { line: 20, column: 1 } }; source.s[1] = 10
  const evidence = overlayBrowserCoverage(map, [source], '/root'), result = map.getCoverageSummary().toJSON()
  for (const metric of ['lines', 'functions', 'branches', 'statements']) assert.equal(result[metric].total, totals[metric].total)
  assert.equal(map.fileCoverageFor(untouched.path).s[0], 0); assert.deepEqual(map.fileCoverageFor(baseline.path).b[0], [1, 0])
  assert.equal(evidence.unmatched.s, 1); assert.equal(result.functions.covered, 1)
})
test('incompatible and ambiguous mappings never receive credit', () => {
  const target = coverage('/root/example.vue'), map = libCoverage.createCoverageMap({ [target.path]: target }), source = coverage(target.path, 2)
  source.statementMap[1] = structuredClone(source.statementMap[0]); source.s[1] = 2
  source.fnMap[0].decl.start.column = 1; source.branchMap[0].type = 'cond-expr'
  overlayBrowserCoverage(map, [source], '/root')
  assert.deepEqual(map.fileCoverageFor(target.path).s, { 0: 0 }); assert.equal(map.fileCoverageFor(target.path).f[0], 0); assert.deepEqual(map.fileCoverageFor(target.path).b[0], [0, 0])
})

test('capture identity, expected origin and capture time bind every raw report to its collection', async t => {
  const f = await fixture(t), directory = join(f.root, 'captures'); await mkdir(directory)
  const capture = { captureRunId: '00000000-0000-4000-8000-000000000001', origin: f.origin, startedAt: '2026-11-03T12:00:00.000Z', finishedAt: '2026-11-03T12:01:00.000Z' }
  const report = { ...capture, root: f.root, schemaVersion: 1, fingerprint: 'current-source', capturedAt: '2026-11-03T12:00:30.000Z', scripts: [f.script], excluded: {} }
  const path = join(directory, 'chromium-a.json')
  await writeFile(path, JSON.stringify(report))
  assert.equal((await browserCoverageRecords({ ...f, directory, fingerprint: 'current-source', capture })).evidence.scripts, 1)
  await assert.rejects(browserCoverageRecords({ ...f, directory, fingerprint: 'current-source', capture: { ...capture, captureRunId: undefined } }), /provenance/)
  const missingIdentity = { ...report }; delete missingIdentity.captureRunId
  await writeFile(path, JSON.stringify(missingIdentity))
  await assert.rejects(browserCoverageRecords({ ...f, directory, fingerprint: 'current-source', capture: { ...capture, captureRunId: undefined } }), /provenance/)
  for (const changed of [
    { captureRunId: 'old-run' }, { origin: 'http://127.0.0.1:4321' }, { capturedAt: 'invalid' },
    { capturedAt: '2026-11-03T11:59:59.000Z' }, { capturedAt: '2026-11-03T12:01:01.000Z' }, { root: '/different' },
  ]) {
    await writeFile(path, JSON.stringify({ ...report, ...changed }))
    await assert.rejects(browserCoverageRecords({ ...f, directory, fingerprint: 'current-source', capture }), /provenance/)
  }
})
