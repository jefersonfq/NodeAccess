#!/usr/bin/env node
/** Run the existing Chromium DOM matrix against a real Vite module, not serialized function text.
 * The coverage collector owns Vite, the exact source allowlist, capture identity and final mapping.
 * chrome.runtime is stubbed in this DOM suite; isolated-world/MV3 authorization remains a separate E2E.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '../..')
const output = resolve(process.env.ARTIFACTS_DIR ?? join(root, '.tmp/NA-0203/site-assistance-dom-coverage'))
mkdirSync(output, { recursive: true, mode: 0o700 })
const files = ['apps/extension/src/adapters/site-assistance.ts', 'apps/extension/src/adapters/site-assistance.test.ts',
  'tools/vault-extension/site-assistance-dom-coverage.mjs']
const fingerprint = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]))
const report = { status: 'failed', startedAt: new Date().toISOString(), files, before: fingerprint(),
  boundary: 'Real Chromium DOM/events; runtime transport stubbed. Coverage only from Vite-imported original module; MV3 security is validated separately. Disposable browser contexts grant local-network-access only to https://login.example.test for the loopback collector. No browser security flags or production permissions changed. Vitest driver child is outside native Node collection; wrapper retains Node coverage.' }
try {
  const base = new URL(process.env.FRONTEND_BASE ?? '')
  assert.ok(base.protocol === 'http:' && base.hostname === '127.0.0.1' && base.port && base.origin === process.env.FRONTEND_BASE, 'Explicit collector loopback origin required')
  assert.ok(process.env.BROWSER_COVERAGE_DIR && process.env.BROWSER_COVERAGE_RUN_ID && process.env.PLAYWRIGHT_EXECUTABLE_PATH, 'Collector capture identity, directory and pinned Chromium required')
  // Complete Vite's first transform before the unchanged per-test deadline starts.
  const moduleResponse = await fetch(`${base.origin}/@fs${join(root, files[0])}`, { signal: AbortSignal.timeout(10000) })
  await moduleResponse.text()
  assert.equal(moduleResponse.status, 200, 'Original helper module must be ready')
  // Vitest transforms TS: it is not a native-TS Node provenance source. Only this
  // browser-driver child is outside Node collection; its real module runs under CDP.
  // The wrapper itself retains the collector's native Node coverage environment.
  const childEnv = { ...process.env, NODEACCESS_SITE_ASSISTANCE_MODULE_COVERAGE: '1' }
  delete childEnv.NODE_V8_COVERAGE
  delete childEnv.NODEACCESS_NATIVE_TS_PROVENANCE
  delete childEnv.NODE_OPTIONS
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'apps/extension/src/adapters/site-assistance.test.ts', '--reporter=json', `--outputFile=${join(output, 'vitest.json')}`], {
    cwd: root, env: childEnv, encoding: 'utf8', timeout: 110000,
  })
  writeFileSync(join(output, 'vitest.log'), (result.stdout ?? '') + (result.stderr ?? ''))
  if (result.error) throw result.error
  assert.equal(result.status, 0, 'Chromium DOM matrix failed; inspect vitest.log and vitest.json')
  const tests = JSON.parse(readFileSync(join(output, 'vitest.json'), 'utf8'))
  assert.equal(tests.success, true)
  assert.equal(tests.numFailedTests, 0)
  assert.equal(tests.numPendingTests, 0)
  assert.ok(tests.numPassedTests >= 31, 'The full established DOM matrix must execute')
  report.tests = { passed: tests.numPassedTests, failed: tests.numFailedTests, pending: tests.numPendingTests }
  report.status = 'passed'
} catch (error) { report.error = String(error.message ?? error); process.exitCode = 1 }
finally {
  report.after = fingerprint(); report.sourceChanged = JSON.stringify(report.before) !== JSON.stringify(report.after)
  if (report.sourceChanged) { report.status = 'failed'; process.exitCode = 1 }
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
