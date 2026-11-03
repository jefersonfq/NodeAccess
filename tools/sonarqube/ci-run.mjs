import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startServer, configureProject, pause } from './ci-server.mjs'
import { baselineSummary, commitSha, scannerEnvironment, ciOutcome, validateCoverageMetadata } from './ci-policy.mjs'
import { client, exportReport } from './export.mjs'
import { compareFindings } from './ledger.mjs'
import { assertConfiguration, materializeBaseConfiguration, verifyScannerContext } from './ci-config.mjs'

function git(root, args, optional = false) {
  const result = spawnSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0 && !optional) throw new Error('CI_GIT_COMMAND_FAILED')
  return result.status === 0 ? result.stdout.trim() : null
}
function command(root, args, env, logfile) {
  const fd = openSync(logfile, 'wx', 0o600)
  try {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: ['ignore', fd, fd], timeout: 1_200_000 })
    return result.status ?? 1
  } finally { closeSync(fd) }
}
export async function scan({ root, settings, revision, instance, tokens, output, stage, settingsHash, onConfiguration = () => {} }) {
  const configuration = assertConfiguration(root, settings, settingsHash)
  const taskFile = join(output, `${stage}-task.txt`)
  const npmCli = resolve(process.execPath, '..', '..', 'lib/node_modules/npm/bin/npm-cli.js')
  // npm may be supplied by an installation alongside another node binary (local WSL).
  const npm = process.env.npm_execpath || npmCli
  const status = command(root, [npm, 'exec', '--yes', '--package=@sonar/scan@5.0.2', '--', 'sonar-scanner-npm',
    `-Dsonar.host.url=${instance.server}`, `-Dsonar.projectBaseDir=${root}`, `-Dsonar.projectVersion=${revision}`,
    '-Dsonar.scm.disabled=true', '-Dsonar.qualitygate.wait=false', `-Dsonar.scanner.metadataFilePath=${taskFile}`],
  scannerEnvironment(process.env, instance.server, tokens.scan), join(output, `${stage}-scanner.log`))
  if (status !== 0) throw new Error('CI_SCANNER_FAILED')
  assertConfiguration(root, settings, configuration.sha256)
  const task = Object.fromEntries(readFileSync(taskFile, 'utf8').trim().split('\n').map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]
  }))
  if (!task.ceTaskId || task.projectKey !== 'nodeaccess' || task.serverUrl !== instance.server) throw new Error('CI_TASK_METADATA_MISMATCH')
  const request = client({ server: instance.server, token: tokens.scan })
  for (let attempt = 0; attempt < 300; attempt++) {
    const { task: ce } = await request('/api/ce/task', { id: task.ceTaskId })
    if (ce?.id !== task.ceTaskId || ce?.componentKey !== 'nodeaccess') throw new Error('CI_TASK_IDENTITY_MISMATCH')
    if (ce.status === 'SUCCESS' && ce.analysisId) {
      const { task: verified } = await instance.admin('/api/ce/task', { id: task.ceTaskId, additionalFields: 'scannerContext' }, 'GET')
      if (verified?.status !== 'SUCCESS' || verified?.id !== ce.id || verified?.componentKey !== 'nodeaccess' || verified?.analysisId !== ce.analysisId) throw new Error('CI_TASK_IDENTITY_MISMATCH')
      onConfiguration(verifyScannerContext(verified.scannerContext, configuration, { root, revision }))
      assertConfiguration(root, settings, configuration.sha256)
      return ce.analysisId
    }
    if (!['PENDING', 'IN_PROGRESS'].includes(ce.status)) throw new Error('CI_ANALYSIS_FAILED')
    await pause(2000)
  }
  throw new Error('CI_ANALYSIS_TIMEOUT')
}
export async function run({ root = resolve(fileURLToPath(new URL('../..', import.meta.url))), base = process.env.SONAR_CI_BASE, runtime = {} } = {}) {
  const { execute = command, start = startServer, configure = configureProject, analyze = scan,
    exportFindings = exportReport, readClient = client,
    fingerprint = async directory => {
      const { sourceFingerprint, sourceInventory } = await import(pathToFileURL(join(directory, 'tools/coverage/inventory.mjs')).href)
      return sourceFingerprint(directory, sourceInventory(directory))
    },
    calculateDiff = async (directory, from, to, text) => {
      const { diffCoverage } = await import(pathToFileURL(join(directory, 'tools/coverage/lcov.mjs')).href)
      return diffCoverage(directory, from, to, text)
    } } = runtime
  commitSha(base)
  const head = commitSha(git(root, ['rev-parse', 'HEAD']))
  if (git(root, ['merge-base', '--is-ancestor', base, head], true) === null) throw new Error('CI_BASE_NOT_ANCESTOR')
  if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('CI_CLEAN_TRACKED_CHECKOUT_REQUIRED')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major !== 24 || minor < 21) throw new Error('CI_NODE_24_21_REQUIRED')
  const baselinePath = 'docs/sonarqube/accepted-findings.json'
  const baselineText = readFileSync(join(root, baselinePath), 'utf8')
  const baseline = baselineSummary(baselineText, git(root, ['show', `${base}:${baselinePath}`], true))
  const output = mkdtempSync(join(tmpdir(), 'nodeaccess-sonar-ci-'))
  const publicOutput = join(root, 'coverage/sonar-ci-summary.json')
  let instance, baseRoot
  const summary = { schemaVersion: 1, base, head, baseline, startedAt: new Date().toISOString(), passed: false, failures: [] }
  try {
    // Collect coverage before starting Elasticsearch. A failed coverage gate remains
    // a final failure, but must not silently skip the real scanner if data is valid.
    rmSync(join(root, 'coverage/lcov.info'), { force: true })
    rmSync(join(root, 'coverage/summary.json'), { force: true })
    const npm = process.env.npm_execpath || resolve(process.execPath, '..', '..', 'lib/node_modules/npm/bin/npm-cli.js')
    const coverageStarted = Date.now()
    summary.coverageExit = execute(root, [npm, 'run', 'test:coverage', '--', '--base', base], scannerEnvironment(process.env, '', ''), join(output, 'coverage.log'))
    const lcovPath = join(root, 'coverage/lcov.info')
    if (!statSync(lcovPath).isFile() || !statSync(lcovPath).size) throw new Error('CI_FRESH_LCOV_REQUIRED')
    const coverage = JSON.parse(readFileSync(join(root, 'coverage/summary.json'), 'utf8'))
    const coveragePassed = validateCoverageMetadata(coverage, { base, head, started: coverageStarted, fingerprint: await fingerprint(root) })
    if (git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('CI_SOURCE_CHANGED_DURING_COVERAGE')
    if (!coveragePassed) summary.coverageExit = 1
    summary.newCoverage = await calculateDiff(root, base, head, readFileSync(lcovPath, 'utf8'))
    const diffCoveragePassed = summary.newCoverage.status === 'passed' && summary.newCoverage.threshold === 80
      && summary.newCoverage.base === base && summary.newCoverage.head === head && summary.newCoverage.includesWorkingTree === false
    summary.coverage = { legacy: coverage.legacy, global: coverage.global, inventory: coverage.inventory }
    instance = await start()
    const tokens = await configure(instance)
    summary.privateProjectVerified = true
    baseRoot = join(output, 'base')
    git(root, ['worktree', 'add', '--detach', baseRoot, base])
    // Same scanner configuration and rules for both source snapshots, even when
    // the repository base predates adoption of Sonar (explicit bootstrap).
    const configuration = materializeBaseConfiguration(root, baseRoot)
    summary.scannerConfiguration = { sha256: configuration.sha256 }
    const scanSnapshot = async (directory, settings, revision, stage) => {
      const analysis = await analyze({ root: directory, settings, settingsHash: configuration.sha256, revision, instance, tokens, output, stage,
        onConfiguration: evidence => { summary.scannerConfiguration[stage] = evidence } })
      assertConfiguration(directory, settings, configuration.sha256)
      const evidence = summary.scannerConfiguration[stage]
      if (!evidence?.contextVerified || evidence.sha256 !== configuration.sha256
        || JSON.stringify(evidence.effectiveProperties) !== JSON.stringify(configuration.properties)) throw new Error('CI_EFFECTIVE_SETTINGS_NOT_VERIFIED')
      return analysis
    }
    summary.baseAnalysisId = await scanSnapshot(baseRoot, configuration.baseSettings, base, 'base')
    await instance.admin('/api/new_code_periods/set', { project: 'nodeaccess', type: 'SPECIFIC_ANALYSIS', value: summary.baseAnalysisId })
    summary.headAnalysisId = await scanSnapshot(root, configuration.settings, head, 'head')
    if (git(root, ['rev-parse', 'HEAD']) !== head || await fingerprint(root) !== coverage.sourceFingerprint
      || git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('CI_SOURCE_CHANGED_DURING_ANALYSIS')
    const request = readClient({ server: instance.server, token: tokens.review })
    const latest = async () => (await request('/api/project_analyses/search', { project: 'nodeaccess', ps: 1 })).analyses?.[0]?.key
    if (await latest() !== summary.headAnalysisId || summary.headAnalysisId === summary.baseAnalysisId) throw new Error('CI_HEAD_ANALYSIS_NOT_CURRENT')
    const exported = await exportFindings({ server: instance.server, token: tokens.review, outputRoot: output })
    if (await latest() !== summary.headAnalysisId) throw new Error('CI_HEAD_ANALYSIS_REPLACED')
    if (git(root, ['rev-parse', 'HEAD']) !== head || await fingerprint(root) !== coverage.sourceFingerprint
      || git(root, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('CI_SOURCE_CHANGED_DURING_EXPORT')
    const issues = JSON.parse(readFileSync(join(exported.output, 'issues.json'), 'utf8')).issues
    const hotspots = JSON.parse(readFileSync(join(exported.output, 'hotspots.json'), 'utf8')).hotspots
    const comparison = compareFindings(issues, JSON.parse(baselineText))
    summary.comparison = { ...comparison, unexpected: comparison.unexpected.map(({ rule, file, line }) => ({ rule, file, line })) }
    summary.hotspotsToReview = hotspots.filter(h => h.status !== 'REVIEWED' || !['SAFE', 'FIXED'].includes(h.resolution)).length
    summary.gate = JSON.parse(readFileSync(join(exported.output, 'quality-gate.json'), 'utf8')).projectStatus
    Object.assign(summary, ciOutcome({ coverageExit: summary.coverageExit, diffCoveragePassed, comparison,
      gate: summary.gate, analysisVerified: true, hotspotsToReview: summary.hotspotsToReview }))
  } catch (error) {
    summary.passed = false
    summary.failures.push(/^CI_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CI_EXECUTION_FAILED')
  } finally {
    try { if (baseRoot) git(root, ['worktree', 'remove', '--force', baseRoot]) }
    catch { summary.passed = false; summary.failures.push('CI_WORKTREE_CLEANUP_FAILED') }
    try { if (instance) await instance.cleanup(); summary.cleanup = 'complete' }
    catch { summary.passed = false; summary.failures.push('CI_RESOURCE_CLEANUP_FAILED') }
    summary.finishedAt = new Date().toISOString()
    mkdirSync(join(root, 'coverage'), { recursive: true })
    writeFileSync(publicOutput, JSON.stringify(summary, null, 2) + '\n')
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### SonarQube real CI\n\nResultado: ${summary.passed ? 'PASS' : 'FAIL'}\n\nBase: \`${base}\`; candidato: \`${head}\`.\n\nBaseline SHA256: \`${baseline.sha256}\`; ${baseline.signatures} assinaturas / ${baseline.occurrences} ocorrências. Bootstrap: ${baseline.bootstrap}; alterações exigem revisão: ${baseline.reviewRequired}; +${baseline.addedOccurrences}/-${baseline.removedOccurrences} ocorrências.\n\nFalhas: ${summary.failures.join(', ') || 'nenhuma'}. Consulte o JSON sanitizado.\n`, { flag: 'a' })
    }
    // Raw scanner/export logs stay local and are never uploaded as CI artifacts.
    rmSync(output, { recursive: true, force: true })
  }
  return summary
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await run()
    console.log(JSON.stringify({ passed: summary.passed, failures: summary.failures, summary: 'coverage/sonar-ci-summary.json' }))
    process.exitCode = summary.passed ? 0 : 1
  } catch (error) {
    console.error(/^CI_[A-Z0-9_]+$/.test(error.message) ? error.message : 'CI_PREFLIGHT_FAILED')
    process.exitCode = 1
  }
}
