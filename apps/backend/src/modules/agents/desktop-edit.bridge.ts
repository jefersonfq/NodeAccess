import type { WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { ActiveAgent } from './agent.registry.js'
import { SESSION_FILE_LIMIT } from '../ssh/session-files.js'

/** One local edit, scoped to the personal agent and authenticated terminal. */
export function startDesktopEdit(agent: ActiveAgent, input: { name: string; content: string }, save: (data: Buffer) => Promise<unknown>, notify: (event: Record<string, unknown>) => void): { editId: string; stop: () => void; resume: () => void } {
  const ws = agent.ws as WebSocket
  if (agent.agentMode !== 'USER_BOUND' || agent.platform !== 'win32' || !agent.desktopEditing) throw new Error('FILE_PERSONAL_WINDOWS_AGENT_REQUIRED')
  const editId = randomUUID()
  let busy = false; let closed = false
  const send = (msg: Record<string, unknown>): void => { if (ws.readyState === 1) ws.send(JSON.stringify({ ...msg, editId })) }
  const listener = (...args: unknown[]): void => {
    const raw = args[0]
    if (!Buffer.isBuffer(raw) || args[1] || closed) return
    let message: Record<string, unknown>
    try { message = JSON.parse(raw.toString()) as Record<string, unknown> } catch { return }
    if (message.editId !== editId) return
    if (message.type === 'file_edit_state') {
      notify({ state: typeof message.state === 'string' ? message.state : 'error' })
      if (message.state === 'closed' || message.state === 'declined') close()
    }
    if (message.type !== 'file_edit_save' || busy) return
    if (typeof message.content !== 'string' || message.content.length > Math.ceil(SESSION_FILE_LIMIT / 3) * 4) { send({ type: 'file_edit_ack', ok: false, code: 'FILE_TOO_LARGE' }); return }
    const data = Buffer.from(message.content, 'base64')
    if (data.length > SESSION_FILE_LIMIT || data.toString('base64') !== message.content) { send({ type: 'file_edit_ack', ok: false, code: 'FILE_INVALID_CONTENT' }); return }
    busy = true
    notify({ state: 'sending' })
    void save(data).then(() => { send({ type: 'file_edit_ack', ok: true }); notify({ state: 'synced' }) })
      .catch((error: Error) => { const code = ['FILE_CONFLICT', 'FILE_BACKUP_QUOTA'].includes(error.message) ? error.message : 'FILE_SAVE_FAILED'; send({ type: 'file_edit_ack', ok: false, code }); notify({ state: code === 'FILE_CONFLICT' ? 'conflict' : 'error', code }) })
      .finally(() => { busy = false })
  }
  const disconnected = (): void => { notify({ state: 'offline' }); close() }
  const close = (): void => {
    if (closed) return
    closed = true; clearTimeout(timer)
    ws.removeListener('message', listener); ws.removeListener('message', ready); ws.removeListener('close', disconnected)
    send({ type: 'file_edit_stop' })
  }
  const timer = setTimeout(() => { notify({ state: 'agent-unavailable' }); close() }, 30_000)
  // A state response confirms an updated agent; subsequent monitoring is session scoped.
  const ready = (...args: unknown[]): void => {
    const raw = args[0]
    if (!Buffer.isBuffer(raw) || args[1]) return
    try { if ((JSON.parse(raw.toString()) as Record<string, unknown>).editId === editId) { clearTimeout(timer); ws.removeListener('message', ready) } } catch { /* unrelated message */ }
  }
  ws.on('message', listener); ws.on('message', ready); ws.once('close', disconnected)
  const stop = (): void => { ws.removeListener('message', ready); close() }
  send({ type: 'file_edit_open', name: input.name, content: input.content })
  return { editId, stop, resume: (): void => send({ type: 'file_edit_retry' }) }
}
