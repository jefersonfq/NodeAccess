import { mkdirSync, readdirSync, lstatSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { localUrl, projectRoot } from './analyze.mjs'
import { exportReport, client } from './export.mjs'
import { compareFindings } from './ledger.mjs'
import { validateCoverageMetadata } from './ci-policy.mjs'
import { sourceInventory, sourceFingerprint } from '../coverage/inventory.mjs'
import { parseLcov } from '../coverage/lcov.mjs'

export function validationOutcome({ toolingExit, coverageExit, scannerExit, comparison, gate, analysisVerified, hotspotsToReview }) {
  const failures = []
  if (toolingExit !== 0) failures.push('SONAR_TOOLING_TESTS_FAILED')
  if (coverageExit !== 0) failures.push('TESTS_OR_COVERAGE_FAILED')
  if (scannerExit !== 0) failures.push('SCANNER_OR_GATE_FAILED')
  if (!analysisVerified) failures.push('ANALYSIS_NOT_VERIFIED')
  if (!Number.isSafeInteger(hotspotsToReview) || hotspotsToReview !== 0) failures.push('UNREVIEWED_HOTSPOTS')
  if (!comparison?.passed) failures.push('UNREVIEWED_FINDINGS')
  if (gate?.status !== 'OK') failures.push('QUALITY_GATE_NOT_OK')
  const warnings = gate?.ignoredConditions || !gate?.conditions?.length ? ['GATE_HAS_IGNORED_OR_NO_CONDITIONS'] : []
  return { passed: failures.length === 0, failures, warnings }
}
function privateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('Private report directory required')
}
function writePrivate(file, value) {
  const fd = openSync(file, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value, null, 2)+'\n') } finally { closeSync(fd) }
}
function command(root, env, args, logfile) {
  const fd = openSync(logfile, 'wx', 0o600)
  try {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: ['ignore', fd, fd], shell: false })
    return result.status ?? 1
  } finally { closeSync(fd) }
}
export async function validate({ root = projectRoot, env = process.env, execute = command } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major !== 24 || minor < 21) throw new Error('Node24.21+ required')
  const server = localUrl(env.SONAR_HOST_URL)
  if (!env.SONAR_TOKEN?.trim() || !env.SONAR_REVIEW_TOKEN?.trim()) throw new Error('Separate analysis and review tokens are required through env')
  if (env.SONAR_TOKEN === env.SONAR_REVIEW_TOKEN) throw new Error('Analysis and review tokens must be distinct')
  const baseline = JSON.parse(readFileSync(join(root, 'docs/sonarqube/accepted-findings.json'), 'utf8'))
  compareFindings([], baseline) // Validate reviewed policy before expensive work.
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const head = git(['rev-parse', 'HEAD'])
  const requestedBase = env.SONAR_BASE_SHA ?? git(['merge-base', 'HEAD', 'origin/master'])
  if (!/^[a-f0-9]{40}$/i.test(requestedBase)) throw new Error('Valid coverage base SHA required')
  const base = git(['rev-parse', '--verify', `${requestedBase}^{commit}`])
  const reports = join(root, '.sonar-reports'); privateDirectory(reports)
  const lockPath = join(reports, 'validation.lock'), lock = openSync(lockPath, 'wx', 0o600)
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  const output = join(reports, `validation-${Date.now()}-${randomUUID()}`)
  const previousMask = process.umask(0o077)
  try {
    privateDirectory(output)
    const childEnv = { ...env }; delete childEnv.SONAR_TOKEN; delete childEnv.SONAR_REVIEW_TOKEN
    const startedAt = new Date().toISOString()
    const lcov = join(root, 'coverage/lcov.info'), coverageSummary = join(root, 'coverage/summary.json')
    for (const artifact of [lcov, coverageSummary]) {
      if (existsSync(artifact)) {
        if (!lstatSync(artifact).isFile() || lstatSync(artifact).isSymbolicLink()) throw new Error('Invalid previous coverage artifact')
        unlinkSync(artifact)
      }
    }
    const toolingTests = readdirSync(join(root, 'tools/sonarqube')).filter(name => name.endsWith('.test.mjs')).map(name => join(root, 'tools/sonarqube', name))
    const toolingExit = execute(root, childEnv, ['--test', ...toolingTests], join(output, 'tooling.log'))
    let coverageExit = execute(root, childEnv, [join(root, 'tools/coverage/run.mjs'), '--base', base], join(output, 'coverage.log'))
    const coverage = JSON.parse(readFileSync(coverageSummary, 'utf8'))
    const coveragePassed = validateCoverageMetadata(coverage, { base, head, started: Date.parse(startedAt),
      fingerprint: sourceFingerprint(root, sourceInventory(root)) })
    parseLcov(readFileSync(lcov, 'utf8'), root)
    if (!coveragePassed) coverageExit = coverageExit || 1

    // Never let a previous successful scanner result stand in for this run.
    const taskFile = join(root, '.scannerwork/report-task.txt')
    if (existsSync(taskFile)) {
      if (!lstatSync(taskFile).isFile() || lstatSync(taskFile).isSymbolicLink()) throw new Error('Invalid scanner task metadata')
      unlinkSync(taskFile)
    }
    const scannerExit = execute(root, { ...childEnv, SONAR_TOKEN: env.SONAR_TOKEN, SONAR_HOST_URL: server }, [join(root, 'tools/sonarqube/analyze.mjs')], join(output, 'scanner.log'))
    let analysisVerified = false, comparison = null, gate = null, analysisId = null, error = null, exported = null, hotspotsToReview = null
    try {
      const task = Object.fromEntries(readFileSync(taskFile, 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
      const url = new URL(task.ceTaskUrl)
      if (url.origin !== server || url.pathname !== '/api/ce/task' || url.username || url.password) throw new Error('Task endpoint mismatch')
      const analysisApi = client({ server, token: env.SONAR_TOKEN })
      const ce = await analysisApi(url.pathname, Object.fromEntries(url.searchParams))
      if (ce.task?.status !== 'SUCCESS' || !ce.task.analysisId || ce.task.componentKey !== 'nodeaccess'
        || typeof task.ceTaskId !== 'string' || !task.ceTaskId || typeof ce.task.id !== 'string' || ce.task.id !== task.ceTaskId) throw new Error('Analysis not processed')
      analysisId = ce.task.analysisId
      const readApi = client({ server, token: env.SONAR_REVIEW_TOKEN })
      const latest = async () => (await readApi('/api/project_analyses/search', { project: 'nodeaccess', ps: 1 })).analyses?.[0]?.key
      if (await latest() !== analysisId) throw new Error('Concurrent analysis replaced this candidate')
      exported = await exportReport({ server, token: env.SONAR_REVIEW_TOKEN, outputRoot: reports })
      if (await latest() !== analysisId) throw new Error('Concurrent analysis replaced this candidate')
      const issues = JSON.parse(readFileSync(join(exported.output, 'issues.json'), 'utf8')).issues
      gate = JSON.parse(readFileSync(join(exported.output, 'quality-gate.json'), 'utf8')).projectStatus
      const hotspots = JSON.parse(readFileSync(join(exported.output, 'hotspots.json'), 'utf8')).hotspots
      hotspotsToReview = hotspots.filter(h => h.status !== 'REVIEWED' || !['SAFE', 'FIXED'].includes(h.resolution)).length
      comparison = compareFindings(issues, baseline)
      analysisVerified = true
    } catch { error = 'ANALYSIS_EXPORT_OR_BASELINE_NOT_VERIFIED' }
    try {
      if (git(['rev-parse', 'HEAD']) !== head || sourceFingerprint(root, sourceInventory(root)) !== coverage.sourceFingerprint) {
        analysisVerified = false; error = 'SOURCE_OR_HEAD_CHANGED_DURING_SCAN'
      }
    } catch { analysisVerified = false; error = 'SOURCE_OR_HEAD_CHANGED_DURING_SCAN' }
    const outcome = validationOutcome({ toolingExit, coverageExit, scannerExit, comparison, gate, analysisVerified, hotspotsToReview })
    const result = { schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), ...outcome,
      base, head, toolingExit, coverageExit, scannerExit, analysisId, analysisVerified, comparison, gate, hotspotsToReview, error,
      reports: exported?.output ?? null, output }
    writePrivate(join(output, 'validation.json'), result)
    return result
  } finally {
    process.umask(previousMask); closeSync(lock); unlinkSync(lockPath)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('No CLI overrides are accepted')
    const result = await validate()
    console.log(JSON.stringify({ passed: result.passed, failures: result.failures, warnings: result.warnings,
      analysisVerified: result.analysisVerified, unexpected: result.comparison?.unexpected.length ?? null,
      evidence: '.sonar-reports/validation-*/validation.json (private)' }))
    process.exitCode = result.passed ? 0 : 1
  } catch {
    console.error('SonarQube validation could not start: check local server, Node24, separate env tokens, reviewed baseline and private directory/lock. No validation was approved.')
    process.exitCode = 1
  }
}
