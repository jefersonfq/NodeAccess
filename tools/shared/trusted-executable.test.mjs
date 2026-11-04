import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import resolver from './trusted-executable.cjs'
const { resolveExecutable, windowsCandidates, within } = resolver
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'na0149-executable-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin, { mode: 0o700 })
  const file = path.join(bin, 'fixture'); fs.writeFileSync(file, '#!/bin/sh\nprintf "%s" "$1"\n', { mode: 0o700 })
  return { root, bin, file, options: { env: { PATH: bin }, cwd: path.join(root, 'workspace') } }
}
test('resolves private executable and preserves literal argv without shell expansion', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const resolved = resolveExecutable('fixture', f.options)
  assert.equal(resolved, f.file); assert.equal(execFileSync(resolved, ['$(never-run); literal'], { encoding: 'utf8' }), '$(never-run); literal')
})
test('rejects writable executable and writable ancestor without running either', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); fs.chmodSync(f.file, 0o777)
  assert.throws(() => resolveExecutable('fixture', f.options), { code: 'EXECUTABLE_WRITABLE_BY_OTHERS' })
  fs.chmodSync(f.file, 0o700); fs.chmodSync(f.bin, 0o777)
  assert.throws(() => resolveExecutable('fixture', f.options), { code: 'EXECUTABLE_WRITABLE_BY_OTHERS' })
})
test('rejects cwd, relative or empty PATH, non-executable, directory and relative override', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t)
  assert.throws(() => resolveExecutable('fixture', { ...f.options, cwd: f.root }), { code: 'EXECUTABLE_IN_WORKSPACE' })
  for (const PATH of ['', '.', 'bin']) assert.throws(() => resolveExecutable('fixture', { env: { PATH } }), { code: 'EXECUTABLE_NOT_FOUND' })
  fs.chmodSync(f.file, 0o600); assert.throws(() => resolveExecutable('fixture', f.options), { code: 'EACCES' })
  assert.throws(() => resolveExecutable('bin', { ...f.options, env: { PATH: f.root } }), { code: 'EXECUTABLE_WRONG_TYPE' })
  assert.throws(() => resolveExecutable('fixture', { executable: './fixture' }), { code: 'EXECUTABLE_OVERRIDE_NOT_ABSOLUTE' })
})
test('supports trusted version-manager symlinks but rejects unsafe target and workspace target', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const link = path.join(f.root, 'link'); fs.mkdirSync(link, { mode: 0o700 }); fs.symlinkSync(f.file, path.join(link, 'fixture'))
  const options = { ...f.options, env: { PATH: link } }
  assert.equal(resolveExecutable('fixture', options), f.file)
  fs.chmodSync(f.file, 0o777); assert.throws(() => resolveExecutable('fixture', options), { code: 'EXECUTABLE_WRITABLE_BY_OTHERS' })
  fs.chmodSync(f.file, 0o700); assert.throws(() => resolveExecutable('fixture', { ...options, cwd: f.bin }), { code: 'EXECUTABLE_IN_WORKSPACE' })
})
test('Windows selection allows only native PATHEXT; no UNC, shell suffix or prefix confusion', () => {
  assert.deepEqual(windowsCandidates('git', 'C:\\Tools', '.BAT;.EXE;.CMD;.COM'), ['C:\\Tools\\git.exe', 'C:\\Tools\\git.com'])
  assert.deepEqual(windowsCandidates('git.cmd', 'C:\\Tools', '.EXE;.CMD'), [])
  assert.deepEqual(windowsCandidates('git', '\\\\server\\tools', '.EXE'), [])
  assert.deepEqual(windowsCandidates('git', 'relative', '.EXE'), [])
  assert.equal(within('C:\\Tools', 'C:\\Tools-evil\\git.exe', path.win32), false)
  assert.equal(within('C:\\Tools', 'C:\\Tools\\git.exe', path.win32), true)
})
test('owned Node binary resolves through explicit version-manager path and runs', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t); const node = path.join(f.bin, 'node'); fs.writeFileSync(node, fs.readFileSync(process.execPath), { mode: 0o700 })
  assert.equal(resolveExecutable('node', { ...f.options, executable: node }), node)
  assert.equal(execFileSync(node, ['-p', 'process.version'], { encoding: 'utf8' }).trim(), process.version)
})

test('rejects Windows UNC overrides before attempting network filesystem access', () => {
  assert.throws(() => resolveExecutable('git', { platform: 'win32', executable: '\\\\server\\tools\\git.exe', trustedRoots: ['C:\\Tools'] }), { code: 'EXECUTABLE_UNC_REJECTED' })
})
test('Windows native Node runs only under an explicit trusted root', { skip: process.platform !== 'win32' }, () => {
  const options = { executable: process.execPath, trustedRoots: [path.dirname(process.execPath)] }
  assert.equal(execFileSync(resolveExecutable('node', options), ['-p', 'process.version'], { encoding: 'utf8' }).trim(), process.version)
  assert.throws(() => resolveExecutable('node', { executable: process.execPath, trustedRoots: [] }), { code: 'EXECUTABLE_WINDOWS_TRUST_REQUIRED' })
  assert.throws(() => resolveExecutable('node', { ...options, trustedRoots: [path.dirname(process.execPath) + '-other'] }), { code: 'EXECUTABLE_WINDOWS_TRUST_REQUIRED' })
})
test('Windows reparse outside trusted root cannot inherit lexical trust', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'na0149-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  fs.writeFileSync(path.join(outside, 'node.exe'), fs.readFileSync(process.execPath)); fs.symlinkSync(outside, path.join(f.root, 'junction'), 'junction')
  assert.throws(() => resolveExecutable('node', { executable: path.join(f.root, 'junction', 'node.exe'), trustedRoots: [f.root], cwd: f.options.cwd }), { code: 'EXECUTABLE_WINDOWS_TRUST_REQUIRED' })
})

test('does not collapse an unsafe intermediate symlink target into a trusted final binary', {skip:process.platform==='win32'}, t=>{
 const f=fixture(t);const middle=path.join(f.root,'middle');fs.mkdirSync(middle,{mode:0o700});fs.symlinkSync(f.file,path.join(middle,'bridge'))
 const alias=path.join(f.bin,'alias');fs.symlinkSync(path.join(middle,'bridge'),alias)
 if(process.getuid()===0)fs.chownSync(middle,65534,65534);else fs.chmodSync(middle,0o777)
 assert.throws(()=>resolveExecutable('alias',f.options),{code:process.getuid()===0?'EXECUTABLE_FOREIGN_OWNER':'EXECUTABLE_WRITABLE_BY_OTHERS'})
})
test('returns the validated POSIX target without a second realpath lookup', {skip:process.platform==='win32'}, t=>{
 const f=fixture(t);const alias=path.join(f.bin,'alias');fs.symlinkSync(f.file,alias)
 const lookup=t.mock.method(fs,'realpathSync',()=>{throw Error('unexpected second lookup')})
 assert.equal(resolveExecutable('alias',f.options),f.file);assert.equal(lookup.mock.callCount(),0)
})
test('service cwd at filesystem root does not classify every installed tool as a workspace file', {skip:process.platform==='win32'}, t=>{
 const f=fixture(t);assert.equal(resolveExecutable('fixture',{...f.options,cwd:'/'}),f.file)
})
