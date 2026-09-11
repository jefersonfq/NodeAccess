'use strict'
const net = require('node:net')
const { randomUUID } = require('node:crypto')
const LIMIT = 2 * 1024 * 1024

// Only loopback listeners. No remote destination is accepted by this protocol.
class LocalListeners {
  constructor(ws, policy = { allowLocalPort: () => false }) { this.policy = policy; this.ws = ws; this.listeners = new Map(); this.sockets = new Map() }
  send(value) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(value)) }
  handle(msg) {
    if (msg.type === 'local_unlisten') { this.close(msg.listenerId); return true }
    if (msg.type === 'local_close') { this.sockets.get(msg.connectionId)?.socket.destroy(); return true }
    if (msg.type !== 'local_listen') return false
    const id = msg.listenerId
    if (!this.policy.allowLocalPort(msg.port)) { this.send({ type: 'local_listen_error', listenerId: id, message: 'Porta local bloqueada pela politica do cliente. Autorize a porta em localPorts e reinicie o agente.' }); return true }
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || !Number.isInteger(msg.port) || msg.port < 1024 || msg.port > 65535 || this.listeners.size >= 16 || this.listeners.has(id)) {
      this.send({ type: 'local_listen_error', listenerId: id, message: 'Invalid listener or limit reached' }); return true
    }
    const server = net.createServer(socket => {
      if (this.sockets.size >= 64) { socket.destroy(); return }
      const connectionId = randomUUID()
      this.sockets.set(connectionId, { socket, listenerId: id })
      this.send({ type: 'local_accept', listenerId: id, connectionId })
      socket.on('data', data => {
        if (this.ws.readyState !== 1 || this.ws.bufferedAmount > LIMIT) { socket.destroy(); return }
        this.ws.send(Buffer.concat([Buffer.from(connectionId), data]))
      })
      socket.on('error', () => socket.destroy())
      socket.on('close', () => { this.sockets.delete(connectionId); this.send({ type: 'local_close', listenerId: id, connectionId }) })
    })
    this.listeners.set(id, server)
    server.on('error', error => { this.close(id); this.send({ type: 'local_listen_error', listenerId: id, message: error.code || 'LISTEN_FAILED' }) })
    server.listen(msg.port, '127.0.0.1', () => this.send({ type: 'local_listening', listenerId: id, port: msg.port }))
    return true
  }
  binary(data) {
    if (data.length < 36) return false
    const entry = this.sockets.get(data.subarray(0, 36).toString())
    if (!entry) return false
    if (entry.socket.writableLength > LIMIT) entry.socket.destroy()
    else entry.socket.write(data.subarray(36))
    return true
  }
  close(id) {
    this.listeners.get(id)?.close(); this.listeners.delete(id)
    for (const entry of this.sockets.values()) if (entry.listenerId === id) entry.socket.destroy()
  }
  destroy() { for (const id of this.listeners.keys()) this.close(id) }
}
module.exports = { LocalListeners }
