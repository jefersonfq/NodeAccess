'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compilePolicy, loadPolicy } = require('./access-policy')
const { connectionOptions } = require('./connection-security')

test('empty policy denies all destinations and local listeners', async () => {
  const policy = compilePolicy({ version: 1, rules: [], localPorts: [] })
  for (const host of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1']) await assert.rejects(policy.resolve(host, 22), /denied/)
  assert.equal(policy.allowLocalPort(2222), false)
})
test('explicit networks and ports constrain IPv4, IPv6 and hostnames', async () => {
  const policy = compilePolicy({ version: 1, localPorts: [2222], rules: [
    { cidr: '10.1.0.0/16', ports: [22], hostname: 'ssh.example.test' },
    { cidr: 'fd01::/64', ports: [443] },
  ] })
  assert.equal((await policy.resolve('ssh.example.test', 22, async () => [{ address: '10.1.0.2', family: 4 }])).address, '10.1.0.2')
  await assert.rejects(policy.resolve('other.example.test', 22, async () => [{ address: '10.1.0.2', family: 4 }]))
  await assert.rejects(policy.resolve('10.1.0.2', 22))
  await assert.rejects(policy.resolve('fd01::2', 22))
  assert.equal((await policy.resolve('fd01::2', 443)).family, 6)
  assert.equal(policy.allowLocalPort(2222), true)
  assert.equal(policy.allowLocalPort(2223), false)
})
test('mixed DNS answers cannot bypass the policy and every request resolves again', async () => {
  const policy = compilePolicy({ version: 1, rules: [{ cidr: '10.0.0.0/8', ports: [22] }] })
  const valid = { address: '10.0.0.1', family: 4 }
  await assert.rejects(policy.resolve('ssh.test', 22, async () => [valid, { address: '169.254.169.254', family: 4 }]))
  await assert.rejects(policy.resolve('ssh.test', 22, async () => []))
  assert.deepEqual(await policy.resolve('ssh.test', 22, async () => [valid]), valid)
  await assert.rejects(policy.resolve('ssh.test', 22, async () => [{ address: '127.0.0.1', family: 4 }]))
  await assert.rejects(policy.resolve('::ffff:10.0.0.1', 22))
})
test('malformed or writable policy fails closed', t => {
  for (const rule of [{ cidr: '10.0.0.0/8', ports: [] }, { cidr: '10.0.0.0/33', ports: [22] }, { cidr: '::/129', ports: [22] }, { cidr: '::/0', ports: [0] }]) assert.throws(() => compilePolicy({ version: 1, rules: [rule] }))
  assert.throws(() => compilePolicy({ version: 1, rules: [], localPorts: [22] }))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-security-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'policy.json')
  fs.writeFileSync(file, '{invalid')
  assert.throws(() => loadPolicy(file))
  fs.writeFileSync(file, JSON.stringify({ version: 1, rules: [] }))
  fs.chmodSync(file, 0o600)
  assert.ok(loadPolicy(file))
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o666)
    assert.throws(() => loadPolicy(file), /protected/)
    fs.symlinkSync(file, path.join(root, 'link'))
    assert.throws(() => loadPolicy(path.join(root, 'link')))
  }
})
test('transport requires verified TLS and never places credentials in the URL', () => {
  for (const server of ['ws://example.test', 'http://example.test', 'wss://user:pass@example.test', 'wss://example.test?token=secret', 'wss://example.test/path']) assert.throws(() => connectionOptions(server, 'secret'))
  assert.throws(() => connectionOptions('wss://example.test', 'secret', { insecure: true }))
  assert.throws(() => connectionOptions('wss://example.test', 'secret\r\nx: y'))
  assert.throws(() => connectionOptions('wss://example.test', ''))
  const options = connectionOptions('https://example.test', 'secret')
  assert.equal(options.server, 'wss://example.test')
  assert.equal(options.ws.headers.Authorization, 'Bearer secret')
  assert.equal(options.ws.rejectUnauthorized, true)
  assert.equal(options.ws.maxPayload, 262144)
  assert.equal(connectionOptions('ws://localhost', 'dev', { development: true }).server, 'ws://localhost')
})

test('managed ACL mode works without a file and validates target syntax and DNS', async () => {
  const policy = loadPolicy()
  assert.equal(policy.mode, 'managed_acl')
  assert.equal((await policy.resolve('127.0.0.1', 22)).address, '127.0.0.1')
  assert.equal(policy.allowLocalPort(2222), true)
  assert.equal(policy.allowLocalPort(22), false)
  await assert.rejects(policy.resolve('bad host', 22))
  await assert.rejects(policy.resolve('127.0.0.1', 0))
  await assert.rejects(policy.resolve('ssh.test', 22, async () => []))
  await assert.rejects(policy.resolve('ssh.test', 22, async () => [{ address: 'not-an-ip', family: 4 }]))
})
