'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { WebSocketServer } = require('ws')

const CONN_ID_LEN = 36
const waitFor = (predicate, timeoutMs = 8_000) => new Promise((resolve, reject) => {
  const started = Date.now()
  const timer = setInterval(() => {
    const value = predicate()
    if (value) { clearInterval(timer); resolve(value) }
    else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error('timeout waiting for integration state')) }
  }, 25)
})

function frame(id, payload) {
  const prefix = Buffer.alloc(CONN_ID_LEN, ' ')
  prefix.write(id)
  return Buffer.concat([prefix, Buffer.from(payload)])
}

test('real agent registers, relays TCP, survives a broken WebSocket and reports TCP failure', { timeout: 20_000 }, async (t) => {
  const echo = net.createServer(socket => socket.pipe(socket))
  await new Promise(resolve => echo.listen(0, '127.0.0.1', resolve))
  t.after(() => echo.close())
  const echoPort = echo.address().port

  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise(resolve => wss.once('listening', resolve))
  t.after(() => wss.close())
  const wsPort = wss.address().port
  const sockets = []
  const controls = []
  const binaries = []
  let query = null
  wss.on('connection', (socket, request) => {
    sockets.push(socket)
    query = new URL(request.url, `ws://127.0.0.1:${wsPort}`).searchParams
    socket.on('message', (data, binary) => {
      if (binary) binaries.push(Buffer.from(data))
      else controls.push(JSON.parse(data.toString()))
    })
    socket.send(JSON.stringify({ type: 'registered', agentId: 1, name: 'Integration' }))
    socket.send(JSON.stringify({ type: 'ping', sentAt: 123 }))
  })

  const child = spawn(process.execPath, ['src/index.js', '--server', `ws://127.0.0.1:${wsPort}`, '--token', 'integration-token'], {
    cwd: require('node:path').resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.on('data', value => { logs += value })
  child.stderr.on('data', value => { logs += value })
  t.after(() => { if (!child.killed) child.kill('SIGTERM') })

  await waitFor(() => sockets.length === 1 && controls.some(message => message.type === 'pong'))
  assert.equal(query.get('tlsMode'), 'verified')

  const firstId = '11111111-1111-4111-8111-111111111111'
  sockets[0].send(JSON.stringify({ type: 'connect', connectionId: firstId, host: '127.0.0.1', port: echoPort }))
  await waitFor(() => controls.some(message => message.type === 'connected' && message.connectionId === firstId))
  sockets[0].send(frame(firstId, 'hello-agent'))
  await waitFor(() => binaries.some(value => value.subarray(CONN_ID_LEN).toString() === 'hello-agent'))

  sockets[0].terminate()
  await waitFor(() => sockets.length >= 2, 6_000)
  assert.match(logs, /Reconectando em \d+ms/)

  const failedId = '22222222-2222-4222-8222-222222222222'
  sockets[1].send(JSON.stringify({ type: 'connect', connectionId: failedId, host: '127.0.0.1', port: 1 }))
  await waitFor(() => controls.some(message => message.type === 'error' && message.connectionId === failedId))
  assert.equal(child.exitCode, null)
})
