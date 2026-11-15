import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('./terminal-experience-playwright.cjs', import.meta.url), 'utf8')
// Execute the actual browser capture callbacks, without launching Chromium.
const baseline = source.match(/const sentBeforeOrphanRecovery = await page\.evaluate\((.*)\)/)?.[1]
const capture = source.match(/const orphanRecoveryBytes = await page\.evaluate\((.*), sentBeforeOrphanRecovery\)/)?.[1]
before(() => {
  assert.ok(baseline)
  assert.ok(capture)
})
const expected = '\u0005\u0015cd /var/log/anaconda/'
function observe(suffix, includeHeartbeat) {
  const state = { sent: ['cd /var/log/ana', 'r'], inputSent: ['cd /var/log/ana'] }
  const context = { window: { __terminalExperience: state } }
  const offset = vm.runInNewContext(`(${baseline})()`, context)
  state.sent.push(suffix)
  state.inputSent.push(suffix)
  if (includeHeartbeat) state.sent.push(JSON.stringify({ type: 'ping' }))
  const actual = vm.runInNewContext(`(${capture})(${offset})`, context)
  return { actual, state }
}
test('actual orphan capture ignores interleaved control heartbeat and retains exact stdin', () => {
  const { actual, state } = observe(expected, true)
  assert.equal(actual, expected)
  assert.ok(state.sent.join('').endsWith('{"type":"ping"}'))
  assert.notEqual(state.sent.slice(2).join(''), expected, 'old wire capture fails deterministically')
})
test('actual orphan capture keeps malformed input visible, including binary JSON-looking input', () => {
  for (const corrupt of [expected + 'r', expected.replace('/log/', '/r/log/'), expected + '{"type":"ping"}']) {
    const { actual } = observe(corrupt, true)
    assert.equal(actual, corrupt)
    assert.notEqual(actual, expected)
  }
})
test('actual orphan capture preserves the normal no-heartbeat case', () => {
  assert.equal(observe(expected, false).actual, expected)
})
