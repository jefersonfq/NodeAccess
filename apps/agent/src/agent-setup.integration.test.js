const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { WebSocketServer } = require('ws')

for (const scenario of ['accepted', 'invalid-token', 'unsupported-gateway']) {
  const accept = scenario === 'accepted'
  test(`configuration probe: ${scenario}`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const tokenFile = path.join(root, 'token')
    const statusFile = path.join(root, 'status.json')
    fs.writeFileSync(tokenFile, 'setup-test-token', { mode: 0o600 })
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    t.after(() => { for (const client of server.clients) client.terminate(); server.close() })
    let connections = 0
    server.on('connection', socket => {
      connections++
      if (accept) socket.send(JSON.stringify({ type: 'registered', accessMode: 'managed_acl', agentId: 1, name: 'Setup test' }))
      else if (scenario === 'unsupported-gateway') socket.send(JSON.stringify({ type: 'registered', agentId: 1, name: 'Old gateway' }))
      else socket.close(1008, 'Invalid token')
    })
    const executable = process.env.AGENT_TEST_EXECUTABLE || process.execPath
    const args = process.env.AGENT_TEST_EXECUTABLE ? [] : [path.join(__dirname, 'index.js')]
    args.push('--development', '--check', '--server', `ws://127.0.0.1:${server.address().port}`, '--token-file', tokenFile, '--status-file', statusFile)
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    t.after(() => { if (child.exitCode === null) child.kill() })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const [code] = await once(child, 'exit')
    assert.equal(code, accept ? 0 : 2)
    assert.equal(connections, 1)
    assert.ok(!output.includes('setup-test-token'))
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.equal(status.state, accept ? 'connected' : 'disconnected')
    assert.equal(status.accessMode, 'managed_acl')
    assert.equal(status.activeConnections, 0)
    assert.equal(status.diagnostic, accept ? null : 'rejected')
    assert.ok(!JSON.stringify(status).includes('setup-test-token'))
  })
}
