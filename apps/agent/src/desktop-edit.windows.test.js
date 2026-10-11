'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DesktopEdits } = require('./desktop-edit')

test('Windows native executable edits a private draft using saved local preference and watcher uploads automatically', { skip: process.platform !== 'win32' || !process.env.NODEACCESS_EDITOR, timeout: 20000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nodeaccess-native-edit-'))
  const editor = process.env.NODEACCESS_EDITOR
  await fs.mkdir(path.join(root, 'Agent'))
  await fs.writeFile(path.join(root, 'Agent', 'editor.json'), '\uFEFF' + JSON.stringify({ executable: editor }))
  delete process.env.NODEACCESS_EDITOR
  const draftRoot = path.join(root, 'Edits')
  const messages = []
  let uploaded
  const upload = new Promise(resolve => { uploaded = resolve })
  const ws = { readyState: 1, send: raw => { const msg = JSON.parse(raw); messages.push(msg); if (msg.type === 'file_edit_save') uploaded(msg) } }
  const edits = new DesktopEdits(ws, { root: draftRoot })
  t.after(async () => { process.env.NODEACCESS_EDITOR = editor; edits.destroy(); await fs.rm(root, { recursive: true, force: true }) })
  const id = randomUUID()
  await edits.open(id, { name: 'config.txt', content: Buffer.from('original').toString('base64') })
  const saved = await upload
  assert.equal(Buffer.from(saved.content, 'base64').toString(), 'original\nNATIVE_EDIT')
  assert.ok(messages.some(msg => msg.state === 'editing'))
  assert.ok(messages.some(msg => msg.state === 'sending'))
  edits.handle({ type: 'file_edit_ack', editId: id, ok: true })
  edits.destroy()
  assert.equal(edits.edits.size, 0)
  assert.equal(await fs.readFile(path.join(draftRoot, id, 'config.txt'), 'utf8'), 'original\nNATIVE_EDIT')
})
