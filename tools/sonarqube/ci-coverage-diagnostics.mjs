import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const { sanitizeFlowFailure } = createRequire(import.meta.url)('../frontend/sonar-flow-diagnostics.cjs')

const { sanitizeHarnessDiagnostic } = createRequire(import.meta.url)('../coverage/harness-diagnostics.cjs')

const failures = new Set([
  'VITEST_TESTS_FAILED', 'NODE_TESTS_FAILED', 'BROWSER_TESTS_FAILED',
  'BROWSER_RESULT_NOT_VERIFIED', 'VITEST_RESULT_NOT_VERIFIED', 'COVERAGE_PIPELINE_FAILED',
  'SOURCE_CHANGED_DURING_COVERAGE', 'LEGACY_SOURCE_SET_INCOMPLETE',
  'LEGACY_LINES_BELOW_70', 'LEGACY_FUNCTIONS_BELOW_70', 'LEGACY_BRANCHES_BELOW_60',
  'SOURCE_COVERAGE_INCOMPLETE', 'UNEXPECTED_SOURCE_COVERAGE', 'NEW_COVERAGE_BELOW_80_OR_INCOMPLETE',
])
function artifact(file) {
  try {
    const stat = lstatSync(file)
    if (!stat.isFile()) return 'not_regular'
    return stat.size ? 'present' : 'empty'
  } catch (error) { return error.code === 'ENOENT' ? 'missing' : 'unreadable' }
}
function errorCategory(message) {
  if (typeof message !== 'string') return 'UNCLASSIFIED'
  if (message.startsWith('ENOENT:')) return 'FILE_MISSING'
  if (message.startsWith('EACCES:') || message.startsWith('EPERM:')) return 'FILE_ACCESS_DENIED'
  if (message === 'Chromium coverage was not produced') return 'BROWSER_COVERAGE_MISSING'
  if (message === 'Chromium capture provenance invalid') return 'BROWSER_PROVENANCE_INVALID'
  const browserErrors = new Map([
    ['Browser fixture dependencies did not become ready', 'BROWSER_DEPENDENCIES_NOT_READY'],
    ['Browser fixture must bind loopback', 'BROWSER_BIND_NOT_LOOPBACK'],
    ['Browser fixture cleanup failed', 'BROWSER_CLEANUP_FAILED'],
  ])
  if (/^Browser coverage harness failed: (frontend|table|terminal|platform|flows|ha|audit-input|highlight-budget)$/.test(message)) return 'BROWSER_HARNESS_FAILED'
  return browserErrors.get(message) ?? 'UNCLASSIFIED'
}
function browserDiagnostics(source) {
  const safe = { errorCategory: errorCategory(source.error), harnesses: [] }
  if (['setup', 'listen', 'readiness', 'harness', 'complete', 'cleanup'].includes(source.phase)) safe.phase = source.phase
  const runs = Array.isArray(source.harnesses) ? source.harnesses : []
  for (const name of ['frontend', 'table', 'terminal', 'platform', 'flows', 'ha', 'audit-input', 'highlight-budget']) {
    const run = runs.find(item => item?.name === name)
    if (!run) continue
    const entry = harnessDiagnostics(name, run)
    safe.harnesses.push(entry)
  }
  return safe
}
function harnessDiagnostics(name, run) {
  const entry = { name }
  if (Number.isSafeInteger(run.exitCode) && run.exitCode >= 0 && run.exitCode <= 255) entry.exitCode = run.exitCode
  if (['node-only', 'node-and-browser'].includes(run.coverageMode)) entry.coverageMode = run.coverageMode
  if (typeof run.timedOut === 'boolean') entry.timedOut = run.timedOut
  const failure = name === 'flows' ? sanitizeFlowFailure(run.failure) : undefined
  if (failure) entry.failure = failure
  const diagnostic = sanitizeHarnessDiagnostic(run.diagnostic)
  if (diagnostic) entry.diagnostic = diagnostic
  return entry
}
function collectorDiagnostics(collector) {
  const safe = {}
  for (const key of ['exitCode', 'testFiles', 'passed', 'failed', 'skipped']) {
    const value = collector[key]
    if (Number.isSafeInteger(value) && value >= 0 && (key !== 'exitCode' || value <= 255)) safe[key] = value
  }
  if (['passed', 'failed'].includes(collector.status)) safe.status = collector.status
  return safe
}
// The collector summary is private/untrusted. Never spread it into a CI artifact.
export function coverageDiagnostics(root) {
  const directory = join(root, 'coverage'), file = join(directory, 'summary.json')
  const result = { artifacts: { lcov: artifact(join(directory, 'lcov.info')), summary: artifact(file) } }
  if (result.artifacts.summary !== 'present') return result
  try {
    if (lstatSync(file).size > 2 * 1024 * 1024) return { ...result, summaryRead: 'too_large' }
    const source = JSON.parse(readFileSync(file, 'utf8'))
    result.summaryRead = 'parsed'
    result.status = ['passed', 'failed'].includes(source?.status) ? source.status : 'unknown'
    result.failures = Array.isArray(source?.failures)
      ? [...new Set(source.failures.filter(code => failures.has(code)))] : []
    result.hasUnrecognizedFailures = Array.isArray(source?.failures) && source.failures.some(code => !failures.has(code))
    result.collectors = {}
    for (const name of ['vitest', 'node', 'browser']) {
      const collector = source?.collectors?.[name]
      if (!collector || typeof collector !== 'object') continue
      result.collectors[name] = { ...collectorDiagnostics(collector), ...(name === 'browser' ? browserDiagnostics(collector) : {}) }
    }
    if (source?.error !== undefined) result.errorCategory = errorCategory(source.error)
  } catch { result.summaryRead = 'invalid' }
  return result
}
