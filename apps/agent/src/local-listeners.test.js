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
