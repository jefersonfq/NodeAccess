import { mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'
import libCoverage from 'istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'
import { sourceInventory, sourceFingerprint, nodeTestFiles } from './inventory.mjs'
import { nodeCoverageMap, normalizeBranchCounts } from './node-map.mjs'
import { summarizeCoverage, mergeCollectorMaps } from './summary.mjs'
import { browserCoverageRecords, overlayBrowserCoverage } from './browser-map.mjs'
import { requiredBrowserHarnesses } from './browser.mjs'
import { diffCoverage } from './lcov.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export function argumentsForCoverage(args) {
  if (!args.length) return {}
  if (args.length !== 2 || args[0] !== '--base' || !/^[a-f0-9]{7,40}$/i.test(args[1])) throw new Error('Usage: npm run test:coverage -- --base <commit SHA>')
  return { base: args[1] }
}
function command(root, args, env, logfile) {
  const fd = openSync(logfile, 'w', 0o600)
  try {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: ['ignore', fd, fd], timeout: 20 * 60_000 })
    return result.status ?? 1
  } finally { closeSync(fd) }
}
export async function runCoverage({ root = projectRoot, base, execute = command, env = process.env } = {}) {
  const startedAt = new Date().toISOString()
  const files = sourceInventory(root), fingerprint = sourceFingerprint(root, files)
  const head = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const output = join(root, 'coverage')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  for (const name of ['vitest', 'node-v8', 'browser', 'vitest-tests.json', 'summary.json', 'coverage-final.json', 'lcov.info']) rmSync(join(output, name), { recursive: true, force: true })
  mkdirSync(join(output, 'node-v8'), { mode: 0o700 })
  const childEnv = { ...env }; delete childEnv.SONAR_TOKEN; delete childEnv.SONAR_REVIEW_TOKEN; delete childEnv.NODE_V8_COVERAGE
  const result = { schemaVersion: 1, startedAt, head, requestedBase: base ?? null, sourceFingerprint: fingerprint,
    status: 'failed', failures: [], newCoverage: { status: 'not_requested' }, collectors: {} }
  try {
    const version = process.versions.node.split('.').map(Number)
    if (version[0] !== 24 || version[1] < 21) throw new Error('Coverage requires Node 24.21+')
    if (base) result.resolvedBase = execFileSync('/usr/bin/git', ['rev-parse', '--verify', `${base}^{commit}`], { cwd: root, encoding: 'utf8' }).trim()
    const vitestExit = execute(root, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--coverage', '--reporter=json', '--outputFile=coverage/vitest-tests.json'],
      { ...childEnv, NODEACCESS_COVERAGE_COLLECT: '1' }, join(output, 'vitest.log'))
    result.collectors.vitest = { exitCode: vitestExit }
    if (vitestExit !== 0) result.failures.push('VITEST_TESTS_FAILED')
    const nodeTests = nodeTestFiles(root)
    if (!nodeTests.length) throw new Error('No Node test suites discovered')
    const nodeExit = execute(root, ['--test', '--test-concurrency=2', ...nodeTests],
      { ...childEnv, NODE_V8_COVERAGE: join(output, 'node-v8') }, join(output, 'node.log'))
    result.collectors.node = { exitCode: nodeExit, testFiles: nodeTests.length }
    if (nodeExit !== 0) result.failures.push('NODE_TESTS_FAILED')
    const browserExit = execute(root, [join(root, 'tools/coverage/browser.mjs')],
      { ...childEnv, NODE_V8_COVERAGE: join(output, 'node-v8') }, join(output, 'browser.log'))
    const browserReport = JSON.parse(readFileSync(join(output, 'browser/summary.json'), 'utf8'))
    result.collectors.browser = { exitCode: browserExit, ...browserReport }
    if (browserExit !== 0) result.failures.push('BROWSER_TESTS_FAILED')
    if (browserReport.status !== 'passed' || !Array.isArray(browserReport.harnesses)
      || browserReport.harnesses.length !== requiredBrowserHarnesses.length || !requiredBrowserHarnesses.map(([name]) => name).every(name => browserReport.harnesses.some(run => run.name === name && run.exitCode === 0 && run.timedOut === false))) {
      result.failures.push('BROWSER_RESULT_NOT_VERIFIED')
    }
    const vitestReport = JSON.parse(readFileSync(join(output, 'vitest-tests.json'), 'utf8'))
    if (vitestReport.success !== true || !Number.isSafeInteger(vitestReport.numPassedTests) || vitestReport.numPassedTests < 1) result.failures.push('VITEST_RESULT_NOT_VERIFIED')
    result.collectors.vitest.passed = vitestReport.numPassedTests
    result.collectors.vitest.failed = vitestReport.numFailedTests
    result.collectors.vitest.skipped = vitestReport.numPendingTests
    let map = libCoverage.createCoverageMap(JSON.parse(readFileSync(join(output, 'vitest/coverage-final.json'), 'utf8')))
    result.conversionAnomalies = []
    normalizeBranchCounts(map.files().map(file => map.fileCoverageFor(file)), root, result.conversionAnomalies, 'vitest')
    const nativeMap = await nodeCoverageMap({ root, directory: join(output, 'node-v8'), files, anomalies: result.conversionAnomalies })
    const merged = mergeCollectorMaps(map, nativeMap, root)
    map = merged.map
    result.collectorAuthority = merged.authority
    // JSON imports are data transformed by Vite, outside the executable source inventory.
    result.dataArtifacts = map.files().filter(file => file.endsWith('.json')).map(file => file.slice(root.length + 1))
    map.filter(file => !file.endsWith('.json'))
    if (sourceFingerprint(root, sourceInventory(root)) !== fingerprint) result.failures.push('SOURCE_CHANGED_DURING_COVERAGE')
    const browserRecords = await browserCoverageRecords({ root, directory: join(output, 'browser/chromium-v8'), files, fingerprint, capture: browserReport, anomalies: result.conversionAnomalies })
    result.browserCoverage = { ...browserRecords.evidence, overlay: overlayBrowserCoverage(map, browserRecords.coverages, root) }
    const metrics = summarizeCoverage(map, root, files)
    const { failures: metricFailures, ...measurements } = metrics
    Object.assign(result, measurements)
    result.failures.push(...metricFailures)
    if (sourceFingerprint(root, sourceInventory(root)) !== fingerprint) result.failures.push('SOURCE_CHANGED_DURING_COVERAGE')
    const context = libReport.createContext({ dir: output, coverageMap: map })
    for (const name of ['json', 'lcovonly']) reports.create(name, { projectRoot: root }).execute(context)
    if (base) {
      result.newCoverage = diffCoverage(root, base, undefined, readFileSync(join(output, 'lcov.info'), 'utf8'))
      if (result.newCoverage.status !== 'passed') result.failures.push('NEW_COVERAGE_BELOW_80_OR_INCOMPLETE')
    }
    result.status = result.failures.length ? 'failed' : 'passed'
  } catch (error) {
    result.failures.push('COVERAGE_PIPELINE_FAILED')
    result.error = error instanceof Error ? error.message : 'Unknown coverage error'
  }
  result.finishedAt = new Date().toISOString()
  writeFileSync(join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runCoverage(argumentsForCoverage(process.argv.slice(2)))
    console.log(JSON.stringify({ status: result.status, failures: result.failures, legacy: result.legacy,
      newCoverage: result.newCoverage, report: 'coverage/summary.json' }))
    process.exitCode = result.status === 'passed' ? 0 : 1
  } catch (error) { console.error(error instanceof Error ? error.message : 'Coverage failed'); process.exitCode = 1 }
}
