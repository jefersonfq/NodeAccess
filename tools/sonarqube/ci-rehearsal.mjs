import { spawnSync } from 'node:child_process'
// Explicit opt-in: starts only its own disposable Docker stack on a dynamic port.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { startServer, configureProject } from './ci-server.mjs'
import { scan } from './ci-run.mjs'
import { client } from './export.mjs'

function collectFixtureCoverage(directory, exerciseNewCode) {
  writeFileSync(join(directory, 'fixture.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { sum, subtract } from './src/math.js';
test('real fixture execution', () => { assert.equal(sum(1, 2), 3); ${exerciseNewCode ? 'assert.equal(subtract(3, 2), 1);' : ''} });
`)
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', '--test-coverage-include=src/*.js',
    '--test-reporter=lcov', '--test-reporter-destination=coverage/lcov.info', 'fixture.test.mjs'], { cwd: directory, env, stdio: 'pipe' })
  if (result.status !== 0) throw new Error('CI_FIXTURE_TESTS_FAILED')
}

export async function rehearsal(outputFile, { start = startServer, configure = configureProject, analyze = scan, readClient = client } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'nodeaccess-ci-rehearsal-'))
  let instance
  const result = { fixture: true, startedAt: new Date().toISOString(), passed: false }
  try {
    const source = join(directory, 'src'), coverage = join(directory, 'coverage')
    mkdirSync(source); mkdirSync(coverage)
    const settings = join(directory, 'sonar-project.properties')
    writeFileSync(settings, 'sonar.projectKey=nodeaccess\nsonar.sources=src\nsonar.javascript.lcov.reportPaths=coverage/lcov.info\n')
    const initial = 'export function sum(a, b) {\n  return a + b;\n}\n'
    const changed = initial + '\nexport function subtract(a, b) {\n  return a - b;\n}\n'
    writeFileSync(join(source, 'math.js'), initial)
    instance = await start()
    const tokens = await configure(instance)
    result.privateProjectVerified = true
    const base = await analyze({ root: directory, settings, revision: 'a'.repeat(40), instance, tokens, output: directory, stage: 'base' })
    await instance.admin('/api/new_code_periods/set', { project: 'nodeaccess', type: 'SPECIFIC_ANALYSIS', value: base })
    writeFileSync(join(source, 'math.js'), changed)
    collectFixtureCoverage(directory, true)
    const head = await analyze({ root: directory, settings, revision: 'b'.repeat(40), instance, tokens, output: directory, stage: 'covered' })
    const request = readClient({ server: instance.server, token: tokens.review })
    const good = (await request('/api/qualitygates/project_status', { analysisId: head })).projectStatus
    const measures = await request('/api/measures/component', { component: 'nodeaccess', metricKeys: 'new_lines,new_coverage,new_lines_to_cover' })
    result.covered = { gate: good, measures: measures.component.measures }
    const coverageCondition = good.conditions?.find(c => c.metricKey === 'new_coverage')
    if (good.status !== 'OK' || good.ignoredConditions || coverageCondition?.status !== 'OK' || Number(coverageCondition.actualValue) !== 100) throw new Error('CI_REHEARSAL_COVERED_NEW_CODE_NOT_PROVEN')
    // A fresh source change with uncovered executable lines must fail even below
    // Sonar's usual 20-new-lines fudge factor; no fabricated pass from first scan.
    writeFileSync(join(source, 'math.js'), changed + '\nexport function multiply(a, b) {\n  return a * b;\n}\n')
    collectFixtureCoverage(directory, false)
    const badHead = await analyze({ root: directory, settings, revision: 'c'.repeat(40), instance, tokens, output: directory, stage: 'uncovered' })
    const bad = (await request('/api/qualitygates/project_status', { analysisId: badHead })).projectStatus
    result.uncovered = { gate: bad }
    if (bad.status !== 'ERROR' || bad.conditions?.find(c => c.metricKey === 'new_coverage')?.status !== 'ERROR') throw new Error('CI_REHEARSAL_UNCOVERED_NEW_CODE_NOT_REJECTED')
    result.analysisIds = { base, covered: head, uncovered: badHead }
    result.passed = true
  } catch (error) {
    result.error = /^CI_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CI_REHEARSAL_FAILED'
    // Private logs remain in a private temp directory for local diagnosis only.
    result.privateDiagnostics = directory
  } finally {
    try { if (instance) await instance.cleanup(); result.cleanup = 'complete' }
    catch { result.passed = false; result.cleanup = 'failed' }
    result.finishedAt = new Date().toISOString()
    const sanitized = { ...result }; delete sanitized.privateDiagnostics
    writeFileSync(outputFile, JSON.stringify(sanitized, null, 2) + '\n')
    if (result.passed) rmSync(directory, { recursive: true, force: true })
  }
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.SONAR_CI_REHEARSAL !== '1' || !process.argv[2]) throw new Error('Explicit SONAR_CI_REHEARSAL=1 and sanitized output path required')
  const result = await rehearsal(resolve(process.argv[2]))
  console.log(JSON.stringify(result))
  process.exitCode = result.passed ? 0 : 1
}
