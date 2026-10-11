import type { WebSocket } from 'ws'

export const MAX_SOCKET_PENDING_BYTES = 2 * 1024 * 1024
const closing = new WeakSet<WebSocket>()

/** A slow viewer must not retain unbounded SSH output in the shared gateway. */
export function sendBoundedWebSocket(ws: WebSocket, data: Buffer | string): void {
  if (ws.readyState !== 1 || closing.has(ws)) return
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
  if ((ws.bufferedAmount ?? 0) + bytes > MAX_SOCKET_PENDING_BYTES) {
    closing.add(ws)
    ws.close(1013, 'Cliente lento; reconecte a sessão')
    const timer = setTimeout(() => { if (ws.readyState !== 3) ws.terminate() }, 2_000)
    timer.unref()
    ws.once('close', () => clearTimeout(timer))
    return
  }
  ws.send(data)
}
