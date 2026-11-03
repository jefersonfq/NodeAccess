import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from './ci-run.mjs'
import { readConfiguration } from './ci-config.mjs'

function fixture(t, baseConfiguration = 'same') {
  const root = mkdtempSync(join(tmpdir(), 'sonar-ci-unit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid'])
  mkdirSync(join(root, 'docs/sonarqube'), { recursive: true })
  writeFileSync(join(root, 'docs/sonarqube/accepted-findings.json'), JSON.stringify({ schemaVersion: 1, findings: [] }))
  if (baseConfiguration !== 'absent') writeFileSync(join(root, 'sonar-project.properties'), baseConfiguration === 'different' ? 'sonar.projectKey=legacy\nsonar.sources=.\n' : 'sonar.projectKey=nodeaccess\nsonar.sources=src\n')
  writeFileSync(join(root, '.gitignore'), 'coverage/\n')
  git(['add', '.']); git(['commit', '-m', 'base']); const base = git(['rev-parse', 'HEAD'])
  writeFileSync(join(root, 'sonar-project.properties'), 'sonar.projectKey=nodeaccess\nsonar.sources=src\n')
  writeFileSync(join(root, 'candidate.txt'), 'candidate')
  git(['add', '.']); git(['commit', '-m', 'head']); const head = git(['rev-parse', 'HEAD'])
  return { root, base, head }
}
function runtime(f, options = {}) {
  const events = [], coverage = join(f.root, 'coverage')
  const gate = options.gate ?? { status: 'OK', ignoredConditions: false, conditions: [] }
  return { events, fingerprint: async () => 'a'.repeat(64),
    execute: () => {
      events.push('coverage'); mkdirSync(coverage, { recursive: true })
      writeFileSync(join(coverage, 'lcov.info'), 'fixture-data')
      writeFileSync(join(coverage, 'summary.json'), JSON.stringify({ schemaVersion: 1, head: f.head, resolvedBase: f.base,
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), sourceFingerprint: 'a'.repeat(64),
        status: 'passed', failures: [], newCoverage: { status: 'passed', base: f.base, head: f.head, threshold: 80, percent: 100, missing: [] }, inventory: { count: 1, reportedCount: 1, missing: [] },
        legacy: { pattern: 'apps/backend/src/modules/**/*.service.ts', thresholds: { lines: 70, functions: 70, branches: 60 }, passed: true } }))
      return options.coverageExit ?? 0
    },
    calculateDiff: async () => ({ status: options.lowCoverage ? 'failed' : 'passed', threshold: 80, base: f.base, head: f.head, includesWorkingTree: false }),
    start: async () => { events.push('start'); return { server: 'http://127.0.0.1:35001',
      admin: async (_, params) => { assert.equal(params.value, 'analysis-base'); events.push('specific-analysis') },
      cleanup: async () => { events.push('cleanup'); if (options.cleanupFailure) throw new Error('failure') } } },
    configure: async () => ({ scan: 'scan-fixture', review: 'review-fixture' }),
    analyze: async ({ stage, settings, onConfiguration }) => { events.push(stage); if (options.scanFailure) throw new Error('CI_SCANNER_FAILED'); const config = readConfiguration(settings); onConfiguration({ sha256: config.sha256, effectiveProperties: config.properties, contextVerified: true }); return `analysis-${stage}` },
    readClient: () => async () => ({ analyses: [{ key: options.replaced ? 'different-analysis' : 'analysis-head' }] }),
    exportFindings: async ({ outputRoot }) => {
      const output = join(outputRoot, 'export'); mkdirSync(output)
      writeFileSync(join(output, 'issues.json'), JSON.stringify({ issues: options.newIssue ? [{ key: 'new', rule: 'test:rule', component: 'nodeaccess:src/a.js', hash: 'changed', line: 1 }] : [] }))
      writeFileSync(join(output, 'hotspots.json'), JSON.stringify({ hotspots: options.hotspot ? [{ status: 'TO_REVIEW' }] : [] }))
      writeFileSync(join(output, 'quality-gate.json'), JSON.stringify({ projectStatus: gate }))
      return { output }
    },
  }
}
test('orchestration collects before Docker, scans base/head, configures comparison, exports sanitized result and cleans', async t => {
  const f = fixture(t), rt = runtime(f)
  const result = await run({ ...f, runtime: rt })
  assert.equal(result.passed, true)
  assert.deepEqual(rt.events, ['coverage', 'start', 'base', 'specific-analysis', 'head', 'cleanup'])
  const stored = readFileSync(join(f.root, 'coverage/sonar-ci-summary.json'), 'utf8')
  assert.ok(!stored.includes('scan-fixture')); assert.ok(!stored.includes('review-fixture'))
  assert.equal(result.baseline.changed, false)
})
for (const [name, options, code] of [
  ['coverage failure still scans but cannot pass', { coverageExit: 1 }, 'TESTS_OR_COVERAGE_FAILED'],
  ['low diff coverage fails independently', { lowCoverage: true }, 'GIT_DIFF_COVERAGE_NOT_VERIFIED'],
  ['new finding fails', { newIssue: true }, 'UNREVIEWED_FINDINGS'],
  ['hotspot fails', { hotspot: true }, 'UNREVIEWED_HOTSPOTS'],
  ['scanner failure cleans', { scanFailure: true }, 'CI_SCANNER_FAILED'],
  ['replaced analysis fails', { replaced: true }, 'CI_HEAD_ANALYSIS_NOT_CURRENT'],
  ['cleanup failure fails', { cleanupFailure: true }, 'CI_RESOURCE_CLEANUP_FAILED'],
]) test(name, async t => {
  const f = fixture(t), rt = runtime(f, options)
  const result = await run({ ...f, runtime: rt })
  assert.equal(result.passed, false); assert.ok(result.failures.includes(code), JSON.stringify(result))
  assert.equal(rt.events.at(-1), 'cleanup')
})

test('invalid or incomplete coverage stops before creating any Docker resource', async t => {
  const f = fixture(t), rt = runtime(f)
  const collect = rt.execute
  rt.execute = () => {
    collect()
    const file = join(f.root, 'coverage/summary.json'), value = JSON.parse(readFileSync(file, 'utf8'))
    value.inventory.missing = ['apps/backend/src/missing.ts']
    writeFileSync(file, JSON.stringify(value))
    return 0
  }
  const result = await run({ ...f, runtime: rt })
  assert.equal(result.passed, false)
  assert.ok(result.failures.includes('CI_COMPLETE_FRESH_COVERAGE_REQUIRED'))
  assert.deepEqual(rt.events, ['coverage'])
})
test('source mutation during coverage is rejected rather than scanning mismatched evidence', async t => {
  const f = fixture(t), rt = runtime(f)
  const collect = rt.execute
  rt.execute = () => { collect(); writeFileSync(join(f.root, 'candidate.txt'), 'mutated'); return 0 }
  const result = await run({ ...f, runtime: rt })
  assert.ok(result.failures.includes('CI_SOURCE_CHANGED_DURING_COVERAGE'))
  assert.deepEqual(rt.events, ['coverage'])
})
test('job summary reports baseline digest and changes without publishing secrets', async t => {
  const f = fixture(t), rt = runtime(f), summaryFile = join(f.root, 'job-summary.md')
  const previous = process.env.GITHUB_STEP_SUMMARY
  process.env.GITHUB_STEP_SUMMARY = summaryFile
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = previous })
  const result = await run({ ...f, runtime: rt })
  const text = readFileSync(summaryFile, 'utf8')
  assert.equal(result.passed, true)
  assert.ok(text.includes(result.baseline.sha256))
  assert.ok(text.includes(f.base)); assert.ok(text.includes(f.head))
  assert.ok(!text.includes('review-fixture')); assert.ok(!text.includes('scan-fixture'))
})
test('a concurrent analysis during export invalidates the collected findings', async t => {
  const f = fixture(t), rt = runtime(f)
  let calls = 0
  rt.readClient = () => async () => ({ analyses: [{ key: ++calls === 1 ? 'analysis-head' : 'foreign' }] })
  const result = await run({ ...f, runtime: rt })
  assert.ok(result.failures.includes('CI_HEAD_ANALYSIS_REPLACED'))
  assert.equal(rt.events.at(-1), 'cleanup')
})
for (const change of ['working-source', 'head-commit', 'fingerprint']) test(`rejects ${change} mutation during scanner`, async t => {
  const f = fixture(t), rt = runtime(f), analyze = rt.analyze
  let changed = false
  rt.analyze = async input => {
    const result = await analyze(input)
    if (input.stage === 'head') {
      if (change === 'working-source') writeFileSync(join(f.root, 'candidate.txt'), 'changed during scan')
      if (change === 'head-commit') execFileSync('/usr/bin/git', ['commit', '--allow-empty', '-m', 'foreign candidate'], { cwd: f.root, stdio: 'ignore' })
      changed = true
    }
    return result
  }
  if (change === 'fingerprint') rt.fingerprint = async () => (changed ? 'b' : 'a').repeat(64)
  const result = await run({ ...f, runtime: rt })
  assert.ok(result.failures.includes('CI_SOURCE_CHANGED_DURING_ANALYSIS'))
  assert.equal(rt.events.at(-1), 'cleanup')
})
test('rejects source mutation after scanner while exporting findings', async t => {
  const f = fixture(t), rt = runtime(f), collect = rt.exportFindings
  rt.exportFindings = async args => {
    const result = await collect(args)
    writeFileSync(join(f.root, 'candidate.txt'), 'changed during export')
    return result
  }
  const result = await run({ ...f, runtime: rt })
  assert.ok(result.failures.includes('CI_SOURCE_CHANGED_DURING_EXPORT'))
  assert.equal(rt.events.at(-1), 'cleanup')
})

for (const prior of ['absent', 'different']) test(`orchestration uses candidate config for a base with ${prior} properties`, async t => {
  const f = fixture(t, prior), rt = runtime(f), snapshots = [], analyze = rt.analyze
  rt.analyze = async input => { snapshots.push({ root: input.root, settings: input.settings, bytes: readFileSync(input.settings, 'utf8') }); return analyze(input) }
  const result = await run({ ...f, runtime: rt })
  assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(snapshots.length, 2)
  assert.notEqual(snapshots[0].root, snapshots[1].root)
  assert.equal(snapshots[0].settings, join(snapshots[0].root, 'sonar-project.properties'))
  assert.equal(snapshots[0].bytes, snapshots[1].bytes)
  assert.deepEqual(result.scannerConfiguration.base, result.scannerConfiguration.head)
})
for (const mode of ['missing', 'wrong', 'mutated']) test(`orchestration refuses ${mode} effective configuration evidence`, async t => {
  const f = fixture(t), rt = runtime(f), analyze = rt.analyze
  rt.analyze = async input => {
    if (mode === 'missing') return 'analysis-base'
    const result = await analyze(input)
    if (mode === 'wrong') input.onConfiguration({ contextVerified: true, sha256: input.settingsHash, effectiveProperties: { 'sonar.sources': '.' } })
    else writeFileSync(input.settings, 'sonar.projectKey=nodeaccess\nsonar.sources=wrong\n')
    return result
  }
  const result = await run({ ...f, runtime: rt })
  assert.equal(result.passed, false)
  assert.ok(result.failures.includes(mode === 'mutated' ? 'CI_SETTINGS_CHANGED' : 'CI_EFFECTIVE_SETTINGS_NOT_VERIFIED'), JSON.stringify(result))
  assert.equal(rt.events.at(-1), 'cleanup')
})
