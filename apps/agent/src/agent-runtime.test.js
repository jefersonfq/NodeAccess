'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { reconnectDelay, resolveToken } = require('./agent-runtime')

test('reconnect uses bounded exponential backoff with jitter', () => {
  assert.equal(reconnectDelay(1, () => 0.5), 1_000)
  assert.equal(reconnectDelay(5, () => 0.5), 16_000)
  assert.equal(reconnectDelay(20, () => 0.5), 60_000)
  assert.equal(reconnectDelay(1, () => 0), 750)
  assert.equal(reconnectDelay(1, () => 1), 1_250)
})

test('token precedence is argument, protected file, then environment', () => {
  assert.equal(resolveToken({ token: 'argument', 'token-file': '/secret' }, { NODEACCESS_AGENT_TOKEN: 'env' }, () => 'file'), 'argument')
  assert.equal(resolveToken({ 'token-file': '/secret' }, { NODEACCESS_AGENT_TOKEN: 'env' }, () => ' file\n'), 'file')
  assert.equal(resolveToken({}, { NODEACCESS_AGENT_TOKEN: ' env ' }, () => ''), 'env')
  assert.equal(resolveToken({}, {}, () => ''), '')
})
