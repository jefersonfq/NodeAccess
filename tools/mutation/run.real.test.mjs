import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
import { mutationFiles, mutationInputs, mutationThreshold } from './scope.mjs'
import { summarizeMutationReport } from './report.mjs'

const enabled = process.env.NODEACCESS_MUTATION_COVERAGE === 'true'
const root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'artifacts/mutation')
const runner = resolve(root, 'tools/mutation/run.mjs')
const options = { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 }

test('real Stryker pilot produces current evidence and cleans its workers and sandbox', { skip: !enabled, timeout: 190000 }, () => {
  // NODE_V8_COVERAGE is inherited. The aggregate maps canonical source paths only,
  // so instrumented source copies in the mutation sandbox do not count as coverage.
  const result = spawnSync(process.execPath, [runner], options)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, 'Real mutation runner must pass; inspect artifacts/mutation/summary.json on failure')
  const summary = JSON.parse(readFileSync(resolve(output, 'summary.json'), 'utf8'))
  const raw = JSON.parse(readFileSync(resolve(output, 'mutation.json'), 'utf8'))
  const measured = summarizeMutationReport(raw)
  assert.equal(summary.passed, true)
  assert.equal(summary.runId, process.env.NODEACCESS_MUTATION_RUN_ID || null)
  assert.equal(summary.head, execFileSync(resolveExecutable('git'), ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim())
  const fingerprint = createHash('sha256')
  for (const file of mutationInputs) fingerprint.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0')
  assert.equal(summary.inputFingerprint, fingerprint.digest('hex'))
  for (const file of mutationFiles) assert.equal(raw.files[file].source, readFileSync(resolve(root, file), 'utf8'))
  assert.equal(typeof summary.includesWorkingTree, 'boolean')
  assert.deepEqual(summary.scope, [...mutationFiles])
  assert.equal(summary.threshold, mutationThreshold)
  assert.deepEqual(summary.counts, measured.counts)
  assert.equal(summary.score, measured.score)
  assert.equal(summary.reportSha256, createHash('sha256').update(readFileSync(resolve(output, 'mutation.json'))).digest('hex'))
  assert.equal(summary.interrupted, false)
  assert.equal(summary.orphanedWorkers, false)
  assert.ok(readFileSync(resolve(output, 'mutation.html')).length > 0)
  assert.equal(existsSync(resolve(output, '.sandbox')), false)
  assert.equal(existsSync(resolve(output, '.lock')), false)
})

test('runner rejects scope overrides and concurrent ownership without overwriting evidence', { skip: !enabled }, () => {
  const summary = resolve(output, 'summary.json')
  const fingerprint = () => createHash('sha256').update(readFileSync(summary)).digest('hex')
  const before = fingerprint()
  const override = spawnSync(process.execPath, [runner, '--mutate', 'outside.ts'], options)
  assert.notEqual(override.status, 0)
  assert.match(override.stderr, /accepts no scope or threshold overrides/)
  assert.equal(fingerprint(), before)
  const lock = resolve(output, '.lock')
  mkdirSync(lock)
  try {
    const concurrent = spawnSync(process.execPath, [runner], options)
    assert.notEqual(concurrent.status, 0)
    assert.match(concurrent.stderr, /EEXIST/)
    assert.equal(existsSync(lock), true)
    assert.equal(fingerprint(), before)
  } finally { rmSync(lock, { recursive: true, force: true }) }
})
