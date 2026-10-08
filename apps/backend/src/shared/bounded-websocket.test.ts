import { EventEmitter } from 'node:events'
import type { WebSocket } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { MAX_SOCKET_PENDING_BYTES, sendBoundedWebSocket } from './bounded-websocket.js'
afterEach(() => vi.useRealTimers())
function socket(bufferedAmount = 0) {
  return Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount, send: vi.fn(), close: vi.fn(), terminate: vi.fn() })
}
it('preserves binary/text data within the per-connection limit', () => {
  const ws = socket()
  const data = Buffer.from([0, 255, 27, 91])
  sendBoundedWebSocket(ws as unknown as WebSocket, data)
  sendBoundedWebSocket(ws as unknown as WebSocket, 'control')
  expect(ws.send.mock.calls).toEqual([[data], ['control']])
})
it('disconnects only the slow consumer and bounds all subsequent writes', () => {
  vi.useFakeTimers()
  const slow = socket(MAX_SOCKET_PENDING_BYTES)
  const healthy = socket()
  for (let i = 0; i < 100; i++) sendBoundedWebSocket(slow as unknown as WebSocket, Buffer.alloc(100))
  sendBoundedWebSocket(healthy as unknown as WebSocket, 'output')
  expect(slow.send).not.toHaveBeenCalled()
  expect(slow.close).toHaveBeenCalledTimes(1)
  expect(slow.close).toHaveBeenCalledWith(1013, expect.any(String))
  expect(healthy.send).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(2000)
  expect(slow.terminate).toHaveBeenCalledOnce()
})
it('counts UTF-8 bytes and clears termination timer when close succeeds', () => {
  vi.useFakeTimers()
  const ws = socket(MAX_SOCKET_PENDING_BYTES - 1)
  sendBoundedWebSocket(ws as unknown as WebSocket, 'ç')
  expect(ws.send).not.toHaveBeenCalled()
  ws.emit('close'); vi.advanceTimersByTime(2000)
  expect(ws.terminate).not.toHaveBeenCalled()
})

it('bounds a real paused TCP consumer without blocking a second WebSocket', async () => {
  const { WebSocket: Client, WebSocketServer } = await import('ws')
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const port = (server.address() as { port: number }).port
  const peers: import('ws').WebSocket[] = []
  server.on('connection', peer => peers.push(peer))
  const slow = new Client(`ws://127.0.0.1:${port}`)
  const healthy = new Client(`ws://127.0.0.1:${port}`)
  try {
    await Promise.all([slow, healthy].map(client => new Promise<void>(resolve => client.once('open', resolve))))
    slow.pause()
    const chunk = Buffer.alloc(32 * 1024)
    for (let i = 0; i < 512; i++) sendBoundedWebSocket(peers[0]!, chunk)
    expect(peers[0]!.bufferedAmount).toBeLessThan(MAX_SOCKET_PENDING_BYTES + 256)
    const message = new Promise<string>(resolve => healthy.once('message', data => resolve(data.toString())))
    sendBoundedWebSocket(peers[1]!, 'still-responsive')
    await expect(message).resolves.toBe('still-responsive')
    expect(peers[0]!.readyState).not.toBe(1)
  } finally {
    slow.terminate(); healthy.terminate()
    for (const peer of peers) peer.terminate()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
