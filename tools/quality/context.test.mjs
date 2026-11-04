import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { summarizeQuality, latestValidation } from './context.mjs'
const fixture = () => ({ head: 'current', dirty: false,
  validation: { schemaVersion: 1, finishedAt: '2026-11-04T18:00:00Z', head: 'current', passed: true, analysisVerified: true, reviewsVerified: true, toolingExit: 0, coverageExit: 0, scannerExit: 0, gate: { status: 'OK' }, analysisId: 'analysis' },
  coverage: { head: 'current', status: 'passed', newCoverage: { percent: 81 } },
  catalog: { latestAnalysis: { revision: 'current' }, findings: [{ sonarState: 'OPEN' }, { sonarState: 'FALSE_POSITIVE' }] } })
test('summarizes current evidence without exposing report contents or converting review into fixes', () => {
  const input = fixture(); input.validation.secret = 'PRIVATE_SENTINEL'; input.catalog.findings[0].rationale = 'PRIVATE_SENTINEL'
  const result = summarizeQuality(input)
  assert.equal(result.sonar.gate, 'OK'); assert.equal(result.coverage.diffPercent, 81)
  assert.deepEqual(result.catalog.counts, { OPEN: 1, FALSE_POSITIVE: 1 })
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false)
})
for (const [name, mutate] of [
  ['dirty tree including untracked files', x => { x.dirty = true }],
  ['old revision', x => { x.head = 'new' }],
  ['missing analysis ID', x => { delete x.validation.analysisId }],
  ['missing completion', x => { delete x.validation.finishedAt }],
  ['unknown report schema', x => { x.validation.schemaVersion = 2 }],
  ['failed tests', x => { x.validation.coverageExit = 1 }],
  ['failed scanner', x => { x.validation.scannerExit = 1 }],
  ['unverified analysis', x => { x.validation.analysisVerified = false }],
  ['unverified review', x => { x.validation.reviewsVerified = false }],
  ['failed gate', x => { x.validation.gate.status = 'ERROR' }],
  ['failed validation', x => { x.validation.passed = false }],
]) test(`${name} cannot report a verified green gate`, () => {
  const input = fixture(); mutate(input); assert.equal(summarizeQuality(input).sonar.gate, 'unverified')
})
test('missing evidence stays unknown', () => {
  const result = summarizeQuality({ head: 'current', dirty: false })
  assert.equal(result.sonar.evidence, 'missing'); assert.equal(result.coverage.diffPercent, null)
})
test('newer incomplete validation does not reuse older green evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'na-quality-context-'))
  try {
    assert.equal(latestValidation(root), null)
    const reports = join(root, '.sonar-reports'); mkdirSync(reports)
    mkdirSync(join(reports, 'validation-100-abc')); writeFileSync(join(reports, 'validation-100-abc/validation.json'), '{"passed":true}')
    assert.equal(latestValidation(root).passed, true)
    mkdirSync(join(reports, 'validation-200-def')); assert.equal(latestValidation(root), null)
    writeFileSync(join(reports, 'validation-200-def/validation.json'), 'invalid')
    assert.throws(() => latestValidation(root), /QUALITY_CONTEXT_INVALID_REPORT/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
