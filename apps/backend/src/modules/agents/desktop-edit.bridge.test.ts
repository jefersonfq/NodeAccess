import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { startDesktopEdit } from './desktop-edit.bridge.js'
import type { ActiveAgent } from './agent.registry.js'

class Socket extends EventEmitter {
  readyState = 1
  sent: Record<string, unknown>[] = []
  send(raw: string) { this.sent.push(JSON.parse(raw)) }
}
function fixture() {
  const ws = new Socket()
  const agent = { agentMode: 'USER_BOUND', platform: 'win32', desktopEditing: true, ws } as unknown as ActiveAgent
  const save = vi.fn().mockResolvedValue({})
  const notify = vi.fn()
  return { ws, agent, save, notify }
}
describe('personal desktop editor bridge', () => {
  it.each([{ agentMode: 'SERVICE_BOUND' }, { platform: 'linux' }, { desktopEditing: false }])('requires a capable personal Windows agent: %j', overrides => {
    const f = fixture()
    expect(() => startDesktopEdit({ ...f.agent, ...overrides } as ActiveAgent, { name: 'file.conf', content: '' }, f.save, f.notify)).toThrow('FILE_PERSONAL_WINDOWS_AGENT_REQUIRED')
    expect(f.ws.sent).toHaveLength(0)
  })
  it('ignores another edit and rejects noncanonical base64', () => {
    const f = fixture(); const edit = startDesktopEdit(f.agent, { name: 'file.conf', content: '' }, f.save, f.notify)
    try {
      f.ws.emit('message', Buffer.from(JSON.stringify({ type: 'file_edit_save', editId: 'other', content: 'YQ==' })), false)
      expect(f.save).not.toHaveBeenCalled()
      f.ws.emit('message', Buffer.from(JSON.stringify({ type: 'file_edit_save', editId: edit.editId, content: '!!!' })), false)
      expect(f.ws.sent.at(-1)).toMatchObject({ type: 'file_edit_ack', ok: false, code: 'FILE_INVALID_CONTENT' })
      expect(f.save).not.toHaveBeenCalled()
    } finally { edit.stop() }
  })
  it('reports a conflict and removes scoped listeners on disconnect', async () => {
    const f = fixture(); f.save.mockRejectedValue(new Error('FILE_CONFLICT'))
    const edit = startDesktopEdit(f.agent, { name: 'file.conf', content: '' }, f.save, f.notify)
    f.ws.emit('message', Buffer.from(JSON.stringify({ type: 'file_edit_save', editId: edit.editId, content: 'YQ==' })), false)
    await vi.waitFor(() => expect(f.notify).toHaveBeenCalledWith({ state: 'conflict', code: 'FILE_CONFLICT' }))
    expect(f.ws.sent.at(-1)).toMatchObject({ ok: false, code: 'FILE_CONFLICT' })
    f.ws.emit('close')
    expect(f.notify).toHaveBeenCalledWith({ state: 'offline' })
    expect(f.ws.listenerCount('message')).toBe(0)
    expect(f.ws.listenerCount('close')).toBe(0)
    edit.stop()
  })
})
