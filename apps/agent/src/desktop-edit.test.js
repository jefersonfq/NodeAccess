'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { DesktopEdits } = require('./desktop-edit')
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'na-edit-test-'))
  const sent = []; const launched = []
  const edits = new DesktopEdits({ readyState: 1, send: value => sent.push(JSON.parse(value)) }, { root, platform: 'win32', launch: async file => launched.push(file) })
  t.after(async () => { edits.destroy(); await fs.rm(root, { recursive: true, force: true }) })
  return { root, sent, launched, edits, id: randomUUID() }
}
test('idle editor has no watchers, files or launched applications', async t => {
  const f = await fixture(t); assert.equal(f.edits.edits.size, 0); assert.deepEqual(await fs.readdir(f.root), []); assert.equal(f.launched.length, 0)
})
test('open sends only changed content and serializes saves until ack', async t => {
  const f = await fixture(t); await f.edits.open(f.id, { name: 'config.txt', content: Buffer.from('one').toString('base64') })
  const file = f.launched[0]; await fs.writeFile(file, 'two'); await f.edits.changed(f.id)
  await fs.writeFile(file, 'three'); await f.edits.changed(f.id)
  assert.equal(f.sent.filter(m => m.type === 'file_edit_save').length, 1)
  f.edits.handle({ type: 'file_edit_ack', editId: f.id, ok: true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(f.sent.filter(m => m.type === 'file_edit_save').length, 2)
  assert.equal(Buffer.from(f.sent.filter(m => m.type === 'file_edit_save')[1].content, 'base64').toString(), 'three')
})
test('conflict pauses automatic uploads and preserves local draft on disconnect', async t => {
  const f = await fixture(t); await f.edits.open(f.id, { name: 'config.txt', content: Buffer.from('one').toString('base64') })
  await fs.writeFile(f.launched[0], 'local'); await f.edits.changed(f.id)
  f.edits.handle({ type: 'file_edit_ack', editId: f.id, ok: false, code: 'FILE_CONFLICT' })
  await fs.writeFile(f.launched[0], 'newer'); await f.edits.changed(f.id)
  assert.equal(f.sent.filter(m => m.type === 'file_edit_save').length, 1)
  f.edits.destroy(); assert.equal(f.edits.edits.size, 0); assert.equal(await fs.readFile(f.launched[0], 'utf8'), 'newer')
})
test('atomic editor rename is observed through private directory watcher', async t => {
  const f = await fixture(t); await f.edits.open(f.id, { name: 'config.txt', content: Buffer.from('one').toString('base64') })
  const temporary = path.join(path.dirname(f.launched[0]), 'replacement.tmp')
  await fs.writeFile(temporary, 'replacement'); await fs.rename(temporary, f.launched[0])
  await new Promise(resolve => setTimeout(resolve, 900))
  assert.equal(f.sent.filter(m => m.type === 'file_edit_save').length, 1)
})
test('remote requests cannot launch executable files or traverse paths', async t => {
  const f = await fixture(t)
  await assert.rejects(f.edits.open(f.id, { name: 'payload.exe', content: 'YQ==' }))
  await assert.rejects(f.edits.open(f.id, { name: 'a.txt', content: Buffer.from('a\0b').toString('base64') }))
  assert.equal(f.launched.length, 0)
})

test('supports common extensionless server configuration files', async t => {
  const f = await fixture(t)
  for (const name of ['hosts', 'sshd_config', '.bashrc']) {
    const id = randomUUID()
    await f.edits.open(id, { name, content: Buffer.from('text configuration').toString('base64') })
    assert.equal(await fs.readFile(path.join(f.root, id, name), 'utf8'), 'text configuration')
    f.edits.stop(id)
  }
})
