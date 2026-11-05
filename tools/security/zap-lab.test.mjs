import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runZapLab } from './zap-lab.mjs'
import { zapScenarios } from './zap-policy.mjs'
function scan() {
  return { schemaVersion: 1, mode: 'passive', target: 'https://web', version: '2.17.0', messages: 12, enabledRules: 30, queueRemaining: 0, alerts: [],
    requests: Object.entries(zapScenarios).map(([name, [method, path, status]]) => ({ name, method, status, passed: true, path: typeof path === 'string' ? path : `/assets/main.${name === 'javascript' ? 'js' : 'css'}` })) }
}
function fixture(fail = '') {
  const calls = [], output = mkdtempSync(join(tmpdir(), 'zap-contract-'))
  let clean = false
  const runner = { cancelled: false, beginCleanup() { clean = true }, dispose() {}, async run(exe, args, options) {
    calls.push({ args, input: options?.input })
    const text = args.join(' ')
    if (fail && text.includes(fail) && !clean) throw new Error('synthetic execution failure')
    if (args[0] === 'rev-parse') return 'a'.repeat(40)
    if (args[0] === 'status') return ''
    if (args[0] === 'build' || args[0] === 'pull' || args[0] === 'create' || args[0] === 'start') return ''
    if (text.includes('{{.Id}}')) return `sha256:${'b'.repeat(64)}`
    if (text.includes('{{.Internal}}')) return 'true'
    if (text.includes('{{.State.ExitCode}}')) return '0'
    if (text.includes('driver.py') && args[0] === 'exec') return JSON.stringify(scan())
    if (text.includes('mfaEnabled:true')) return JSON.stringify({ email: 'zap@example.invalid', slug: 'lab', password: 'test-secret', mfaSecret: 'test-mfa' })
    if (clean && args.includes('--filter')) return 'abcdefabcdef'
    return ''
  } }
  return { runner, calls, output, close: () => rmSync(output, { recursive: true, force: true }) }
}
test('orchestrator builds current images, isolates traffic, passes fixture by stdin and removes only owned labels', async () => {
  const f = fixture()
  try {
    const r = await runZapLab({ output: f.output, processRunner: f.runner, pause: async () => {} })
    assert.equal(r.passed, true); assert.equal(r.cleanup, 'complete'); assert.equal(existsSync(join(f.output, '.lock')), false)
    assert.equal(f.calls.filter(c => c.args[0] === 'build').length, 4)
    const databaseProbe = f.calls.find(c => c.args.includes('SELECT 1'))
    assert.ok(databaseProbe.args.includes('--protocol=TCP')); assert.ok(databaseProbe.args.includes('-h127.0.0.1'))
    assert.ok(f.calls.some(c => c.args.includes('--internal')))
    assert.equal(f.calls.some(c => c.args.includes('-p') || c.args.includes('--publish') || c.args.includes('--privileged')), false)
    const scanner = f.calls.find(c => c.args[0] === 'create' && c.args.includes('zap.sh'))
    assert.ok(scanner.args.includes('-Xmx1024m')); assert.ok(scanner.args.includes('127.0.0.1'))
    const inspect = f.calls.find(c => c.args.includes('driver.py') && c.args[0] === 'exec') ?? f.calls.find(c => c.args.includes('/zap/wrk/driver.py') && c.args[0] === 'exec')
    assert.ok(inspect.input.includes('test-secret')); assert.equal(inspect.args.join(' ').includes('test-secret'), false)
    assert.equal(readFileSync(join(f.output, 'summary.json'), 'utf8').includes('test-secret'), false)
    const cleanup = f.calls.filter(c => c.args.includes('--filter'))
    assert.equal(cleanup.length, 3); assert.ok(cleanup.every(c => c.args.at(-1).startsWith('label=nodeaccess.zap=na-zap-')))
  } finally { f.close() }
})
for (const point of ['--target runtime', 'network create', 'SELECT 1', 'migrate deploy', '/health/ready', 'driver.py']) test(`failure at ${point} remains failed and cleans owned resources`, async () => {
  const f = fixture(point)
  try {
    const r = await runZapLab({ output: f.output, processRunner: f.runner, pause: async () => {} })
    assert.equal(r.passed, false); assert.equal(r.cleanup, 'complete'); assert.ok(r.failedStage)
    assert.equal(existsSync(join(f.output, '.lock')), false)
  } finally { f.close() }
})
test('a concurrent invocation cannot overwrite the report or remove the first lock', async () => {
  const f = fixture(); let release, entered
  const waiting = new Promise(resolve => { entered = resolve })
  const original = f.runner.run; let first = true
  f.runner.run = async (...args) => {
    if (first) { first = false; entered(); await new Promise(resolve => { release = resolve }) }
    return original(...args)
  }
  try {
    const running = runZapLab({ output: f.output, processRunner: f.runner, pause: async () => {} })
    await waiting
    await assert.rejects(runZapLab({ output: f.output, processRunner: f.runner }), /EEXIST/)
    assert.equal(existsSync(join(f.output, '.lock')), true)
    release(); assert.equal((await running).passed, true)
  } finally { release?.(); f.close() }
})
test('cleanup errors cannot turn a successful scan into a pass', async () => {
  const f = fixture(), original = f.runner.run
  f.runner.run = async (exe, args, options) => {
    if (args[0] === 'rm') throw new Error('cleanup unavailable')
    return original(exe, args, options)
  }
  try {
    const r = await runZapLab({ output: f.output, processRunner: f.runner, pause: async () => {} })
    assert.equal(r.passed, false); assert.equal(r.cleanup, 'failed')
  } finally { f.close() }
})
test('unreviewed scanner findings remain a failed result with complete cleanup', async () => {
  const f = fixture(), original = f.runner.run
  f.runner.run = async (exe, args, options) => {
    if (args[0] === 'exec' && args.includes('/zap/wrk/driver.py')) {
      const raw = scan(); raw.alerts = [{ rule: '10020', risk: 2, paths: ['/login'] }]; return JSON.stringify(raw)
    }
    return original(exe, args, options)
  }
  try {
    const r = await runZapLab({ output: f.output, processRunner: f.runner, pause: async () => {} })
    assert.equal(r.passed, false); assert.equal(r.cleanup, 'complete'); assert.equal(r.blocking.length, 1)
  } finally { f.close() }
})

test('invalid owned resource identifiers fail cleanup without issuing any removal', async () => {
  const f = fixture(), original = f.runner.run
  f.runner.run = async (exe, args, options) => {
    if (args.includes('--filter')) return 'abcdefabcdef\nforeign-container'
    return original(exe, args, options)
  }
  try {
    const result = await runZapLab({ output: f.output, processRunner: f.runner, pause: async () => {} })
    assert.equal(result.passed, false)
    assert.equal(result.cleanup, 'failed')
    assert.equal(f.calls.filter(call => call.args.includes('rm')).length, 0)
    assert.equal(existsSync(join(f.output, '.lock')), false)
  } finally { f.close() }
})
