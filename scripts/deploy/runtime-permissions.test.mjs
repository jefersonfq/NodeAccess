import assert from 'node:assert/strict'
import { chmodSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { migratePermissions } from './runtime-permissions.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'na-permissions-'))
  const root = join(directory, 'data')
  const manifest = join(directory, 'permissions.json')
  mkdirSync(root)
  writeFileSync(join(root, 'audit.json'), 'unchanged', { mode: 0o600 })
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return { root, manifest }
}

test('rejects symlinks before writing inventory or changing ownership', t => {
  const args = fixture(t)
  symlinkSync('/tmp', join(args.root, 'escape'))
  assert.throws(() => migratePermissions({ ...args, mode: 'prepare' }), /symlink/)
  assert.throws(() => statSync(args.manifest))
})

test('manifest must be outside data and never overwritten', t => {
  const args = fixture(t)
  assert.throws(() => migratePermissions({ ...args, manifest: join(args.root, 'state'), mode: 'prepare' }), /outside/)
  writeFileSync(args.manifest, 'preserve')
  assert.throws(() => migratePermissions({ ...args, mode: 'prepare' }), /EEXIST/)
  assert.equal(readFileSync(args.manifest, 'utf8'), 'preserve')
})

test('restore rejects path traversal before mutation', t => {
  const args = fixture(t)
  writeFileSync(args.manifest, JSON.stringify({ version: 1, targetUid: 1000, targetGid: 1000, state: 'applied', entries: [{ path: '../escape' }] }))
  assert.throws(() => migratePermissions({ ...args, mode: 'restore' }), /Unsafe/)
  assert.equal(readFileSync(join(args.root, 'audit.json'), 'utf8'), 'unchanged')
})

test('special permission bits require review before preparing a migration', t => {
  const args = fixture(t)
  chmodSync(join(args.root, 'audit.json'), 0o4600)
  assert.throws(() => migratePermissions({ ...args, mode: 'prepare' }), /Special permission bits/)
  assert.throws(() => statSync(args.manifest))
})

test('hard links cannot extend ownership changes outside the migration tree', t => {
  const args = fixture(t)
  linkSync(join(args.root, 'audit.json'), join(args.root, '..', 'outside-link'))
  assert.throws(() => migratePermissions({ ...args, mode: 'prepare' }), /Hard-linked/)
  assert.throws(() => statSync(args.manifest))
})

for (const scenario of ['missing', 'replaced', 'changed-mode', 'duplicate', 'invalid-uid', 'oversized-uid', 'reserved-gid', 'no-root']) {
  test(`restore rejects ${scenario} metadata before any mutation`, t => {
    const args = fixture(t)
    const entry = name => {
      const stat = statSync(join(args.root, name))
      return { path: name, uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino }
    }
    const entries = [entry(''), entry('audit.json')]
    if (scenario === 'missing') entries[1].path = 'missing.json'
    if (scenario === 'replaced') entries[1].ino += 1
    if (scenario === 'changed-mode') entries[1].mode = 0o400
    if (scenario === 'duplicate') entries.push(entries[1])
    if (scenario === 'invalid-uid') entries[1].uid = -1
    if (scenario === 'oversized-uid') entries[1].uid = Number.MAX_SAFE_INTEGER
    if (scenario === 'reserved-gid') entries[1].gid = 0xffffffff
    if (scenario === 'no-root') entries.shift()
    writeFileSync(args.manifest, JSON.stringify({ version: 1, state: 'applied', targetUid: 1000, targetGid: 1000, entries }))
    const previousInventory = readFileSync(args.manifest, 'utf8')
    assert.throws(() => migratePermissions({ ...args, mode: 'restore' }))
    assert.equal(readFileSync(join(args.root, 'audit.json'), 'utf8'), 'unchanged')
    assert.equal(statSync(join(args.root, 'audit.json')).mode & 0o777, 0o600)
    assert.equal(readFileSync(args.manifest, 'utf8'), previousInventory, 'Invalid metadata must fail before saving recovery progress or changing any owner')
  })
}

test('unknown actions fail without writes', t => {
  const args = fixture(t)
  assert.throws(() => migratePermissions({ ...args, mode: 'unknown' }), /prepare or restore/)
  assert.throws(() => statSync(args.manifest))
})
