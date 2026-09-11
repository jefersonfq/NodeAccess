const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { WebSocketServer } = require('ws')

const waitFor = async predicate => {
  const until = Date.now() + 12000
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Agent did not reach expected state')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function fixture(t, onConnection, check = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeaccess-fault-'))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  let connections = 0
  server.on('connection', socket => { connections++; onConnection(socket) })
  const token = 'fault-test-private-token'
  fs.writeFileSync(path.join(root, 'token'), token, { mode: 0o600 })
  const executable = process.env.AGENT_TEST_EXECUTABLE || process.execPath
  const args = process.env.AGENT_TEST_EXECUTABLE ? [] : [path.resolve('apps/agent/src/index.js')]
  args.push('--server', `ws://127.0.0.1:${server.address().port}`, '--token-file', path.join(root, 'token'), '--status-file', path.join(root, 'status.json'))
  if (check) args.push('--check')
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stdout.on('data', data => { logs += data })
  child.stderr.on('data', data => { logs += data })
  const exited = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited }
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(root, { recursive: true, force: true })
    assert.ok(!logs.includes(token), 'Credential leaked to output')
  })
  return { child, exited, connections: () => connections, status: () => {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8')) } catch { return {} }
  } }
}

test('configuration fails within its deadline when server never registers', { timeout: 15000 }, async t => {
  const agent = await fixture(t, () => {})
  const [code] = await agent.exited
  assert.equal(code, 2)
  assert.equal(agent.connections(), 1, 'Probe must not reconnect')
  assert.equal(agent.status().diagnostic, 'timeout')
})

test('malformed and unknown messages do not prevent valid registration', { timeout: 5000 }, async t => {
  const agent = await fixture(t, socket => {
    socket.send('{broken')
    socket.send(JSON.stringify({ type: 'future-message' }))
    socket.send(JSON.stringify({ type: 'registered', agentId: 1, name: 'Fault test' }))
  })
  assert.equal((await agent.exited)[0], 0)
  assert.equal(agent.status().state, 'connected')
})

test('abrupt disconnect during configuration fails without retrying', { timeout: 5000 }, async t => {
  const agent = await fixture(t, socket => socket.terminate())
  assert.equal((await agent.exited)[0], 2)
  assert.equal(agent.connections(), 1)
})

test('consecutive network losses close old TCP tunnels and allow new traffic', { timeout: 30000 }, async t => {
  const tcp = new Set()
  const echo = net.createServer(socket => {
    tcp.add(socket)
    socket.on('close', () => tcp.delete(socket))
    socket.pipe(socket)
  })
  echo.listen(0, '127.0.0.1')
  await once(echo, 'listening')
  t.after(() => { for (const socket of tcp) socket.destroy(); echo.close() })
  const sockets = []
  const replies = []
  const agent = await fixture(t, socket => {
    sockets.push(socket)
    socket.send(JSON.stringify({ type: 'registered', agentId: 1, name: 'Recovery test' }))
    socket.on('message', (data, binary) => { if (binary) replies.push(data.subarray(36).toString()) })
  }, false)
  for (let round = 0; round < 3; round++) {
    await waitFor(() => sockets.length === round + 1 && agent.status().state === 'connected')
    const id = `00000000-0000-4000-8000-${String(round).padStart(12, '0')}`
    const socket = sockets[round]
    socket.send(JSON.stringify({ type: 'connect', connectionId: id, host: '127.0.0.1', port: echo.address().port }))
    await waitFor(() => tcp.size === 1 && agent.status().activeConnections === 1)
    socket.send(Buffer.concat([Buffer.from(id), Buffer.from(`round-${round}`)]))
    await waitFor(() => replies.includes(`round-${round}`))
    socket.terminate()
    await waitFor(() => tcp.size === 0 && agent.status().activeConnections === 0)
  }
  assert.equal(agent.child.exitCode, null)
})
