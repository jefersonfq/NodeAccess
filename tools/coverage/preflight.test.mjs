import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, chmodSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runEnvironmentPreflight } from './preflight.mjs'

function fakeDependencies(overrides = {}) {
  return { checkNode() {}, checkBinary() {}, checkStorage() {}, checkLoopback() {},
    createRuntime: () => 'private-runtime', checkChromium() {}, removeRuntime() {}, ...overrides }
}
function fixture(t) {
  const root = mkdtempSync(resolve('.tmp/preflight-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
const secretError = () => { throw new Error('secret-token=/private/customer/path') }

test('successful preflight preserves caller environment and isolates browser context', async () => {
  const calls = [], env = { PATH: '/bin', TMPDIR: 'original', SONAR_TOKEN: 'secret', SONAR_REVIEW_TOKEN: 'review', NODE_V8_COVERAGE: 'inherited' }
  const result = await runEnvironmentPreflight({ root: '.', env, dependencies: fakeDependencies({
    checkBinary(name) { calls.push(name) },
    checkChromium(context) {
      assert.equal(context.runtime, 'private-runtime')
      assert.equal(context.env.SONAR_TOKEN, undefined)
      assert.equal(context.env.SONAR_REVIEW_TOKEN, undefined)
      assert.equal(context.env.NODE_V8_COVERAGE, undefined)
    },
    removeRuntime(runtime) { calls.push(runtime) },
  }) })
  assert.deepEqual(result, { status: 'passed', failures: [] })
  assert.deepEqual(calls, ['git', 'openssl', 'private-runtime'])
  assert.equal(env.TMPDIR, 'original'); assert.equal(env.SONAR_TOKEN, 'secret')
})

for (const [probe, code] of [['checkNode', 'PREFLIGHT_NODE'], ['checkBinary', 'PREFLIGHT_GIT'],
  ['checkStorage', 'PREFLIGHT_STORAGE'], ['checkLoopback', 'PREFLIGHT_LOOPBACK'],
  ['createRuntime', 'PREFLIGHT_STORAGE'], ['checkChromium', 'PREFLIGHT_CHROMIUM'], ['removeRuntime', 'PREFLIGHT_CLEANUP']]) {
  test(`sanitizes ${probe} failures and cleans any created runtime`, async () => {
    let created = false, cleaned = false, browser = false
    const result = await runEnvironmentPreflight({ root: '.', dependencies: fakeDependencies({
      createRuntime() { created = true; return 'private-runtime' },
      checkChromium() { browser = true }, removeRuntime() { cleaned = true }, [probe]: secretError,
    }) })
    assert.equal(result.status, 'failed')
    assert.equal(result.failures[0].code, code)
    assert.doesNotMatch(JSON.stringify(result), /secret-token|customer|private-runtime/)
    if (created && probe !== 'removeRuntime') assert.equal(cleaned, true)
    if (['checkNode', 'checkBinary', 'checkStorage', 'checkLoopback'].includes(probe)) assert.equal(browser, false)
  })
}

test('skips loopback only when consumer does not require it', async () => {
  const result = await runEnvironmentPreflight({ root: '.', requireLoopback: false,
    dependencies: fakeDependencies({ checkLoopback: secretError }) })
  assert.equal(result.status, 'passed')
})

test('binary probes reject nonzero executable results', async () => {
  const deps = fakeDependencies({ spawnBinary: () => ({ status: 1 }) }); delete deps.checkBinary
  const result = await runEnvironmentPreflight({ root: '.', env: { PATH: '/nonexistent-preflight-bin' }, dependencies: deps })
  assert.deepEqual(result.failures.map(item => item.code), ['PREFLIGHT_GIT', 'PREFLIGHT_OPENSSL'])
})

test('real storage accepts missing cache directories and removes private runtime after launch failure', async t => {
  const root = fixture(t), deps = fakeDependencies({ checkChromium: secretError })
  delete deps.checkStorage; delete deps.createRuntime; delete deps.removeRuntime
  const result = await runEnvironmentPreflight({ root, dependencies: deps })
  assert.equal(result.failures[0].code, 'PREFLIGHT_CHROMIUM')
  assert.deepEqual(readdirSync(join(root, '.tmp')), [])
  assert.equal(existsSync(join(root, 'coverage')), false)
})

for (const scenario of ['output-symlink', 'cache-symlink', 'nested-readonly-cache', 'tmp-symlink']) {
  test(`real storage rejects ${scenario} without modifying existing data`, async t => {
    const root = fixture(t), deps = fakeDependencies()
    delete deps.checkStorage
    const target = join(root, 'target'); mkdirSync(target)
    let locked
    if (scenario === 'output-symlink') symlinkSync(target, join(root, 'coverage'))
    if (scenario === 'tmp-symlink') symlinkSync(target, join(root, '.tmp'))
    if (scenario === 'cache-symlink') {
      mkdirSync(join(root, 'node_modules')); symlinkSync(target, join(root, 'node_modules/.vite'))
    }
    if (scenario === 'nested-readonly-cache') {
      locked = join(root, 'node_modules/.vite/deps')
      mkdirSync(locked, { recursive: true }); chmodSync(locked, 0o500)
    }
    try {
      const result = await runEnvironmentPreflight({ root, dependencies: deps })
      assert.equal(result.failures[0]?.code, 'PREFLIGHT_STORAGE')
      assert.equal(existsSync(target), true)
    } finally { if (locked) chmodSync(locked, 0o700) }
  })
}

test('real ephemeral loopback probe closes listener without launching project services', async () => {
  const deps = fakeDependencies(); delete deps.checkLoopback
  assert.equal((await runEnvironmentPreflight({ root: '.', dependencies: deps })).status, 'passed')
})

for (const version of ['22.21.0', '24.20.9', '25.0.0', 'invalid']) {
  test(`real version probe rejects ${version}`, async () => {
    const dependencies = fakeDependencies({ nodeVersion: version }); delete dependencies.checkNode
    const result = await runEnvironmentPreflight({ root: '.', dependencies })
    assert.equal(result.failures[0].code, 'PREFLIGHT_NODE')
  })
}

for (const outcome of [{status:0,pid:12345}, {status:null,pid:12345,error:new Error('timeout secret')}, {status:1,pid:12345}]) {
  test(`Chromium probe cleans its private process group after status ${outcome.status}`, async () => {
    let killed = false, cleaned = false
    const env = { PLAYWRIGHT_EXECUTABLE_PATH: '/synthetic/browser', TMPDIR: 'original' }
    const deps = fakeDependencies({
      spawnBrowser(_command, args, options) {
        assert.equal(options.detached, true)
        assert.equal(options.env.PLAYWRIGHT_EXECUTABLE_PATH, env.PLAYWRIGHT_EXECUTABLE_PATH)
        assert.equal(options.env.TMPDIR, 'private-runtime')
        assert.equal(options.env.XDG_RUNTIME_DIR, 'private-runtime')
        assert.match(args[2], /PLAYWRIGHT_EXECUTABLE_PATH/)
        assert.match(args[2], /--no-sandbox/)
        return outcome
      },
      killGroup(pid, signal) { assert.equal(pid, -12345); assert.equal(signal, 'SIGKILL'); killed = true },
      removeRuntime() { cleaned = true },
    }); delete deps.checkChromium
    const result = await runEnvironmentPreflight({ root: '.', env, dependencies: deps })
    assert.equal(result.status, outcome.status === 0 ? 'passed' : 'failed')
    assert.equal(killed, true); assert.equal(cleaned, true)
    assert.equal(env.TMPDIR, 'original')
  })
}

test('invalid explicit browser override fails real launch and removes private runtime', async t => {
  const root = fixture(t), deps = fakeDependencies()
  // Launch from the real workspace so Playwright resolves, but keep cleanup observable.
  delete deps.checkChromium; delete deps.removeRuntime
  deps.createRuntime = () => mkdtempSync(join(root, 'browser-'))
  const result = await runEnvironmentPreflight({ root: process.cwd(), env: { ...process.env,
    PLAYWRIGHT_EXECUTABLE_PATH: '/nonexistent-preflight-browser' }, dependencies: deps })
  assert.equal(result.failures[0].code, 'PREFLIGHT_CHROMIUM')
  assert.deepEqual(readdirSync(root), [])
})

test('binary probes use the same absolute executables as the laboratories', async () => {
  const calls = [], deps = fakeDependencies({ spawnBinary(command) { calls.push(command); return { status: 0 } } })
  delete deps.checkBinary
  assert.equal((await runEnvironmentPreflight({ root: '.', dependencies: deps })).status, 'passed')
  assert.deepEqual(calls, ['/usr/bin/git', '/usr/bin/openssl'])
})
