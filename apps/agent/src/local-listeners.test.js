'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { LocalListeners } = require('./local-listeners')

test('omitted policy denies local listeners before opening any socket', () => {
  const sent = []
  const listeners = new LocalListeners({ readyState: 1, send: value => sent.push(JSON.parse(value)) })
  assert.equal(listeners.handle({ type: 'local_listen', listenerId: '12345678-abcd-4abc-8abc-123456789abc', port: 2222 }), true)
  assert.equal(listeners.listeners.size, 0)
  assert.equal(sent[0].type, 'local_listen_error')
  listeners.destroy()
})

for (const policy of [{}, { allowLocalPort: undefined }, Object.freeze({})]) {
  test('partial and frozen policies retain default denial without mutation', () => {
    const sent = []
    const before = Object.getOwnPropertyDescriptors(policy)
    const listener = new LocalListeners({ readyState: 1, send: value => sent.push(JSON.parse(value)) }, policy)
    listener.handle({ type: 'local_listen', port: 2222, listenerId: '12345678-abcd-4abc-8abc-123456789abc' })
    assert.equal(sent[0].type, 'local_listen_error')
    assert.equal(listener.listeners.size, 0)
    assert.deepEqual(Object.getOwnPropertyDescriptors(policy), before)
    listener.destroy()
  })
}

test('explicit policy keeps original receiver and subsequent callback changes', () => {
  const sent = []
  const policy = { expected: 2222, allowLocalPort(port) { assert.equal(this, policy); assert.equal(port, this.expected); return false } }
  const listener = new LocalListeners({ readyState: 1, send: value => sent.push(JSON.parse(value)) }, policy)
  listener.handle({ type: 'local_listen', port: 2222 })
  let changed = false
  policy.allowLocalPort = function () { assert.equal(this, policy); changed = true; return true }
  listener.handle({ type: 'local_listen', port: 2222 })
  assert.equal(changed, true)
  assert.match(sent[0].message, /Porta local bloqueada/)
  assert.equal(sent[1].message, 'Invalid listener or limit reached')
  assert.equal(listener.listeners.size, 0)
  listener.destroy()
})
