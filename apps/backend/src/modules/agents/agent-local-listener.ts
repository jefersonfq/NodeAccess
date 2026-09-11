import net from 'node:net'
import { randomUUID } from 'node:crypto'
import type { ActiveAgent } from './agent.registry.js'
import { AppError } from '../../shared/errors.js'

/** A scoped bridge attached to exactly one authenticated agent socket. */
export async function openAgentLocalListener(agent: ActiveAgent, localPort: number, serverPort: number, onClose: () => void): Promise<{ close: () => void }> {
  const listenerId = randomUUID()
  const sockets = new Map<string, net.Socket>()
  let closed = false
  let ready = false
  const send = (value: object) => { if (agent.ws.readyState === 1) agent.ws.send(JSON.stringify(value)) }
  let fail: (error: Error) => void = () => {}
  let succeed: () => void = () => {}
  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    agent.ws.off('message', receive)
    agent.ws.off('close', close)
    for (const socket of sockets.values()) socket.destroy()
    send({ type: 'local_unlisten', listenerId })
    if (!ready) fail(new AppError('Agente desconectado ou publicação cancelada', 409, 'AGENT_LISTENER_CLOSED'))
    onClose()
  }
  const receive = (data: Buffer, binary: boolean) => {
    if (closed) return
    if (binary) {
      if (data.length < 36) return
      const socket = sockets.get(data.subarray(0, 36).toString())
      if (socket) { if (socket.writableLength > 2 * 1024 * 1024) socket.destroy(); else socket.write(data.subarray(36)) }
      return
    }
    let msg: { type: string; listenerId?: string; connectionId?: string; message?: string }
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (msg.listenerId !== listenerId) return
    if (msg.type === 'local_listening') { ready = true; clearTimeout(timer); succeed(); return }
    if (msg.type === 'local_listen_error') { fail(new AppError(`Não foi possível abrir a porta no agente: ${msg.message ?? 'erro'}`, 409, 'AGENT_LISTEN_FAILED')); close(); return }
    if (!ready || !msg.connectionId || !/^[a-f0-9-]{36}$/.test(msg.connectionId)) return
    const id = msg.connectionId
    if (msg.type === 'local_close') { sockets.get(id)?.destroy(); return }
    if (msg.type !== 'local_accept' || sockets.has(id)) return
    if (sockets.size >= 64) { send({ type: 'local_close', connectionId: id }); return }
    // Destination is the already-authorized tunnel, never an address supplied by the agent.
    const socket = net.connect(serverPort, '127.0.0.1')
    sockets.set(id, socket)
    socket.on('data', chunk => {
      if (agent.ws.readyState !== 1 || agent.ws.bufferedAmount > 2 * 1024 * 1024) { socket.destroy(); return }
      agent.ws.send(Buffer.concat([Buffer.from(id), chunk]))
    })
    socket.on('error', () => socket.destroy())
    socket.on('close', () => { sockets.delete(id); send({ type: 'local_close', connectionId: id }) })
  }
  const timer = setTimeout(() => { fail(new AppError('Atualize o agente: a publicação local não foi confirmada', 409, 'AGENT_LISTEN_TIMEOUT')); close() }, 5000)
  return new Promise((resolve, reject) => {
    fail = reject
    succeed = () => resolve({ close })
    agent.ws.on('message', receive)
    agent.ws.once('close', close)
    send({ type: 'local_listen', listenerId, port: localPort })
  })
}
