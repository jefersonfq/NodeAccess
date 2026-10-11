'use strict'
const fs = require('node:fs/promises')
const { watch } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash } = require('node:crypto')
const exec = promisify(execFile)
const LIMIT = 2 * 1024 * 1024
const digest = data => createHash('sha256').update(data).digest('hex')
const TYPES = new Set(['.txt', '.conf', '.cfg', '.json', '.yaml', '.yml', '.ini', '.xml', '.log', '.md', '.sh', '.py', '.js', '.ts', '.css', '.html', '.properties', '.env'])

class DesktopEdits {
  constructor(ws, options = {}) { this.ws = ws; this.edits = new Map(); this.platform = options.platform || process.platform; this.launch = options.launch; this.root = options.root || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NodeAccess', 'Edits') }
  send(editId, value) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ ...value, editId })) }
  state(id, state) { this.send(id, { type: 'file_edit_state', state }) }
  handle(message) {
    if (!['file_edit_open', 'file_edit_stop', 'file_edit_ack', 'file_edit_retry'].includes(message.type)) return false
    const id = message.editId
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return true
    if (message.type === 'file_edit_open') void this.open(id, message).catch(() => { this.stop(id); this.state(id, 'declined') })
    if (message.type === 'file_edit_stop') this.stop(id)
    if (message.type === 'file_edit_retry') { const edit = this.edits.get(id); if (edit && !edit.busy) { edit.paused = false; void this.changed(id) } }
    if (message.type === 'file_edit_ack') {
      const edit = this.edits.get(id)
      if (edit) {
        edit.busy = false
        if (message.ok) { edit.synced = edit.sent; this.state(id, 'synced'); void this.changed(id) }
        else { edit.paused = true; this.state(id, message.code === 'FILE_CONFLICT' ? 'conflict' : 'error') }
      }
    }
    return true
  }
  async open(id, message) {
    if (this.platform !== 'win32' || this.edits.size >= 4 || this.edits.has(id)) throw new Error('EDITOR_UNAVAILABLE')
    if (typeof message.content !== 'string' || message.content.length > Math.ceil(LIMIT / 3) * 4 || typeof message.name !== 'string') throw new Error('INVALID_FILE')
    const name = path.basename(message.name)
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name) || /[ .]$/.test(name)) throw new Error('INVALID_FILE')
    if (!/^[\w .-]{1,180}$/.test(name) || (path.extname(name) && !TYPES.has(path.extname(name).toLowerCase()))) throw new Error('TEXT_FILE_REQUIRED')
    const content = Buffer.from(message.content, 'base64')
    if (content.length > LIMIT || content.includes(0)) throw new Error('TEXT_FILE_REQUIRED')
    new TextDecoder('utf-8', { fatal: true }).decode(content)
    const dir = path.join(this.root, id); const file = path.join(dir, name)
    const edit = { dir, file, synced: digest(content), busy: false, paused: false, timer: null, watcher: null, sent: null }
    this.edits.set(id, edit)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    if (!this.launch) {
      // Restrict drafts to the interactive Windows identity, including after inheritance.
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'])
      const sid = stdout.trim(); if (!/^S-1-[\d-]+$/.test(sid)) throw new Error('ACL_FAILED')
      await exec('icacls.exe', [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`])
    }
    await fs.writeFile(file, content, { flag: 'wx', mode: 0o600 })
    if (!this.edits.has(id)) return
    edit.watcher = watch(dir, () => {
      clearTimeout(edit.timer)
      edit.timer = setTimeout(() => { void this.changed(id) }, 700)
    })
    edit.watcher.on('error', () => { edit.paused = true; this.state(id, 'error') })
    // Executable preference is local only. Remote requests never supply an app or arguments.
    let preferred = ''
    try { preferred = JSON.parse((await fs.readFile(path.join(this.root, '..', 'Agent', 'editor.json'), 'utf8')).replace(/^\uFEFF/, '')).executable || '' } catch { /* default editor */ }
    const app = process.env.NODEACCESS_EDITOR || preferred || 'notepad.exe'
    if (this.launch) await this.launch(file)
    else {
      const child = spawn(app, [file], { shell: false, detached: true, stdio: 'ignore' })
      child.on('error', () => { this.stop(id); this.state(id, 'declined') }); child.unref()
    }
    this.state(id, 'editing')
  }
  async changed(id) {
    const edit = this.edits.get(id)
    if (!edit || edit.busy || edit.paused) return
    try {
      const before = await fs.lstat(edit.file)
      if (!before.isFile() || before.isSymbolicLink() || before.size > LIMIT) throw new Error('INVALID_FILE')
      const content = await fs.readFile(edit.file)
      const after = await fs.lstat(edit.file)
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) { clearTimeout(edit.timer); edit.timer = setTimeout(() => { void this.changed(id) }, 700); return }
      if (content.length > LIMIT || content.includes(0)) throw new Error('INVALID_FILE')
      new TextDecoder('utf-8', { fatal: true }).decode(content)
      const hash = digest(content)
      if (hash === edit.synced) return
      edit.busy = true; edit.sent = hash
      this.state(id, 'sending')
      this.send(id, { type: 'file_edit_save', content: content.toString('base64') })
    } catch { edit.paused = true; this.state(id, 'error') }
  }
  stop(id) {
    const edit = this.edits.get(id)
    if (!edit) return
    clearTimeout(edit.timer); edit.watcher?.close(); this.edits.delete(id)
    // Drafts intentionally survive disconnects. Never delete an unsent editor buffer.
    this.state(id, 'closed')
  }
  destroy() { for (const id of this.edits.keys()) this.stop(id) }
}
module.exports = { DesktopEdits }
