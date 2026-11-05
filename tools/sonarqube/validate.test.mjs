import test from 'node:test'
import assert from 'node:assert/strict'
import { validationOutcome } from './validate.mjs'
const ready = { toolingExit: 0, coverageExit: 0, scannerExit: 0, comparison: { passed: true }, gate: { status: 'OK', conditions: [{ status: 'OK' }] }, analysisVerified: true, hotspotsToReview: 0 }
test('green Sonar gate never overrides failed tests, coverage, analysis or new findings', () => {
 assert.equal(validationOutcome(ready).passed, true)
 for (const change of [{ hotspotsToReview: 1 }, { toolingExit: 1 }, { coverageExit: 1 }, { scannerExit: 1 }, { comparison: { passed: false } }, { analysisVerified: false }, { gate: { status: 'ERROR' } }]) assert.equal(validationOutcome({ ...ready, ...change }).passed, false)
})
test('ignored or empty gate conditions are explicit warnings, not proof of coverage', () => {
 for (const gate of [{ status: 'OK', conditions: [] }, { status: 'OK', ignoredConditions: true }]) {
  const result = validationOutcome({ ...ready, gate }); assert.equal(result.warnings.length, 1)
  assert.equal(validationOutcome({ ...ready, gate, coverageExit: 1 }).passed, false)
 }
})
test('green gate does not override an obsolete or unapplied review manifest', () => {
 const result = validationOutcome({ ...ready, reviewsVerified: false })
 assert.equal(result.passed, false)
 assert.ok(result.failures.includes('REVIEWED_FINDINGS_NOT_VERIFIED'))
})
