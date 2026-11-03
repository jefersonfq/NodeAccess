import test from 'node:test'
import assert from 'node:assert/strict'
import libCoverage from 'istanbul-lib-coverage'
import { summarizeCoverage, mergeCollectorMaps } from './summary.mjs'
export function fileCoverage(path, hits = 1) {
  return { path, statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } } }, s: { 0: hits },
    fnMap: { 0: { name: 'fixture', decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } }, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } } } }, f: { 0: hits },
    branchMap: { 0: { type: 'if', line: 1, loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } }, locations: [{ start: { line: 1, column: 0 }, end: { line: 1, column: 15 } }, { start: { line: 1, column: 16 }, end: { line: 1, column: 30 } }] } }, b: { 0: [hits, hits] } }
}
test('legacy gates cannot be diluted by coverage in frontend or tools', () => {
  const legacy = 'apps/backend/src/modules/x/x.service.ts', other = 'apps/frontend/src/component.vue'
  const map = libCoverage.createCoverageMap({})
  map.addFileCoverage(fileCoverage('/project/' + legacy, 0)); map.addFileCoverage(fileCoverage('/project/' + other, 10))
  const result = summarizeCoverage(map, '/project', [legacy, other])
  assert.equal(result.legacy.passed, false); assert.equal(result.legacy.count, 1)
  assert.equal(result.global.lines.pct, 50); assert.equal(result.globalIsInformational, true)
  assert.equal(result.legacy.summary.lines.pct, 0)
  assert.equal(result.failures.length, 3)
})
test('missing source or missing legacy denominator fails closed', () => {
  const map = libCoverage.createCoverageMap({})
  const result = summarizeCoverage(map, '/project', ['apps/backend/src/modules/x/x.service.ts'])
  assert.ok(result.failures.includes('SOURCE_COVERAGE_INCOMPLETE'))
  assert.ok(result.failures.includes('LEGACY_SOURCE_SET_INCOMPLETE'))
})

test('Node AST replaces incompatible Vite maps without duplicating branches or inheriting uncertain credit', () => {
  const root = '/project', file = root + '/apps/agent/src/example.js'
  const vite = libCoverage.createCoverageMap({ [file]: fileCoverage(file, 1) })
  const native = fileCoverage(file, 0)
  // Different transformed locations must not create a second denominator for the same source.
  native.branchMap[0].locations[0].start.column = 7
  const node = libCoverage.createCoverageMap({ [file]: native })
  const merged = mergeCollectorMaps(vite, node, root)
  assert.equal(merged.map.files().length, 1)
  assert.equal(merged.map.getCoverageSummary().branches.total, node.getCoverageSummary().branches.total)
  assert.equal(merged.map.getCoverageSummary().branches.covered, 0)
  assert.equal(merged.authority.discardedVitestCredit[0].file, 'apps/agent/src/example.js')
  assert.equal(vite.getCoverageSummary().branches.covered, 2)
})

test('unexpected executable maps cannot silently inflate coverage inventory', () => {
  const root = '/project', file = root + '/apps/backend/src/modules/demo/demo.service.ts'
  const extra = root + '/tools/unexpected.mjs'
  const map = libCoverage.createCoverageMap({ [file]: fileCoverage(file), [extra]: fileCoverage(extra) })
  const result = summarizeCoverage(map, root, [file.slice(root.length + 1)])
  assert.ok(result.failures.includes('UNEXPECTED_SOURCE_COVERAGE'))
  assert.deepEqual(result.inventory.unexpected, [extra])
})
