import test from 'node:test'
import assert from 'node:assert/strict'
import { baselineSummary, commitSha, scannerEnvironment, ciOutcome, validateCoverageMetadata } from './ci-policy.mjs'
import { images, publishedServer, api, secret } from './ci-server.mjs'
const row = { signature: 'a'.repeat(64), count: 2, status: 'context_reviewed', reason: 'Reviewed occurrence', evidence: ['docs/evidence.md'] }
const baseline = rows => JSON.stringify({ schemaVersion: 1, findings: rows })
test('baseline preserves multiplicity and records bootstrap/digest/change review', () => {
  const result = baselineSummary(baseline([row]), baseline([{ ...row, count: 1 }]))
  assert.equal(result.addedOccurrences, 1); assert.equal(result.occurrences, 2)
  assert.equal(result.reviewRequired, true); assert.equal(result.sha256.length, 64)
  assert.equal(baselineSummary(baseline([row])).bootstrap, true)
  assert.equal(baselineSummary(baseline([row]), baseline([row])).changed, false)
  assert.equal(baselineSummary(baseline([]), baseline([row])).removedOccurrences, 2)
  assert.throws(() => baselineSummary(baseline([{ ...row, evidence: [] }])))
  assert.throws(() => baselineSummary(baseline([row, row])))
})
test('commit and ephemeral port validation reject shell syntax and local existing server', () => {
  assert.equal(commitSha('a'.repeat(40)), 'a'.repeat(40))
  for (const value of ['0'.repeat(40), 'HEAD', 'abc;echo', null]) assert.throws(() => commitSha(value))
  assert.equal(publishedServer('127.0.0.1:32145'), 'http://127.0.0.1:32145')
  for (const value of ['127.0.0.1:9000', '0.0.0.0:32145', '127.0.0.1:70000', '127.0.0.1:80']) assert.throws(() => publishedServer(value))
  assert.match(images.sonar, /@sha256:[a-f0-9]{64}$/)
  assert.match(images.postgres, /@sha256:[a-f0-9]{64}$/)
})
test('scanner has no inherited credentials or GitHub PR autodetection parameters', () => {
  const env = scannerEnvironment({ PATH: '/usr/bin', GITHUB_TOKEN: 'private', GITHUB_ACTIONS: 'true',
    SONAR_SCANNER_OPTS: 'override', SONARQUBE_SCANNER_PARAMS: 'override', JAVA_TOOL_OPTIONS: 'override' }, 'http://127.0.0.1:30000', 'ephemeral')
  assert.deepEqual(env, { PATH: '/usr/bin', SONAR_HOST_URL: 'http://127.0.0.1:30000', SONAR_TOKEN: 'ephemeral' })
})
test('first analysis/ignored conditions and failed coverage never become green', () => {
  const good = { coverageExit: 0, diffCoveragePassed: true, comparison: { passed: true }, gate: { status: 'OK', ignoredConditions: false }, analysisVerified: true, hotspotsToReview: 0 }
  assert.equal(ciOutcome(good).passed, true)
  for (const change of [{ coverageExit: 1 }, { diffCoveragePassed: false }, { analysisVerified: false },
    { comparison: { passed: false } }, { hotspotsToReview: 1 }, { gate: { status: 'OK', ignoredConditions: true } }, { gate: { status: 'OK' } }, { gate: null }]) {
    assert.equal(ciOutcome({ ...good, ...change }).passed, false)
  }
})
test('API refuses external origin before sending credentials', async () => {
  await assert.rejects(api('http://127.0.0.1:30000', 'u', 'p')('https://example.com/api/users'), /CI_API_PATH_REFUSED/)
  await assert.rejects(api('http://127.0.0.1:30000', 'u', 'p')('/not-api'), /CI_API_PATH_REFUSED/)
})

test('coverage proof requires fresh complete candidate data and unchanged legacy thresholds', () => {
  const coverage = { schemaVersion: 1, head: 'h', resolvedBase: 'b', sourceFingerprint: 'a'.repeat(64),
    startedAt: '2026-11-03T18:00:00Z', finishedAt: '2026-11-03T18:01:00Z', status: 'passed', failures: [], newCoverage: { status: 'passed', base: 'b', head: 'h', threshold: 80, percent: 100, missing: [] },
    inventory: { count: 100, reportedCount: 100, missing: [] },
    legacy: { pattern: 'apps/backend/src/modules/**/*.service.ts', thresholds: { lines: 70, functions: 70, branches: 60 }, passed: true } }
  const expected = { base: 'b', head: 'h', started: Date.parse(coverage.startedAt) }
  assert.equal(validateCoverageMetadata(coverage, expected), true)
  assert.equal(validateCoverageMetadata({ ...coverage, status: 'failed' }, expected), false)
  for (const change of [{ error: 'conversion failed' }, { failures: ['COVERAGE_PIPELINE_FAILED'] },
    { newCoverage: undefined }, { newCoverage: { ...coverage.newCoverage, missing: ['source.js'] } }]) {
    assert.throws(() => validateCoverageMetadata({ ...coverage, ...change }, expected), /CI_/)
  }
  assert.throws(() => validateCoverageMetadata(coverage, { ...expected, fingerprint: 'b'.repeat(64) }), /FINGERPRINT/)
  assert.equal(validateCoverageMetadata(coverage, { ...expected, fingerprint: 'a'.repeat(64) }), true)
  for (const change of [{ resolvedBase: 'other' }, { startedAt: 'invalid' },
    { startedAt: '2026-11-03T17:00:00Z' }, { sourceFingerprint: '' },
    { inventory: { count: 100, reportedCount: 99, missing: [] } },
    { legacy: { ...coverage.legacy, thresholds: { lines: 60, functions: 70, branches: 60 } } }]) {
    assert.throws(() => validateCoverageMetadata({ ...coverage, ...change }, expected), /FRESH_COVERAGE/)
  }
})

test('ephemeral passwords retain entropy and satisfy mixed character classes', () => {
  const value = secret()
  assert.match(value, /[A-Z]/); assert.match(value, /[a-z]/); assert.match(value, /[0-9]/); assert.match(value, /[!]/)
  assert.match(value, /^Aa1![a-f0-9]{64}$/)
  assert.notEqual(value, secret())
})
