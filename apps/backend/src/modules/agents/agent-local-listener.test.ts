import { EventEmitter } from 'node:events'
import net from 'node:net'
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { openAgentLocalListener } from './agent-local-listener.js'
const require = createRequire(import.meta.url)
const { LocalListeners } = require('../../../../agent/src/local-listeners.js')
class Wire extends EventEmitter {
  readyState = 1; bufferedAmount = 0; peer!: Wire
  send(data: string | Buffer) { queueMicrotask(() => this.peer.emit('message', Buffer.isBuffer(data) ? data : Buffer.from(data), Buffer.isBuffer(data))) }
}
const listen = (server: net.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)))
it('relays real TCP from agent loopback and closes listener with publication', async () => {
  const backend = new Wire(), agent = new Wire(); backend.peer = agent; agent.peer = backend
  const local = new LocalListeners(agent, { allowLocalPort: () => true })
  agent.on('message', (data, binary) => binary ? local.binary(data) : local.handle(JSON.parse(data.toString())))
  const echo = net.createServer(socket => socket.pipe(socket))
  const serverPort = await listen(echo)
  const reservation = net.createServer(); const localPort = await listen(reservation)
  await new Promise<void>(resolve => reservation.close(() => resolve()))
  let closed = false
  let bridge: Awaited<ReturnType<typeof openAgentLocalListener>> | undefined
  try {
    bridge = await openAgentLocalListener({ ws: backend } as never, localPort, serverPort, () => { closed = true })
    const text = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(localPort, '127.0.0.1', () => socket.write('nodeaccess-loopback'))
      socket.setTimeout(3000, () => socket.destroy(new Error('timeout')))
      socket.once('data', data => { resolve(data.toString()); socket.destroy() }); socket.on('error', reject)
    })
    expect(text).toBe('nodeaccess-loopback')
    bridge.close(); await new Promise(resolve => setTimeout(resolve, 20)); expect(closed).toBe(true)
    expect(local.listeners.size).toBe(0)
  } finally { bridge?.close(); local.destroy(); echo.close() }
})
it('reports an occupied agent port without replacing its listener', async () => {
  const backend = new Wire(), agent = new Wire(); backend.peer = agent; agent.peer = backend
  const local = new LocalListeners(agent, { allowLocalPort: () => true })
  agent.on('message', (data, binary) => { if (!binary) local.handle(JSON.parse(data.toString())) })
  const occupied = net.createServer(); const port = await listen(occupied)
  try { await expect(openAgentLocalListener({ ws: backend } as never, port, port, () => {})).rejects.toMatchObject({ code: 'AGENT_LISTEN_FAILED' }) }
  finally { local.destroy(); occupied.close() }
})

it('rejects a disconnected agent before confirmation and removes handlers', async () => {
  const backend = new Wire(), agent = new Wire(); backend.peer = agent; agent.peer = backend
  let closed = 0
  const pending = openAgentLocalListener({ ws: backend } as never, 12345, 23456, () => { closed++ })
  backend.readyState = 3; backend.emit('close')
  await expect(pending).rejects.toMatchObject({ code: 'AGENT_LISTENER_CLOSED' })
  expect(backend.listenerCount('message')).toBe(0)
  expect(closed).toBe(1)
})
it.each([22, 0, -1, 65536, 1024.5])('agent rejects invalid or privileged port %s', port => {
  const replies: unknown[] = []
  const local = new LocalListeners({ readyState: 1, send: (raw: string) => replies.push(JSON.parse(raw)) })
  local.handle({ type: 'local_listen', listenerId: '11111111-1111-4111-8111-111111111111', port })
  expect(replies).toEqual([expect.objectContaining({ type: 'local_listen_error' })])
  expect(local.listeners.size).toBe(0)
})
it('ignores unsolicited binary frames without opening a connection', () => {
  const local = new LocalListeners({ readyState: 1, send: () => {} })
  expect(local.binary(Buffer.from('short'))).toBe(false)
  expect(local.binary(Buffer.from('11111111-1111-4111-8111-111111111111payload'))).toBe(false)
  expect(local.sockets.size).toBe(0)
})
