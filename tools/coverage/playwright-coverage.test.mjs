import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { attachBrowserCoverage } from './playwright-coverage.cjs'

async function fixture(t, fail = false) {
  const output = await mkdtemp(join(tmpdir(), 'chromium-hook-')); t.after(() => rm(output, { recursive: true, force: true }))
  const calls = [], owner = name => ({ close: async () => { calls.push(name) } }), browser = owner('browser'), context = owner('context'), page = owner('page')
  page.context = () => context
  page.coverage = { startJSCoverage: async options => { calls.push(options) }, stopJSCoverage: async () => {
    calls.push('stop'); await new Promise(resolve => setTimeout(resolve, 5))
    if (fail) throw new Error('CDP capture failed')
    return [
      { url: 'http://127.0.0.1:1234/src/example.ts', source: 'export const value = 1', functions: [] },
      { url: '', source: 'anonymous page.evaluate fixture', functions: [] },
      { url: 'http://foreign.test/src/example.ts', source: 'foreign', functions: [] },
      { url: 'http://127.0.0.1:1234/src/Example.vue?vue&type=style', source: 'CSS glue', functions: [] },
      { url: 'http://127.0.0.1:1234/node_modules/vue.js', source: 'dependency', functions: [] },
    ]
  } }
  return { output, calls, browser, context, page, env: { BROWSER_COVERAGE_DIR: output, BROWSER_COVERAGE_RUN_ID: '00000000-0000-4000-8000-000000000001', FRONTEND_BASE: 'http://127.0.0.1:1234' } }
}
test('disabled capture has no browser effects', async () => { assert.equal(await attachBrowserCoverage({}, {}, {}), undefined) })
for (const closing of ['page', 'context', 'browser']) test(`captures privately before early ${closing} closure and does not recapture`, async t => {
  const f = await fixture(t); await attachBrowserCoverage(f.page, f.browser, f.env)
  await f[closing].close(); await f.browser.close()
  assert.equal(f.calls.filter(item => item === 'stop').length, 1)
  assert.ok(f.calls.indexOf('stop') < f.calls.indexOf(closing))
  const names = await readdir(f.output); assert.equal(names.length, 1)
  const path = join(f.output, names[0]), report = JSON.parse(await readFile(path, 'utf8'))
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(report.captureRunId, f.env.BROWSER_COVERAGE_RUN_ID); assert.equal(report.scripts.length, 1)
  assert.equal(report.scripts[0].source, 'export const value = 1'); assert.deepEqual(report.excluded, { external: 2, dependenciesOrGenerated: 2 })
  assert.equal(f.calls[0].reportAnonymousScripts, false); assert.equal(f.calls[0].resetOnNavigation, false)
})
test('concurrent closure awaits a single capture before closing owners', async t => {
  const f = await fixture(t); await attachBrowserCoverage(f.page, f.browser, f.env)
  await Promise.all([f.page.close(), f.browser.close()])
  assert.equal(f.calls.filter(item => item === 'stop').length, 1); assert.equal((await readdir(f.output)).length, 1)
})
test('CDP failure still closes browser and fails the harness without a success artifact', async t => {
  const f = await fixture(t, true); await attachBrowserCoverage(f.page, f.browser, f.env)
  await assert.rejects(f.browser.close(), /CDP capture failed/)
  assert.ok(f.calls.includes('browser')); assert.deepEqual(await readdir(f.output), [])
})
test('capture rejects non-loopback origin or missing run identity before starting CDP', async t => {
  const f = await fixture(t)
  await assert.rejects(attachBrowserCoverage(f.page, f.browser, { ...f.env, FRONTEND_BASE: 'https://example.test' }), /loopback/)
  await assert.rejects(attachBrowserCoverage(f.page, f.browser, { ...f.env, BROWSER_COVERAGE_RUN_ID: '' }), /identity/)
  assert.deepEqual(f.calls, [])
})

test('browser closure captures multiple pages and contexts exactly once', async t => {
  const first = await fixture(t), second = await fixture(t)
  await attachBrowserCoverage(first.page, first.browser, first.env)
  await attachBrowserCoverage(second.page, first.browser, first.env)
  await first.context.close(); await first.browser.close()
  assert.equal(first.calls.filter(item => item === 'stop').length, 1)
  assert.equal(second.calls.filter(item => item === 'stop').length, 1)
  assert.equal((await readdir(first.output)).length, 2)
})
