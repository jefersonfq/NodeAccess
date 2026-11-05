import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
import { mutationFiles, mutationInputs, mutationBudgetMs } from './scope.mjs'
import { summarizeMutationReport } from './report.mjs'
import { runBounded } from './process.mjs'

if (process.argv.length > 2) throw new Error('This pilot accepts no scope or threshold overrides')
const runId = process.env.NODEACCESS_MUTATION_RUN_ID || null
if (runId && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(runId)) {
  throw new Error('Mutation run ID must be a UUID v4')
}
const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'artifacts/mutation')
mkdirSync(output, { recursive: true, mode: 0o700 })
const lock = resolve(output, '.lock')
// A second runner must not remove or overwrite the first runner's artifacts.
mkdirSync(lock, { mode: 0o700 })
const startedAt = new Date().toISOString(), started = Date.now()
const summary = { schemaVersion: 1, runId, startedAt, passed: false, scope: [...mutationFiles], budgetMs: mutationBudgetMs }
try {
  for (const name of ['mutation.json', 'mutation.html', 'summary.json']) rmSync(resolve(output, name), { force: true })
  summary.head = execFileSync(resolveExecutable('git'), ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const inputs = mutationInputs
  summary.includesWorkingTree = Boolean(execFileSync(resolveExecutable('git'), ['status', '--porcelain', '--', ...inputs], { cwd: root, encoding: 'utf8' }).trim())
  const hash = createHash('sha256')
  for (const file of inputs) hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0')
  summary.inputFingerprint = hash.digest('hex')
  summary.nodeVersion = process.version
  summary.vitestVersion = JSON.parse(readFileSync(resolve(root, 'node_modules/vitest/package.json'))).version
  summary.strykerVersion = JSON.parse(readFileSync(resolve(root, 'node_modules/@stryker-mutator/core/package.json'))).version
  const execution = await runBounded(process.execPath, ['node_modules/@stryker-mutator/core/bin/stryker.js', 'run', 'stryker.config.mjs'], {
    cwd: root, timeoutMs: mutationBudgetMs,
  })
  const { exitCode } = execution
  summary.exitCode = exitCode
  summary.interrupted = execution.interrupted
  summary.orphanedWorkers = execution.orphaned
  if (execution.interrupted || execution.orphaned) throw new Error('Mutation run interrupted or exceeded its time budget')
  const rawReport = readFileSync(resolve(output, 'mutation.json'))
  summary.reportSha256 = createHash('sha256').update(rawReport).digest('hex')
  const result = summarizeMutationReport(JSON.parse(rawReport.toString('utf8')))
  Object.assign(summary, result, { passed: exitCode === 0 && result.passed })
} catch (error) {
  // Arbitrary test output may contain application data; never copy it into the published summary.
  summary.error = error instanceof SyntaxError ? 'Invalid mutation JSON' : 'Mutation execution or evidence validation failed'
  summary.passed = false
} finally {
  rmSync(resolve(output, '.sandbox'), { recursive: true, force: true })
  summary.finishedAt = new Date().toISOString(); summary.durationMs = Date.now() - started
  writeFileSync(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 })
  rmSync(lock, { recursive: true, force: true })
}
console.log(JSON.stringify(summary, null, 2))
if (!summary.passed) process.exitCode = 1
