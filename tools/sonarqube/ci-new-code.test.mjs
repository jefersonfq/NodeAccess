import test from 'node:test'
import assert from 'node:assert/strict'
import { newCodeDiagnostics } from './ci-new-code.mjs'
import { signature } from './ledger.mjs'

const issue = { key: 'fixture-issue', rule: 'test:rule', component: 'nodeaccess:src/a.ts', hash: 'source-content', line: 7 }
const response = (issues, total = issues.length, pageIndex = 1) => ({ paging: { pageIndex, pageSize: 100, total }, issues })
const emptyBaseline = { findings: [] }

test('official paginated query preserves identifiers and only allowlisted metadata', async () => {
  const exported = Array.from({ length: 101 }, (_, n) => ({ ...issue, key: `finding-${n}`, line: n + 1 }))
  const calls = []
  const result = await newCodeDiagnostics(async (endpoint, params) => {
    calls.push({ endpoint, params })
    return response(exported.slice((params.p - 1) * 100, params.p * 100).map(row => ({ ...row, message: 'PRIVATE-MESSAGE', textRange: { source: 'PRIVATE-SNIPPET' }, author: 'PRIVATE-AUTHOR' })), 101, params.p)
  }, exported, { findings: [{ signature: signature(exported[0]) }] }, 'analysis-head')
  assert.equal(result.analysisId, 'analysis-head'); assert.equal(result.count, 101)
  assert.deepEqual(calls.map(call => call.params.p), [1, 2])
  assert.deepEqual(calls[0], { endpoint: '/api/issues/search', params: { components: 'nodeaccess', inNewCodePeriod: true, resolved: false, p: 1, ps: 100 } })
  assert.deepEqual(result.issues[0], { issueId: 'finding-0', rule: 'test:rule', file: 'src/a.ts', line: 1, signature: signature(issue), signaturePresentInReviewedBaseline: true })
  assert.ok(!JSON.stringify(result).includes('PRIVATE-'))
})
test('empty new period and line-less findings retain honest counts and unmatched signature', async () => {
  assert.deepEqual(await newCodeDiagnostics(async () => response([]), [], emptyBaseline, 'head'), { analysisId: 'head', count: 0, issues: [] })
  const noLine = { ...issue }; delete noLine.line
  const result = await newCodeDiagnostics(async () => response([noLine]), [noLine], emptyBaseline, 'head')
  assert.equal(result.issues[0].line, null); assert.equal(result.issues[0].signaturePresentInReviewedBaseline, false)
})
for (const [name, value] of [
  ['missing paging', { issues: [] }], ['invalid total', response([], -1)], ['excessive total', response([], 10001)],
  ['fractional total', response([], 0.5)], ['wrong page', response([], 0, 2)], ['wrong size', { ...response([]), paging: { pageIndex: 1, pageSize: 500, total: 0 } }],
  ['missing rows', { paging: { pageIndex: 1, pageSize: 100, total: 0 } }], ['incomplete page', response([], 1)],
  ['unknown issue', response([{ ...issue, key: 'foreign' }])], ['duplicate issue', response([issue, issue])],
  ['different rule', response([{ ...issue, rule: 'other' }])], ['different file', response([{ ...issue, component: 'nodeaccess:other.ts' }])],
  ['different hash', response([{ ...issue, hash: 'different' }])], ['different line', response([{ ...issue, line: 8 }])],
]) test(`${name} rejects diagnostics rather than silently truncating or misattributing`, async () => {
  await assert.rejects(newCodeDiagnostics(async () => value, [issue], emptyBaseline, 'head'), /CI_NEW_CODE_DIAGNOSTICS_INVALID/)
})
test('changing pagination totals and API errors fail with fixed non-sensitive errors', async () => {
  const exported = Array.from({ length: 101 }, (_, n) => ({ ...issue, key: `finding-${n}` }))
  await assert.rejects(newCodeDiagnostics(async (_, { p }) => response(p === 1 ? exported.slice(0, 100) : [], p === 1 ? 101 : 100, p), exported, emptyBaseline, 'head'), /CI_NEW_CODE_DIAGNOSTICS_INVALID/)
  await assert.rejects(newCodeDiagnostics(async () => { throw new Error('PRIVATE-RESPONSE') }, [], emptyBaseline, 'head'), { message: 'CI_NEW_CODE_DIAGNOSTICS_REQUEST_FAILED' })
})
