import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectBrowserCoverage, executeBrowserHarness, waitForBrowserModules } from './browser.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'na0090-browser-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function fakeVite(options = {}) {
  let closed = false
  return { get closed() { return closed }, async create(config) {
    assert.equal(config.configFile, false)
    assert.equal(config.server.host, '127.0.0.1'); assert.deepEqual(config.server.proxy, {})
    const middleware = []
    config.plugins[1].configureServer({ middlewares: { use(fn) { middleware.push(fn) } } })
    const server = http.createServer((request, response) => middleware[0](request, response, () => response.end('export const fixture = true')))
    return {
      httpServer: options.badAddress ? { address: () => ({ address: '0.0.0.0', port: server.address().port }) } : server,
      listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)),
      close: async () => {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); closed = true
        if (options.closeFailure) throw new Error('fixture cleanup failed')
      },
    }
  } }
}
test('isolated browser orchestration uses loopback fixtures and private outputs without app/backend proxy', async t => {
  const root = fixture(t), vite = fakeVite(), runs = []
  const result = await collectBrowserCoverage({ root, env: { NODE_V8_COVERAGE: '/synthetic/raw', PLAYWRIGHT_EXECUTABLE_PATH: '/synthetic/chromium', SONAR_ASSIGNED: '/wrong/fixture', SONAR_TOKEN: 'synthetic-secret', SONAR_REVIEW_TOKEN: 'synthetic-read' }, create: vite.create,
    execute: async (_root, script, env) => {
      runs.push(script)
      assert.equal(env.SONAR_TOKEN, undefined); assert.equal(env.SONAR_REVIEW_TOKEN, undefined)
      assert.equal(env.SONAR_ASSIGNED, join(root, 'docs/changes/2026/11/NA-0087-sonar-frontend/dispositions.json'))
      assert.equal(env.NODE_V8_COVERAGE, '/synthetic/raw'); assert.equal(env.CHROMIUM_PATH, '/synthetic/chromium')
      assert.ok(env.SONAR_REVIEW_OUTPUT.startsWith(join(root, 'coverage/browser/')))
      const html = await (await fetch(env.FRONTEND_BASE)).text()
      assert.match(html, /Isolated coverage fixture/); assert.doesNotMatch(html, /src\/main/)
      assert.equal((await fetch(env.FRONTEND_BASE + '/api/v1/user')).status, 404)
      return { exitCode: 0, timedOut: false }
    } })
  assert.equal(result.status, 'passed'); assert.equal(vite.closed, true)
  assert.deepEqual(runs, ['tools/frontend/sonar-frontend-review.cjs', 'tools/sonarqube/table-review.cjs'])
  assert.equal(JSON.parse(readFileSync(join(root, 'coverage/browser/summary.json'))).status, 'passed')
  assert.equal(statSync(join(root, 'coverage/browser')).mode & 0o777, 0o700)
})
for (const [name, options, outcome] of [
  ['harness nonzero', {}, { exitCode: 1, timedOut: false }],
  ['harness deadline', {}, { exitCode: 0, timedOut: true }],
  ['non-loopback server', { badAddress: true }, { exitCode: 0, timedOut: false }],
  ['cleanup failure', { closeFailure: true }, { exitCode: 0, timedOut: false }],
]) test(`browser phase fails closed and cleans server on ${name}`, async t => {
  const root = fixture(t), vite = fakeVite(options)
  const result = await collectBrowserCoverage({ root, env: {}, create: vite.create, execute: async () => outcome })
  assert.equal(result.status, 'failed'); assert.equal(vite.closed, true)
  assert.equal(JSON.parse(readFileSync(join(root, 'coverage/browser/summary.json'))).status, 'failed')
})
test('browser setup errors remain explicit without claiming a harness ran', async t => {
  const root = fixture(t)
  const result = await collectBrowserCoverage({ root, create: () => { throw new Error('fixture setup unavailable') } })
  assert.equal(result.status, 'failed'); assert.deepEqual(result.harnesses, []); assert.equal(result.error, 'fixture setup unavailable')
})
test('module readiness tolerates startup response then rejects an unavailable fixture within a deadline', async () => {
  let calls = 0
  await waitForBrowserModules('http://127.0.0.1:1', { fetcher: async () => new Response('fixture', { status: ++calls === 1 ? 503 : 200 }) })
  assert.equal(calls, 3)
  await assert.rejects(waitForBrowserModules('http://127.0.0.1:1', { timeoutMs: 1, fetcher: async () => { throw new Error('offline') } }), /did not become ready/)
})
test('real harness subprocesses retain logs, nonzero exits and forced termination', async t => {
  const root = fixture(t)
  writeFileSync(join(root, 'success.cjs'), "console.log('synthetic success')")
  const success = await executeBrowserHarness(root, 'success.cjs', process.env, join(root, 'success.log'))
  assert.deepEqual(success, { exitCode: 0, timedOut: false })
  assert.match(readFileSync(join(root, 'success.log'), 'utf8'), /synthetic success/)
  assert.equal(statSync(join(root, 'success.log')).mode & 0o777, 0o600)
  writeFileSync(join(root, 'failure.cjs'), 'process.exitCode = 7')
  assert.equal((await executeBrowserHarness(root, 'failure.cjs', process.env, join(root, 'failure.log'))).exitCode, 7)
  writeFileSync(join(root, 'blocked.cjs'), 'setInterval(() => {}, 1000)')
  const blocked = await executeBrowserHarness(root, 'blocked.cjs', process.env, join(root, 'blocked.log'), 50)
  assert.equal(blocked.timedOut, true); assert.notEqual(blocked.exitCode, 0)
  await assert.rejects(executeBrowserHarness(join(root, 'missing-cwd'), 'success.cjs', process.env, join(root, 'spawn-error.log')), /ENOENT/)
})
