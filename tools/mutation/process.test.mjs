import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBounded } from './process.mjs'

test('bounded process preserves successful and failing exit codes', async () => {
  assert.deepEqual(await runBounded(process.execPath, ['-e', 'process.exit(0)'], { timeoutMs: 2000, stdio: 'ignore' }), { exitCode: 0, interrupted: false, orphaned: false })
  assert.deepEqual(await runBounded(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 2000, stdio: 'ignore' }), { exitCode: 7, interrupted: false, orphaned: false })
})

test('timeout kills descendants even when their parent exits on TERM', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'na-mutation-budget-')), pidFile = join(folder, 'worker.pid')
  let pid
  try {
    const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000)`
    const result = await runBounded(process.execPath, ['-e', script], { timeoutMs: 600, graceMs: 100, stdio: 'ignore' })
    assert.equal(result.interrupted, true)
    pid = Number(readFileSync(pidFile, 'utf8'))
    // Linux can retain a dead orphan briefly as a zombie until PID1 reaps it.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0]
        if (state === 'Z') return
      } catch (error) { if (error.code === 'ENOENT') return; throw error }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail('Mutation worker remained alive after timeout')
  } finally {
    if (pid) try { process.kill(pid, 'SIGKILL') } catch { /* already terminated */ }
    rmSync(folder, { recursive: true, force: true })
  }
})

test('invalid budgets are rejected before starting a process', () => {
  assert.throws(() => runBounded(process.execPath, [], { timeoutMs: 0 }), /Invalid mutation time budget/)
})


test('normal parent exit cannot leave an unref worker that ignores TERM', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'na-mutation-orphan-')), pidFile = join(folder, 'worker.pid')
  let pid
  try {
    const worker = "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"
    const script = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>{fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));child.disconnect();child.unref();process.exit(0)})`
    const result = await runBounded(process.execPath, ['-e', script], { timeoutMs: 3000, graceMs: 100, stdio: 'ignore' })
    assert.deepEqual(result, { exitCode: 0, interrupted: false, orphaned: true })
    pid = Number(readFileSync(pidFile, 'utf8'))
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0]
        if (state === 'Z') return
      } catch (error) { if (error.code === 'ENOENT') return; throw error }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail('Unref mutation worker survived normal parent exit')
  } finally {
    if (pid) try { process.kill(pid, 'SIGKILL') } catch { /* already terminated */ }
    rmSync(folder, { recursive: true, force: true })
  }
})
