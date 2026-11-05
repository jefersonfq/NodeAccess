import test from 'node:test'
import assert from 'node:assert/strict'
import { createZapProcessRunner } from './zap-process.mjs'
test('process runner captures stdout and passes private stdin without exposing stderr', async () => {
  const r = createZapProcessRunner()
  try { assert.equal(await r.run(process.execPath, ['-e', "process.stdin.on('data', d=>process.stdout.write(d));process.stderr.write('private')"], { input: 'fixture' }), 'fixture') } finally { r.dispose() }
})
for (const [name, code, options] of [
  ['exit failure', 'process.exit(1)', {}],
  ['timeout', 'setTimeout(()=>{},10000)', { timeout: 20 }],
  ['output limit', "console.log('x'.repeat(1000))", { maxBuffer: 10 }],
]) test(`process ${name} is a failure`, async () => {
  const r = createZapProcessRunner()
  try { await assert.rejects(r.run(process.execPath, ['-e', code], options)) } finally { r.dispose() }
})
test('cancellation interrupts work but allows owner cleanup commands', async () => {
  const r = createZapProcessRunner()
  try {
    const active = r.run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'])
    setTimeout(() => r.cancel(), 20)
    await assert.rejects(active); assert.equal(r.cancelled, true)
    await assert.rejects(r.run(process.execPath, ['-e', 'process.exit(0)']))
    r.beginCleanup(); assert.equal(await r.run(process.execPath, ['-e', "console.log('cleanup')"]), 'cleanup')
  } finally { r.dispose() }
})
test('total budget cancels the execution independently of individual timeout', async () => {
  const r = createZapProcessRunner({ budgetMs: 20 })
  try { await assert.rejects(r.run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'])); assert.equal(r.cancelled, true) } finally { r.dispose() }
})
test('a child ignoring TERM is killed within the bounded grace period', async () => {
  const r = createZapProcessRunner()
  try {
    const active = r.run(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>{},10000)"])
    setTimeout(() => r.cancel(), 100)
    await assert.rejects(active)
  } finally { r.dispose() }
})
test('spawn error and arbitrary stderr cannot leak credentials', async () => {
  const r = createZapProcessRunner()
  try {
    await assert.rejects(r.run('/nonexistent/zap-command', []), { message: 'ZAP subprocess failed' })
    await assert.rejects(r.run(process.execPath, ['-e', "console.error('Bearer secret');process.exit(1)"]), { message: 'ZAP subprocess failed' })
    await assert.rejects(r.run(process.execPath, ['-e', "console.error(JSON.stringify({category:'HTTPError',phase:'login-page'}));process.exit(1)"]), { message: 'ZAP subprocess failed: HTTPError at login-page' })
  } finally { r.dispose() }
})
test('deadline terminates descendants keeping pipes open after the parent exits', async () => {
  const r = createZapProcessRunner({ budgetMs: 300 })
  const code = "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});c.unref();process.exit(0)"
  const started = Date.now()
  try {
    await assert.rejects(r.run(process.execPath, ['-e', code], { timeout: 300 }))
    assert.ok(Date.now() - started < 4000)
  } finally { r.dispose() }
})
test('normal parent exit cannot conceal a TERM-resistant detached worker', async () => {
  const r = createZapProcessRunner({ budgetMs: 5000 })
  const code = "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)\"],{stdio:['ignore','ignore','ignore','ipc']});c.on('message',()=>{c.disconnect();c.unref();process.exit(0)})"
  const started = Date.now()
  try {
    await assert.rejects(r.run(process.execPath, ['-e', code], { timeout: 5000 }))
    assert.ok(Date.now() - started >= 1900)
    assert.ok(Date.now() - started < 4000)
  } finally { r.dispose() }
})
