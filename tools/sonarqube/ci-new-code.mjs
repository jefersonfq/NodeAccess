import { signature } from './ledger.mjs'

const pageSize = 100
const maximum = 10_000
const fail = () => { throw new Error('CI_NEW_CODE_DIAGNOSTICS_INVALID') }
function validatedPage(response, page, previousTotal, received) {
  const paging = response?.paging, rows = response?.issues
  if (!paging || !Number.isSafeInteger(paging.total) || paging.total < 0 || paging.total > maximum
    || paging.pageIndex !== page || paging.pageSize !== pageSize || !Array.isArray(rows)) fail()
  if (previousTotal !== undefined && previousTotal !== paging.total) fail()
  if (rows.length !== Math.min(pageSize, paging.total - received)) fail()
  return { rows, total: paging.total }
}
function diagnosticIssue(row, byId, reviewed, seen) {
  const original = byId.get(row.key)
  if (!original || seen.has(row.key) || ['rule', 'component', 'hash', 'line'].some(field => row[field] !== original[field])) fail()
  seen.add(row.key)
  const digest = signature(original)
  return { issueId: original.key, rule: original.rule, file: original.component.replace(/^nodeaccess:/, ''),
    line: original.line ?? null, signature: digest, signaturePresentInReviewedBaseline: reviewed.has(digest) }
}
// Community 26.10: inNewCodePeriod requires one component and excludes createdAfter.
// This is diagnostic evidence only; matching a reviewed signature never overrides a gate.
export async function newCodeDiagnostics(request, exported, baseline, analysisId) {
  const byId = new Map(exported.map(issue => [issue.key, issue]))
  const reviewed = new Set(baseline.findings.map(row => row.signature))
  const seen = new Set(), issues = []
  let total
  for (let page = 1; page <= maximum / pageSize; page++) {
    let response
    try { response = await request('/api/issues/search', { components: 'nodeaccess', inNewCodePeriod: true, resolved: false, p: page, ps: pageSize }) }
    catch { throw new Error('CI_NEW_CODE_DIAGNOSTICS_REQUEST_FAILED') }
    const result = validatedPage(response, page, total, issues.length)
    total = result.total
    for (const row of result.rows) issues.push(diagnosticIssue(row, byId, reviewed, seen))
    if (issues.length === total) return { analysisId, count: total, issues }
  }
  fail()
}
