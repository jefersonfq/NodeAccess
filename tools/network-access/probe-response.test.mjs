import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { collectProbeResponse } from './probe-response.mjs'

function run(source) { return spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] }) }
test('waits for close when parent exits before inherited stdout drains', async () => {
  const descendant = "process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({valid:true}));process.stdin.destroy()})"
  // The root releases fd3 only after observing parent exit: no timing assumption.
  const child = spawn(process.execPath, ['-e', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:[3,1,2]}).unref();process.exit(0)`], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  let settled = false, observedExit = false, legacyOutput = ''
  child.stdout.on('data', chunk => { legacyOutput += chunk })
  const result = collectProbeResponse(child).finally(() => { settled = true })
  child.once('exit', () => {
    observedExit = true
    assert.equal(settled, false)
    assert.throws(() => JSON.parse(legacyOutput), SyntaxError, 'previous exit callback parses incomplete output')
    child.stdio[3].end('release')
  })
  assert.deepEqual(await result, { valid: true })
  assert.equal(observedExit, true)
})
test('signal exit with null code is rejected with sanitized diagnostics', async () => {
  const child = run("process.stdout.write('PRIVATE_SENTINEL');process.kill(process.pid,'SIGTERM')")
  await assert.rejects(collectProbeResponse(child), error => {
    assert.match(error.message, /NETWORK_PROBE_EXIT_FAILED/)
    assert.match(error.message, /"code":null/)
    assert.match(error.message, /"signal":"SIGTERM"/)
    assert.ok(!error.message.includes('PRIVATE_SENTINEL'))
    return true
  })
})
test('invalid JSON and nonzero exit do not expose stdout or stderr', async () => {
  for (const source of ["process.stdout.write('PRIVATE_SENTINEL')", "process.stderr.write('PRIVATE_SENTINEL');process.exit(2)"]) {
    await assert.rejects(collectProbeResponse(run(source)), error => {
      assert.match(error.message, /NETWORK_PROBE_(INVALID_JSON|EXIT_FAILED)/)
      assert.ok(!error.message.includes('PRIVATE_SENTINEL'))
      return true
    })
  }
})
test('complete successful probe resolves unchanged JSON', async () => {
  assert.deepEqual(await collectProbeResponse(run('process.stdout.write(JSON.stringify({valid:false,status:17}))')), { valid: false, status: 17 })
})

test('deadline rejects and releases owned streams when exited child cannot close inherited pipes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = 0
  child.signalCode = null
  let kills = 0
  child.kill = signal => { assert.equal(signal, 'SIGKILL'); kills++; return false }
  let settled = false
  const result = collectProbeResponse(child).finally(() => { settled = true })
  const rejected = assert.rejects(result, error => {
    assert.match(error.message, /NETWORK_PROBE_TIMEOUT/)
    assert.match(error.message, /"timedOut":true/)
    assert.ok(!error.message.includes('PRIVATE_SENTINEL'))
    return true
  })
  child.stdout.write('PRIVATE_SENTINEL')
  child.emit('exit', 0, null)
  t.mock.timers.tick(9999)
  await Promise.resolve()
  assert.equal(settled, false)
  t.mock.timers.tick(1)
  await rejected
  assert.equal(settled, true)
  assert.equal(kills, 1)
  for (const stream of [child.stdin, child.stdout, child.stderr]) assert.equal(stream.destroyed, true)
  // A delayed close cannot turn the rejected operation into success.
  child.emit('close', 0, null)
})
