import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCspProcess, cspCancellation } from './csp-process.mjs'
const node = (code, options = {}) => runCspProcess(process.execPath, ['-e', code], { timeoutMs: 2000, graceMs: 40, ...options })
test('bounded commands preserve real exit and diagnostics', async () => {
  const ok = await node('console.log("proof");console.error("diagnostic")')
  assert.equal(ok.exitCode, 0); assert.equal(ok.stdout, 'proof'); assert.equal(ok.stderr, 'diagnostic'); assert.equal(ok.orphaned, false)
  assert.equal((await node('process.exit(3)')).exitCode, 3)
  await assert.rejects(runCspProcess('/nonexistent-command', [], { timeoutMs: 1000 }))
  await assert.rejects(node('', { timeoutMs: 0 }), /budget/)
})
for (const event of ['SIGINT', 'SIGTERM']) test(`${event} cancels build, Docker CLI and harness process groups`, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'csp-cancel-')); t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const stage of ['build', 'docker', 'harness']) {
    const owner = new EventEmitter(), cancellation = cspCancellation(3000, owner), pidFile = join(directory, stage)
    const code = `const{spawn}=require('node:child_process');const{writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)`
    const task = node(code, { signal: cancellation.signal })
    const until = Date.now() + 1500
    while (!existsSync(pidFile) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(existsSync(pidFile)); await new Promise(resolve => setTimeout(resolve, 50)); owner.emit(event)
    const result = await task; cancellation.close(); assert.equal(result.timedOut, true)
    const pid = readFileSync(pidFile, 'utf8')
    await new Promise(resolve => setTimeout(resolve, 40))
    let state = 'gone'; try { state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] } catch { /* reaped */ }
    assert.ok(['gone', 'Z'].includes(state), `descendant still running: ${state}`)
    assert.equal(owner.listenerCount(event), 0)
  }
})
test('global deadline and already aborted operations fail closed', async () => {
  const owner = new EventEmitter(), cancellation = cspCancellation(30, owner)
  const result = await node('setInterval(()=>{},1000)', { signal: cancellation.signal })
  assert.equal(result.timedOut, true)
  await assert.rejects(node('', { signal: cancellation.signal }), /cancelled/)
  cancellation.close(); assert.equal(owner.listenerCount('SIGTERM'), 0)
})
test('successful parent exit cannot abandon an unref worker', async () => {
  const result = await node(`const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref()`)
  assert.equal(result.exitCode, 0); assert.equal(result.orphaned, true)
})
test('command deadline terminates workers even without global signal', async () => {
  assert.equal((await node('setInterval(()=>{},1000)', { timeoutMs: 30 })).timedOut, true)
})
