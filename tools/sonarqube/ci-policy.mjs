import { createHash } from 'node:crypto'
import { compareFindings } from './ledger.mjs'

export function commitSha(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value) || /^0+$/.test(value)) throw new Error('CI_VALID_BASE_SHA_REQUIRED')
  return value
}
export function baselineSummary(candidateText, baseText = null) {
  const candidate = JSON.parse(candidateText)
  compareFindings([], candidate)
  const digest = value => createHash('sha256').update(value).digest('hex')
  let previous = null
  if (baseText !== null) {
    previous = JSON.parse(baseText); compareFindings([], previous)
  }
  const counts = rows => new Map(rows.map(row => [row.signature, row.count]))
  const before = counts(previous?.findings ?? []), after = counts(candidate.findings)
  let added = 0, removed = 0
  for (const [key, count] of after) added += Math.max(0, count - (before.get(key) ?? 0))
  for (const [key, count] of before) removed += Math.max(0, count - (after.get(key) ?? 0))
  return { sha256: digest(candidateText), baseSha256: baseText === null ? null : digest(baseText),
    bootstrap: baseText === null, changed: baseText !== candidateText, signatures: after.size,
    occurrences: [...after.values()].reduce((sum, count) => sum + count, 0), addedOccurrences: added, removedOccurrences: removed,
    reviewRequired: baseText !== candidateText }
}
export function scannerEnvironment(env, server, token) {
  const clean = { ...env }
  for (const key of Object.keys(clean)) {
    if (key.startsWith('SONAR_') || key.startsWith('SONARQUBE_') || key.startsWith('GITHUB_')
      || ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS'].includes(key)) delete clean[key]
  }
  return { ...clean, SONAR_HOST_URL: server, SONAR_TOKEN: token }
}
export function ciOutcome({ coverageExit, diffCoveragePassed, comparison, gate, analysisVerified, hotspotsToReview }) {
  const failures = []
  if (coverageExit !== 0) failures.push('TESTS_OR_COVERAGE_FAILED')
  if (diffCoveragePassed !== true) failures.push('GIT_DIFF_COVERAGE_NOT_VERIFIED')
  if (analysisVerified !== true) failures.push('BASE_HEAD_ANALYSES_NOT_VERIFIED')
  if (comparison?.passed !== true) failures.push('UNREVIEWED_FINDINGS')
  if (hotspotsToReview !== 0) failures.push('UNREVIEWED_HOTSPOTS')
  if (gate?.status !== 'OK') failures.push('QUALITY_GATE_NOT_OK')
  if (gate?.ignoredConditions !== false) failures.push('QUALITY_GATE_IGNORED_CONDITIONS')
  // Empty conditions can legitimately mean no measurable code changed. Git/LCOV
  // must independently prove either zero changed executable lines or >=80%.
  return { passed: failures.length === 0, failures }
}

export function validateCoverageMetadata(coverage, { base, head, started, fingerprint }) {
  const from = Date.parse(coverage?.startedAt), to = Date.parse(coverage?.finishedAt)
  if (coverage?.error || !Array.isArray(coverage?.failures)
    || coverage.failures.some(value => ['COVERAGE_PIPELINE_FAILED', 'SOURCE_CHANGED_DURING_COVERAGE'].includes(value))) throw new Error('CI_COVERAGE_PIPELINE_NOT_VERIFIED')
  if (base && (!coverage.newCoverage || !['passed', 'failed'].includes(coverage.newCoverage.status)
    || coverage.newCoverage.base !== base || coverage.newCoverage.head !== head || coverage.newCoverage.threshold !== 80
    || !Number.isFinite(coverage.newCoverage.percent) || coverage.newCoverage.percent < 0 || coverage.newCoverage.percent > 100
    || !Array.isArray(coverage.newCoverage.missing) || coverage.newCoverage.missing.length)) throw new Error('CI_DIFF_COVERAGE_METADATA_REQUIRED')
  if (fingerprint && fingerprint !== coverage.sourceFingerprint) throw new Error('CI_SOURCE_FINGERPRINT_MISMATCH')
  if (coverage?.schemaVersion !== 1 || coverage.head !== head || coverage.resolvedBase !== base
    || !Number.isFinite(from) || from < started || !Number.isFinite(to) || to < from
    || !/^[a-f0-9]{64}$/.test(coverage.sourceFingerprint ?? '')
    || !Array.isArray(coverage.inventory?.missing) || coverage.inventory.missing.length
    || !Number.isSafeInteger(coverage.inventory.count) || coverage.inventory.count < 1
    || coverage.inventory.reportedCount !== coverage.inventory.count
    || coverage.legacy?.pattern !== 'apps/backend/src/modules/**/*.service.ts'
    || coverage.legacy.thresholds?.lines !== 70 || coverage.legacy.thresholds?.functions !== 70
    || coverage.legacy.thresholds?.branches !== 60) throw new Error('CI_COMPLETE_FRESH_COVERAGE_REQUIRED')
  return coverage.status === 'passed' && Array.isArray(coverage.failures) && coverage.failures.length === 0
    && coverage.legacy.passed === true
}
