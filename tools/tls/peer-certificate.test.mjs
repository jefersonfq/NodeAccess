import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { inspectFingerprint, waitForFingerprint } from './peer-certificate.cjs'

const expected = Array(32).fill('AA').join(':')
const old = Array(32).fill('BB').join(':')
const options = { host: '127.0.0.1', port: 443, servername: 'tls.example.test', ca: 'fixture-ca', timeoutMs: 20 }
function socketFixture() {
  const socket = new EventEmitter()
  socket.authorized = true
  socket.getPeerCertificate = () => ({ fingerprint256: expected })
  socket.destroyed = false
  socket.destroy = () => { socket.destroyed = true }
  return socket
}
function clock() {
  let time = 0
  return { timeoutMs: 500, intervalMs: 100, now: () => time, sleep: async ms => { time += ms }, advance: ms => { time += ms } }
}

test('new verified TLS connections preserve CA and hostname checks and release sockets', async () => {
  const socket = socketFixture()
  const promise = inspectFingerprint(options, received => {
    assert.deepEqual(received, { host: options.host, port: 443, servername: options.servername, ca: options.ca, rejectUnauthorized: true })
    return socket
  })
  socket.emit('secureConnect')
  assert.equal(await promise, expected)
  assert.equal(socket.destroyed, true)
})
for (const reason of ['unauthorized', 'missing fingerprint', 'certificate read failure']) {
  test(`rejects ${reason} and destroys connection`, async () => {
    const socket = socketFixture()
    if (reason === 'unauthorized') socket.authorized = false
    if (reason === 'missing fingerprint') socket.getPeerCertificate = () => ({})
    if (reason === 'certificate read failure') socket.getPeerCertificate = () => { throw new Error('read failure') }
    const promise = inspectFingerprint(options, () => socket)
    socket.emit('secureConnect')
    await assert.rejects(promise)
    assert.equal(socket.destroyed, true)
  })
}
test('TLS error and early close fail without retaining the socket', async () => {
  for (const event of ['error', 'close']) {
    const socket = socketFixture(), promise = inspectFingerprint(options, () => socket)
    socket.emit(event, new Error('fixture failure'))
    await assert.rejects(promise)
    assert.equal(socket.destroyed, true)
  }
})
test('a stalled handshake fails within its independent deadline and releases connection', async () => {
  const socket = socketFixture()
  await assert.rejects(inspectFingerprint({ ...options, timeoutMs: 10 }, () => socket), /handshake deadline/)
  assert.equal(socket.destroyed, true)
  socket.emit('secureConnect')
})
test('waits through old certificates and transient errors for the exact expected fingerprint', async () => {
  const sequence = [old, new Error('temporary'), old, expected], budgets = []
  const result = await waitForFingerprint(async budget => {
    budgets.push(budget)
    const value = sequence.shift()
    if (value instanceof Error) throw value
    return value
  }, expected, clock())
  assert.equal(result, expected)
  assert.equal(sequence.length, 0)
  assert.ok(budgets.every(value => value > 0 && value <= 500))
})
test('a different certificate cannot satisfy convergence and fails at the deadline', async () => {
  const timing = clock()
  await assert.rejects(waitForFingerprint(async () => old, expected, timing), /not observed before the deadline/)
  assert.equal(timing.now(), 500)
})
test('permanent TLS failure remains a failure with its cause', async () => {
  const failure = new Error('untrusted certificate')
  await assert.rejects(waitForFingerprint(async () => { throw failure }, expected, clock()), error => error.cause === failure)
})
test('a correct certificate arriving after the deadline does not pass', async () => {
  const timing = clock()
  await assert.rejects(waitForFingerprint(async () => { timing.advance(501); return expected }, expected, timing), /not observed/)
})
test('missing or malformed expected identity fails before opening a connection', async () => {
  for (const fingerprint of [undefined, '', 'anything different', 42]) {
    await assert.rejects(waitForFingerprint(() => { assert.fail('must not inspect') }, fingerprint), /fingerprint is required/)
  }
})
