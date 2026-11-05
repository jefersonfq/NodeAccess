import test from 'node:test'
import assert from 'node:assert/strict'
import { validCspHarnessReport, verifiedCspCoverage, lifecycleScenarios, supervisionScenarios } from './csp-coverage-policy.mjs'
import { collectCspCoverage } from './csp-coverage.mjs'
test('laboratory cannot activate accidentally or accept arbitrary run IDs', async () => {
  await assert.rejects(collectCspCoverage({}), /opt-in/)
  await assert.rejects(collectCspCoverage({ NODEACCESS_CSP_COVERAGE: 'true', NODEACCESS_CSP_COVERAGE_RUN_ID: '../outside' }), /opt-in/)
})
test('individual CSP reports require actual assertions and no skipped sanitizer', () => {
  for (const name of ['styles', 'editor', 'lifecycle', 'supervision', 'sanitizer', 'unknown']) assert.equal(validCspHarnessReport(name, {}), false)
  assert.equal(validCspHarnessReport('sanitizer', { tests: 1, pass: 1, fail: 0, skipped: 1 }), false)
  assert.equal(validCspHarnessReport('lifecycle', { scenarios: Array(12), runtimeErrors: ['failure'] }), false)
  assert.equal(verifiedCspCoverage('/nonexistent', {}), false)
})

test('lifecycle and supervision proofs reject missing, repeated and fabricated scenarios', () => {
  const lifecycle = { scenarios: [...lifecycleScenarios], runtimeErrors: [] }
  assert.equal(validCspHarnessReport('lifecycle', lifecycle), true)
  for (const scenarios of [Array(12).fill(null), Array(12).fill(lifecycleScenarios[0]), lifecycleScenarios.slice(1), [...lifecycleScenarios, 'extra']]) assert.equal(validCspHarnessReport('lifecycle', { ...lifecycle, scenarios }), false)
  const rows = ['dark', 'light'].flatMap(theme => supervisionScenarios.map(name => ({ theme, name, passed: true })))
  assert.equal(validCspHarnessReport('supervision', rows), true)
  for (const bad of [rows.slice(1), Array(10).fill(rows[0]), rows.map(row => ({ ...row, name: 'fabricated' })), rows.map(row => ({ ...row, passed: false }))]) assert.equal(validCspHarnessReport('supervision', bad), false)
})
