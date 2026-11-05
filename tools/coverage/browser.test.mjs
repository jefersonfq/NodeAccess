import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { chromium } from 'playwright'
import { mkdtempSync, mkdirSync, existsSync, symlinkSync, chmodSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectBrowserCoverage, executeBrowserHarness, waitForBrowserModules, requiredBrowserHarnesses } from './browser.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'na0090-browser-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function completeTlsReport(env) {
  if (env.RUN_TACACS_TLS_UX === 'true') writeFileSync(join(env.TACACS_TLS_UX_OUTPUT, 'report.json'), JSON.stringify({ passed: true, captureRunId: env.BROWSER_COVERAGE_RUN_ID, checks: Array.from({ length: 5 }, (_, index) => `Check ${index}`) }))
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
  mkdirSync(join(root, 'coverage/browser/chromium-v8'), { recursive: true })
  writeFileSync(join(root, 'coverage/browser/chromium-v8/stale.json'), 'previous run')
  const result = await collectBrowserCoverage({ root, env: { NODE_V8_COVERAGE: '/synthetic/raw', PLAYWRIGHT_EXECUTABLE_PATH: '/synthetic/chromium', SONAR_ASSIGNED: '/wrong/fixture', RUN_TACACS_TLS_UX: 'false', TACACS_TLS_UX_OUTPUT: '/wrong/tls', SONAR_TOKEN: 'synthetic-secret', SONAR_REVIEW_TOKEN: 'synthetic-read' }, create: vite.create,
    execute: async (_root, script, env) => {
      runs.push(script)
      const tls = script.endsWith('tls-ux.test.cjs')
      assert.equal(env.RUN_TACACS_TLS_UX, tls ? 'true' : undefined)
      assert.equal(env.TACACS_TLS_UX_OUTPUT, tls ? env.SONAR_REVIEW_OUTPUT : undefined)
      completeTlsReport(env)
      assert.equal(existsSync(join(root, 'coverage/browser/chromium-v8/stale.json')), false)
      assert.equal(env.SONAR_TOKEN, undefined); assert.equal(env.SONAR_REVIEW_TOKEN, undefined)
      assert.equal(env.SONAR_ASSIGNED, join(root, 'docs/changes/2026/11/NA-0087-sonar-frontend/dispositions.json'))
      if (['sonar-frontend-review.cjs', 'table-review.cjs', 'terminal-highlight-budget.mjs'].some(name => script.endsWith('/' + name))) {
        assert.equal(env.BROWSER_COVERAGE_DIR, undefined)
        assert.equal(env.BROWSER_COVERAGE_RUN_ID, undefined)
      } else {
        assert.equal(env.BROWSER_COVERAGE_DIR, join(root, 'coverage/browser/chromium-v8'))
        assert.match(env.BROWSER_COVERAGE_RUN_ID, /^[a-f0-9-]{36}$/)
      }
      for (const key of ['ARTIFACTS_DIR', 'AUDIT_INPUT_OUTPUT', 'HIGHLIGHT_BUDGET_OUTPUT']) assert.equal(env[key], env.SONAR_REVIEW_OUTPUT)
      assert.equal(env.NODE_V8_COVERAGE, '/synthetic/raw'); assert.equal(env.CHROMIUM_PATH, '/synthetic/chromium')
      assert.ok(env.SONAR_REVIEW_OUTPUT.startsWith(join(root, 'coverage/browser/')))
      const html = await (await fetch(env.FRONTEND_BASE)).text()
      assert.match(html, /Isolated coverage fixture/); assert.doesNotMatch(html, /src\/main/)
      assert.equal((await fetch(env.FRONTEND_BASE + '/api/v1/user')).status, 404)
      return { exitCode: 0, timedOut: false }
    } })
  assert.equal(requiredBrowserHarnesses.length, 9)
  assert.equal(result.harnesses.at(-1).coverageMode, 'node-only')
  assert.equal(result.status, 'passed'); assert.equal(result.phase, 'complete'); assert.equal(vite.closed, true)
  assert.deepEqual(runs, requiredBrowserHarnesses.map(([, script]) => script))
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
  const result = await collectBrowserCoverage({ root, env: {}, create: vite.create, execute: async (_root, _script, env) => { completeTlsReport(env); return outcome } })
  assert.equal(result.status, 'failed'); assert.equal(vite.closed, true)
  assert.equal(result.phase, options.closeFailure ? 'cleanup' : options.badAddress ? 'listen' : 'harness')
  assert.equal(JSON.parse(readFileSync(join(root, 'coverage/browser/summary.json'))).status, 'failed')
})
test('browser setup errors remain explicit without claiming a harness ran', async t => {
  const root = fixture(t)
  const result = await collectBrowserCoverage({ root, create: () => { throw new Error('fixture setup unavailable') } })
  assert.equal(result.status, 'failed'); assert.equal(result.phase, 'setup'); assert.deepEqual(result.harnesses, []); assert.equal(result.error, 'fixture setup unavailable')
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

for (const parentResists of [false, true]) test(`timeout kills resistant descendant when parent ${parentResists ? 'also resists' : 'exits on SIGTERM'}`, { skip: process.platform !== 'linux', timeout: 12_000 }, async t => {
  const root = fixture(t), pidFile = join(root, 'descendant.pid')
  let descendant
  t.after(() => { if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch { /* Already terminated. */ } } })
  writeFileSync(join(root, 'descendant.cjs'), "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000)")
  writeFileSync(join(root, 'parent.cjs'), `${parentResists ? "process.on('SIGTERM',()=>{});" : ''}require('node:child_process').spawn(process.execPath,[require('node:path').join(__dirname,'descendant.cjs'),process.argv[1].replace('parent.cjs','descendant.pid')],{stdio:'ignore'});setInterval(()=>{},1000)`)
  const started = performance.now()
  const result = await executeBrowserHarness(root, 'parent.cjs', process.env, join(root, 'timeout.log'), 1000)
  descendant = Number(readFileSync(pidFile, 'utf8'))
  assert.ok(Number.isSafeInteger(descendant) && descendant > 1)
  assert.equal(result.timedOut, true); assert.notEqual(result.exitCode, 0)
  assert.ok(performance.now() - started < 9000, 'termination must remain bounded')
  // A reparented zombie is terminated and awaits the host init reaper; it cannot execute work.
  const isRunning = () => {
    try { const stat = readFileSync(`/proc/${descendant}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z' }
    catch (error) { if (error.code === 'ENOENT') return false; throw error }
  }
  const deadline = performance.now() + 500
  while (isRunning() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(isRunning(), false, 'resistant descendant must not survive the harness timeout')
})

test('normal parent exit does not signal its descendant group', { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
  const root = fixture(t), pidFile = join(root, 'normal.pid')
  let descendant
  t.after(() => { if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch { /* Already terminated. */ } } })
  writeFileSync(join(root, 'normal-child.cjs'), "require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000)")
  writeFileSync(join(root, 'normal-parent.cjs'), "const child=require('node:child_process').spawn(process.execPath,[require('node:path').join(__dirname,'normal-child.cjs'),require('node:path').join(__dirname,'normal.pid')],{stdio:'ignore'});child.unref()")
  const result = await executeBrowserHarness(root, 'normal-parent.cjs', process.env, join(root, 'normal.log'), 2000)
  const deadline = performance.now() + 1000
  while (performance.now() < deadline) {
    try { descendant = Number(readFileSync(pidFile, 'utf8')); break }
    catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  assert.ok(Number.isSafeInteger(descendant) && descendant > 1)
  assert.deepEqual(result, { exitCode: 0, timedOut: false })
  assert.doesNotThrow(() => process.kill(descendant, 0))
})


for (const segment of ['coverage', 'coverage/browser']) test(`refuses symlinked ${segment} before chmod or removal outside the checkout`, async t => {
  const root = fixture(t), outside = fixture(t)
  chmodSync(outside, 0o755)
  mkdirSync(join(outside, 'chromium-v8')); writeFileSync(join(outside, 'chromium-v8/preserve'), 'unchanged')
  if (segment.includes('/')) mkdirSync(join(root, 'coverage'))
  symlinkSync(outside, join(root, segment), 'dir')
  await assert.rejects(collectBrowserCoverage({ root, create: () => { throw new Error('must not start Vite') } }), /Unsafe/)
  assert.equal(statSync(outside).mode & 0o777, 0o755)
  assert.equal(readFileSync(join(outside, 'chromium-v8/preserve'), 'utf8'), 'unchanged')
  if (segment === 'coverage') assert.equal(existsSync(join(outside, 'browser')), false)
})

for (const override of [undefined, '', '/explicit/chromium']) test(`all nine children share ${override ? 'explicit' : 'managed'} Chromium without a system fallback`, async t => {
  const root = fixture(t), vite = fakeVite(), paths = []
  const expected = override || chromium.executablePath()
  const result = await collectBrowserCoverage({ root, env: { PLAYWRIGHT_EXECUTABLE_PATH: override, CHROMIUM_PATH: '/conflicting/system-browser' }, create: vite.create,
    execute: async (_root, _script, env) => {
      assert.equal(env.PLAYWRIGHT_EXECUTABLE_PATH, expected)
      assert.equal(env.CHROMIUM_PATH, expected)
      paths.push(expected)
      completeTlsReport(env)
      return { exitCode: 0, timedOut: false }
    } })
  assert.equal(result.status, 'passed', result.error)
  assert.equal(paths.length, 9); assert.equal(vite.closed, true)
})

test('missing explicit browser stays explicit and failure cannot fall back to another executable', async t => {
  const root = fixture(t), vite = fakeVite(), missing = join(root, 'missing-chromium')
  let attempted = false
  const result = await collectBrowserCoverage({ root, env: { PLAYWRIGHT_EXECUTABLE_PATH: missing }, create: vite.create,
    execute: async (_root, _script, env) => {
      assert.equal(env.PLAYWRIGHT_EXECUTABLE_PATH, missing); assert.equal(env.CHROMIUM_PATH, missing)
      attempted = true
      await assert.rejects(chromium.launch({ headless: true, executablePath: env.PLAYWRIGHT_EXECUTABLE_PATH }), /executable doesn't exist/)
      return { exitCode: 1, timedOut: false }
    } })
  assert.equal(attempted, true); assert.equal(result.status, 'failed'); assert.equal(vite.closed, true)
  assert.equal(result.harnesses.length, 1); assert.equal(result.harnesses[0].exitCode, 1)
})

test('flow diagnostics are current, sanitized and never turn a failed run into success', async t => {
  const root = fixture(t), vite = fakeVite(), directory = join(root, 'coverage/browser/flows')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ failure: { stage: 'setup', category: 'OTHER' } }))
  const result = await collectBrowserCoverage({ root, env: {}, create: vite.create, execute: async (_root, script, env) => {
    if (!script.endsWith('sonar-flow-coverage.cjs')) return { exitCode: 0, timedOut: false }
    assert.equal(existsSync(join(directory, 'report.json')), false)
    writeFileSync(join(env.SONAR_FLOW_OUTPUT, 'report.json'), JSON.stringify({ failure: { stage: 'hosts-destination', category: 'ASSERTION', message: 'PRIVATE' } }))
    return { exitCode: 1, timedOut: false }
  } })
  assert.equal(result.status, 'failed'); assert.equal(vite.closed, true)
  assert.deepEqual(result.harnesses.at(-1), { name: 'flows', coverageMode: 'node-and-browser', exitCode: 1, timedOut: false, failure: { stage: 'hosts-destination', category: 'ASSERTION' } })
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
})

test('failed frontend retains bounded stack coordinates without private text or changing failure', async t => {
  const root = fixture(t), vite = fakeVite()
  const result = await collectBrowserCoverage({ root, env: {}, create: vite.create, execute: async (_root, script, _env, logfile) => {
    assert.equal(script, 'tools/frontend/sonar-frontend-review.cjs')
    writeFileSync(logfile, 'AssertionError [ERR_ASSERTION]: PRIVATE selector\n    at main (/PRIVATE/sonar-frontend-review.cjs:137:5)')
    return { exitCode: 1, timedOut: false }
  } })
  assert.equal(result.status, 'failed'); assert.equal(vite.closed, true)
  assert.deepEqual(result.harnesses, [{ name: 'frontend', coverageMode: 'node-only', exitCode: 1, timedOut: false, diagnostic: { category: 'ASSERTION', line: 137, column: 5 } }])
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|selector/)
})

for (const name of ['ha', 'audit-input', 'tacacs-tls', 'highlight-budget']) {
  test(`new required browser harness ${name} blocks completion on failure`, async t => {
    const root = fixture(t), vite = fakeVite(), calls = []
    const script = requiredBrowserHarnesses.find(([candidate]) => candidate === name)[1]
    const result = await collectBrowserCoverage({ root, env: {}, create: vite.create,
      execute: async (_root, current, env) => { completeTlsReport(env); calls.push(current); return { exitCode: current === script ? 7 : 0, timedOut: false } } })
    assert.equal(result.status, 'failed')
    assert.equal(vite.closed, true)
    assert.equal(calls.at(-1), script)
    assert.equal(result.harnesses.at(-1).name, name)
    assert.equal(result.harnesses.at(-1).exitCode, 7)
  })
}

for (const proof of ['missing', 'stale', 'malformed', 'incomplete', 'failed']) test(`TACACS TLS zero exit with ${proof} proof cannot pass`, async t => {
  const root = fixture(t), vite = fakeVite()
  const result = await collectBrowserCoverage({ root, env: { RUN_TACACS_TLS_UX: 'false' }, create: vite.create, execute: async (_root, script, env) => {
    if (script.endsWith('tls-ux.test.cjs')) {
      assert.equal(env.RUN_TACACS_TLS_UX, 'true')
      if (proof !== 'missing') writeFileSync(join(env.TACACS_TLS_UX_OUTPUT, 'report.json'), proof === 'malformed' ? '{' : JSON.stringify({ passed: proof !== 'failed', captureRunId: proof === 'stale' ? 'previous-run' : env.BROWSER_COVERAGE_RUN_ID, checks: Array.from({ length: proof === 'incomplete' ? 4 : 5 }, () => 'Check') }))
    }
    return { exitCode: 0, timedOut: false }
  } })
  assert.equal(result.status, 'failed'); assert.equal(vite.closed, true)
  assert.equal(result.harnesses.at(-1).name, 'tacacs-tls')
  assert.match(result.error, /harness incomplete: tacacs-tls/)
})
