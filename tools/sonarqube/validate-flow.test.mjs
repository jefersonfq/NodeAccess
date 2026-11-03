import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { sourceFingerprint, sourceInventory } from '../coverage/inventory.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validate } from './validate.mjs'
import { signature } from './ledger.mjs'

async function fixture(options = {}) {
 const root = mkdtempSync(join(tmpdir(), 'nodeaccess-sonar-flow-'))
 const issue = { key: 'issue-1', rule: 'javascript:S1', component: 'nodeaccess:example.js', hash: 'sample-hash' }
 mkdirSync(join(root, 'docs/sonarqube'), { recursive: true }); mkdirSync(join(root, 'tools/sonarqube'), { recursive: true }); mkdirSync(join(root, '.scannerwork')); mkdirSync(join(root, 'coverage'))
 writeFileSync(join(root, 'tools/sonarqube/example.test.mjs'), '')
 writeFileSync(join(root, '.scannerwork/report-task.txt'), 'stale-task-must-never-be-reused')
 writeFileSync(join(root, 'coverage/lcov.info'), 'stale-coverage-must-never-be-reused')
 writeFileSync(join(root, 'docs/sonarqube/accepted-findings.json'), JSON.stringify({ schemaVersion: 1, findings: [{ signature: signature(issue), count: 1, status: 'context_reviewed', reason: 'Synthetic isolated fixture', evidence: ['synthetic-test'] }] }))
 mkdirSync(join(root, 'apps/backend/src/modules/demo'), { recursive: true })
 writeFileSync(join(root, 'apps/backend/src/modules/demo/demo.service.ts'), 'export const fixture = true')
 execFileSync('git', ['init', '-q'], { cwd: root })
 execFileSync('git', ['add', '.'], { cwd: root })
 execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], { cwd: root })
 const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
 let latestReads = 0, requests = []
 const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost'); requests.push(url.pathname)
  assert.equal(req.headers.authorization, url.pathname === '/api/ce/task' ? 'Bearer analysis-synthetic' : 'Bearer reader-synthetic')
  let data
  if (url.pathname === '/api/ce/task') data = { task: { status: options.failedTask ? 'FAILED' : 'SUCCESS', componentKey: 'nodeaccess', id: options.missingTaskId ? undefined : 'task-1', analysisId: 'analysis-1' } }
  else if (url.pathname === '/api/project_analyses/search') data = { analyses: [{ key: options.concurrent && ++latestReads > 1 ? 'another-analysis' : 'analysis-1' }] }
  else if (url.pathname === '/api/webservices/list') data = { webServices: [['api/issues', ['components', 'resolved', 'p', 'ps'], 'search'], ['api/hotspots', ['project', 'p', 'ps'], 'search'], ['api/qualitygates', ['projectKey'], 'project_status']].map(([path, params, key]) => ({ path, actions: [{ key, params: params.map(key => ({ key })) }] })) }
  else if (url.pathname === '/api/issues/search') data = { paging: { pageIndex: 1, pageSize: 100, total: 1 }, issues: [options.newFinding ? { ...issue, hash: 'unexpected-content' } : issue] }
  else if (url.pathname === '/api/hotspots/search') data = { paging: { pageIndex: 1, pageSize: 100, total: options.hotspot ? 1 : 0 }, hotspots: options.hotspot ? [{ key: 'hotspot-1', status: 'TO_REVIEW' }] : [] }
  else if (url.pathname === '/api/qualitygates/project_status') data = { projectStatus: { status: 'OK', conditions: [], ignoredConditions: true } }
  else { res.writeHead(404); res.end(); return }
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data))
 })
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
 const host = `http://127.0.0.1:${server.address().port}`
 const env = { SONAR_BASE_SHA: head, SONAR_HOST_URL: host, SONAR_TOKEN: 'analysis-synthetic', SONAR_REVIEW_TOKEN: 'reader-synthetic' }
 let calls = 0
 const execute = (_root, childEnv, args) => {
  calls++
  if (calls < 3) { assert.equal(childEnv.SONAR_TOKEN, undefined); assert.equal(childEnv.SONAR_REVIEW_TOKEN, undefined) }
  if (calls === 2) {
   assert.equal(existsSync(join(root, 'coverage/lcov.info')), false)
   assert.deepEqual(args, [join(root, 'tools/coverage/run.mjs'), '--base', head])
   writeFileSync(join(root, 'coverage/lcov.info'), options.invalidLcov ? 'broken' : 'SF:apps/backend/src/modules/demo/demo.service.ts\nDA:1,1\nLF:1\nLH:1\nBRF:0\nBRH:0\nend_of_record\n')
   writeFileSync(join(root, 'coverage/summary.json'), JSON.stringify({ schemaVersion: 1,
    head, resolvedBase: head, startedAt: options.staleCoverage ? '2020-01-01T00:00:00Z' : new Date().toISOString(), finishedAt: new Date().toISOString(),
    status: options.coverageFail ? 'failed' : 'passed', failures: options.coverageFail ? ['LEGACY_LINES_BELOW_70'] : [],
    error: options.pipelineError ? 'fixture pipeline error' : undefined,
    sourceFingerprint: options.wrongFingerprint ? '0'.repeat(64) : sourceFingerprint(root, sourceInventory(root)),
    inventory: { count: 1, reportedCount: 1, missing: [] }, newCoverage: { base: head, head, status: 'passed', threshold: 80, percent: 100, missing: [] },
    legacy: { pattern: 'apps/backend/src/modules/**/*.service.ts', thresholds: { lines: 70, functions: 70, branches: 60 }, passed: !options.coverageFail },
   }))
   return options.coverageFail ? 1 : 0
  }
  if (calls === 3) {
   assert.equal(childEnv.SONAR_TOKEN, 'analysis-synthetic'); assert.equal(childEnv.SONAR_REVIEW_TOKEN, undefined)
   assert.equal(existsSync(join(root, '.scannerwork/report-task.txt')), false)
   if (options.changedDuringScan) writeFileSync(join(root, 'apps/backend/src/modules/demo/demo.service.ts'), 'export const changed = true')
   if (options.changedHead) execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'move head'], { cwd: root })
   if (options.noTask) return 1
   writeFileSync(join(root, '.scannerwork/report-task.txt'), `${options.missingTaskId ? '' : 'ceTaskId=task-1\n'}ceTaskUrl=${host}/api/ce/task?id=task-1\n`)
  }
  return 0
 }
 return { root, env, execute, requests, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }) } }
}

test('full orchestration uses fresh artifacts and least-privilege tokens; real loopback export verifies reviewed findings', async () => {
 const f = await fixture()
 try { const result = await validate(f); assert.equal(result.passed, true); assert.equal(result.analysisVerified, true); assert.equal(result.comparison.reviewed, 1); assert.equal(result.warnings.length, 1); assert.equal(existsSync(join(f.root, '.sonar-reports/validation.lock')), false); const saved = readFileSync(join(result.output, 'validation.json'), 'utf8'); assert.equal(saved.includes('analysis-synthetic'), false) } finally { await f.close() }
})
for (const [name, options, failure] of [
 ['failed coverage remains failed despite complete analysis', { coverageFail: true }, 'TESTS_OR_COVERAGE_FAILED'],
 ['new finding is blocked', { newFinding: true }, 'UNREVIEWED_FINDINGS'],
 ['new hotspot is blocked even with green gate', { hotspot: true }, 'UNREVIEWED_HOTSPOTS'],
 ['stale task cannot approve failed scanner', { noTask: true }, 'ANALYSIS_NOT_VERIFIED'],
 ['malformed metadata and compute response without task IDs cannot approve candidate', { missingTaskId: true }, 'ANALYSIS_NOT_VERIFIED'],
 ['failed compute task cannot approve candidate', { failedTask: true }, 'ANALYSIS_NOT_VERIFIED'],
 ['concurrent replacement during export invalidates result', { concurrent: true }, 'ANALYSIS_NOT_VERIFIED'],
]) test(name, async () => { const f = await fixture(options); try { const r = await validate(f); assert.equal(r.passed, false); assert.ok(r.failures.includes(failure)); if (options.noTask) assert.equal(f.requests.length, 0) } finally { await f.close() } })
test('same analysis/read token is rejected before executing tests', async () => {
 const f = await fixture()
 try { await assert.rejects(validate({ ...f, env: { ...f.env, SONAR_REVIEW_TOKEN: f.env.SONAR_TOKEN } }), /distinct/); assert.equal(f.requests.length, 0) } finally { await f.close() }
})

for (const options of [{ staleCoverage: true }, { wrongFingerprint: true }, { pipelineError: true }, { invalidLcov: true }]) {
 test(`coverage integrity blocks scanner: ${JSON.stringify(options)}`, async () => {
  const f = await fixture(options)
  try { await assert.rejects(validate(f)); assert.equal(f.requests.length, 0); assert.equal(existsSync(join(f.root, '.sonar-reports/validation.lock')), false) } finally { await f.close() }
 })
}

for (const options of [{ changedDuringScan: true }, { changedHead: true }]) {
 test(`source or HEAD drift during scanner prevents approval: ${JSON.stringify(options)}`, async () => {
  const f = await fixture(options)
  try { const result = await validate(f); assert.equal(result.passed, false); assert.equal(result.analysisVerified, false);
   assert.equal(result.error, 'SOURCE_OR_HEAD_CHANGED_DURING_SCAN') } finally { await f.close() }
 })
}
