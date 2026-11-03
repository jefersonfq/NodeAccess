import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rehearsal } from './ci-rehearsal.mjs'
import { readConfiguration } from './ci-config.mjs'

test('rehearsal exercises real Node coverage and requires positive and negative scanner outcomes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-rehearsal-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let cleaned = false
  const scans = []
  const result = await rehearsal(join(dir, 'summary.json'), {
    start: async () => ({ server: 'http://127.0.0.1:32145', admin: async () => {}, cleanup: async () => { cleaned = true } }),
    configure: async () => ({ scan: 'scan', review: 'review' }),
    analyze: async ({ root, stage, settings, onConfiguration }) => {
      const config = readConfiguration(settings); onConfiguration({ sha256: config.sha256, effectiveProperties: config.properties, contextVerified: true })
      scans.push(stage)
      if (stage !== 'base') {
        const lcov = readFileSync(join(root, 'coverage/lcov.info'), 'utf8')
        assert.match(lcov, /SF:.*math\.js/)
        assert.match(lcov, /DA:2,1/)
        if (stage === 'uncovered') assert.match(lcov, /DA:6,0/)
      }
      return stage
    },
    readClient: () => async (path, params) => path === '/api/measures/component' ? { component: { measures: [] } }
      : { projectStatus: params.analysisId === 'covered'
        ? { status: 'OK', ignoredConditions: false, conditions: [{ metricKey: 'new_coverage', status: 'OK', actualValue: '100' }] }
        : { status: 'ERROR', conditions: [{ metricKey: 'new_coverage', status: 'ERROR', actualValue: '0' }] } },
  })
  if (result.privateDiagnostics) t.after(() => rmSync(result.privateDiagnostics, { recursive: true, force: true }))
  assert.equal(result.passed, true, JSON.stringify(result))
  assert.deepEqual(scans, ['base', 'covered', 'uncovered']); assert.equal(cleaned, true)
  assert.ok(!readFileSync(join(dir, 'summary.json'), 'utf8').includes('privateDiagnostics'))
})
test('rehearsal cannot report success when a green first scan has no proven new coverage', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-rehearsal-negative-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const result = await rehearsal(join(dir, 'summary.json'), {
    start: async () => ({ server: 'http://127.0.0.1:32145', admin: async () => {}, cleanup: async () => {} }),
    configure: async () => ({ scan: 'scan', review: 'review' }), analyze: async ({ onConfiguration }) => { onConfiguration({ contextVerified: true }); return 'id' },
    readClient: () => async path => path === '/api/measures/component' ? { component: { measures: [] } }
      : { projectStatus: { status: 'OK', conditions: [] } },
  })
  t.after(() => rmSync(result.privateDiagnostics, { recursive: true, force: true }))
  assert.equal(result.passed, false)
  assert.equal(result.error, 'CI_REHEARSAL_COVERED_NEW_CODE_NOT_PROVEN')
  assert.equal(result.cleanup, 'complete')
})
