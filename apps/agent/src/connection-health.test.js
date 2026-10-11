'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const { catalog, errorCode, closeCode, watchConnection } = require('./connection-health')
const { createOutbox } = require('./diagnostic-outbox')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('diagnostics distinguish platform and target without inventing a root cause', () => {
  for (const [error, platform, target] of [['ECONNREFUSED','CONNECTION_REFUSED','TCP_REFUSED'], ['ENOTFOUND','DNS_FAILED','TARGET_DNS_FAILED'], ['ETIMEDOUT','CONNECT_TIMEOUT','TCP_TIMEOUT']]) {
    assert.equal(errorCode({ code: error }), platform)
    assert.equal(errorCode({ code: error }, true), target)
    assert.equal(catalog[platform].stage, 'agent_platform')
    assert.equal(catalog[target].stage, 'agent_host')
  }
  assert.equal(errorCode({ code: 'CERT_HAS_EXPIRED' }), 'TLS_FAILED')
  assert.equal(errorCode({ message: 'Unexpected server response: 403' }), 'AUTH_REVOKED')
  assert.equal(closeCode(4000, 'heartbeat timeout'), 'HEARTBEAT_TIMEOUT')
  assert.equal(closeCode(1008, 'authorization unavailable'), 'AUTH_UNAVAILABLE')
  assert.equal(closeCode(1008, 'registration replaced'), 'REGISTRATION_REPLACED')
  assert.match(catalog[closeCode(1006, '')].action, /não foi confirmada/)
})

test('registration, lost heartbeat, recovery deadline and cleanup', async () => {
  const events = []
  const first = watchConnection(code => events.push(code), { registrationMs: 15, heartbeatMs: 30 })
  await wait(30); first.stop()
  assert.deepEqual(events, ['REGISTRATION_TIMEOUT'])
  events.length = 0
  const second = watchConnection(code => events.push(code), { registrationMs: 15, heartbeatMs: 60 })
  second.registered(); await wait(30); second.ping(); await wait(40)
  assert.deepEqual(events, [])
  await wait(40); second.stop()
  assert.deepEqual(events, ['HEARTBEAT_TIMEOUT'])
  const stopped = watchConnection(code => events.push(code), { registrationMs: 10 })
  stopped.stop(); stopped.registered(); stopped.ping(); await wait(25)
  assert.deepEqual(events, ['HEARTBEAT_TIMEOUT'])
})

test('bounded outbox survives restart, requires ACK and isolates server/credential changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-outbox-'))
  try {
    const file = path.join(dir, 'events.json'), attempt = randomUUID()
    let box = createOutbox(file, 'scope-a')
    for (let i = 0; i < 105; i++) box.add('CONNECTION_LOST', attempt)
    assert.equal(JSON.parse(fs.readFileSync(file)).events.length, 100)
    const batch = box.batch(); assert.equal(batch.length, 20)
    box = createOutbox(file, 'scope-a'); assert.deepEqual(box.batch(), batch)
    box.acknowledge(['unknown']); assert.deepEqual(box.batch(), batch)
    box.acknowledge(batch.map(e => e.id))
    assert.equal(JSON.parse(fs.readFileSync(file)).events.length, 80)
    assert.equal(createOutbox(file, 'other-tenant-credential').batch().length, 0)
    assert.deepEqual(Object.keys(batch[0]).sort(), ['at','attemptId','code','id'])
    fs.writeFileSync(file, 'corrupted')
    assert.equal(createOutbox(file, 'scope-a').batch().length, 0)
    box = createOutbox('/missing-parent/readonly/file', 'scope')
    assert.doesNotThrow(() => box.add('TLS_FAILED', attempt))
    assert.equal(box.batch().length, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
