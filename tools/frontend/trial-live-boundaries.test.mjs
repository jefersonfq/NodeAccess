import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import ssh from 'ssh2'
import boundaries from './trial-live-boundaries.cjs'
const { readTrialBoundary, verifyDisposableSsh } = boundaries
const env = () => ({ TRIAL_LIVE_SSH_HOST: '127.0.0.1', TRIAL_LIVE_SSH_PORT: '2222', TRIAL_LIVE_SSH_USER: 'fixture', TRIAL_LIVE_SSH_PASSWORD: randomBytes(24).toString('hex'), TRIAL_LIVE_SSH_FINGERPRINT: `SHA256:${'A'.repeat(43)}`, TRIAL_LIVE_NETWORK_CIDR: '127.0.0.0/24', TRIAL_LIVE_DEMO_HOSTS: '["127.0.0.1","127.0.0.2","127.0.0.3"]', TRIAL_LIVE_PROTECTED_ADDRESSES: '["192.0.2.1"]', TRIAL_LIVE_FORBIDDEN_HOST: '127.0.0.99' })
test('requires every explicit target, pin, network and protection field before any connection', () => {
  const complete = env(); assert.equal(readTrialBoundary(complete).host, '127.0.0.1')
  for (const key of Object.keys(complete)) { const value = { ...complete }; delete value[key]; assert.throws(() => readTrialBoundary(value), /EXPLICIT_DISPOSABLE_SSH_REQUIRED/) }
  for (const delta of [{ TRIAL_LIVE_SSH_PORT: '0' }, { TRIAL_LIVE_SSH_FINGERPRINT: 'invalid' }, { TRIAL_LIVE_NETWORK_CIDR: '192.0.2.0/24' }, { TRIAL_LIVE_PROTECTED_ADDRESSES: '["127.0.0.1"]' }, { TRIAL_LIVE_DEMO_HOSTS: '["127.0.0.1","127.0.0.1","127.0.0.2"]' }]) assert.throws(() => readTrialBoundary({ ...complete, ...delta }))
})
test('real loopback SSH pins host key before password and authenticates ephemeral credentials', async t => {
  const keys = ssh.utils.generateKeyPairSync('ed25519')
  const key = ssh.utils.parseKey(keys.private)
  const fingerprint = `SHA256:${createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=$/, '')}`
  const configuration = readTrialBoundary(env()); let authentications = 0; const clients = new Set()
  const server = new ssh.Server({ hostKeys: [keys.private] }, client => {
    clients.add(client); client.on('error', () => {}); client.once('close', () => clients.delete(client))
    client.on('authentication', context => { if (context.method === 'password') authentications++; if (context.method === 'password' && context.username === configuration.username && context.password === configuration.password) context.accept(); else context.reject() })
  })
  t.after(async () => { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); configuration.port = server.address().port
  await assert.rejects(verifyDisposableSsh(configuration), /SSH_REJECTED/); assert.equal(authentications, 0)
  configuration.fingerprint = fingerprint; assert.equal(await verifyDisposableSsh(configuration), fingerprint); assert.equal(authentications, 1)
})
test('silent loopback server hits bounded deadline and closes its socket', async t => {
  const sockets = new Set(); const server = createServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)) })
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const configuration = readTrialBoundary(env()); configuration.port = server.address().port
  await assert.rejects(verifyDisposableSsh(configuration, { timeoutMs: 60 }), /SSH_TIMEOUT|SSH_REJECTED/)
})
