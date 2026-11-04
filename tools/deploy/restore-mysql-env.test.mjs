import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { createRestoreEnvironment } from './restore-mysql-env.cjs'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
const root = path.resolve(import.meta.dirname, '../..')
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'na0153-contract-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }
function readEnv(file) { return Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)] })) }

test('independent private environments contain unique matching credential pairs', t => {
  const entries = []
  for (let index = 0; index < 2; index++) {
    const dir = directory(t); createRestoreEnvironment(dir)
    assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600)
    const env = readEnv(path.join(dir, '.env'))
    assert.ok(/^[a-f0-9]{64}$/.test(env.DB_ROOT_PASSWORD), 'root credential format')
    assert.ok(/^[a-f0-9]{64}$/.test(env.DB_PASSWORD), 'user credential format')
    assert.ok(/^[a-f0-9]{64}$/.test(env.PEM_ENCRYPTION_KEY), 'validation key format')
    assert.ok(env.DB_PASSWORD === env.MYSQL_PASSWORD, 'user aliases agree')
    assert.ok(env.DB_ROOT_PASSWORD === env.MYSQL_ROOT_PASSWORD, 'root aliases agree')
    assert.ok(env.DB_ROOT_PASSWORD !== env.DB_PASSWORD, 'roles have distinct credentials')
    entries.push(env)
  }
  assert.ok(entries[0].DB_PASSWORD !== entries[1].DB_PASSWORD, 'user credentials vary per run')
  assert.ok(entries[0].DB_ROOT_PASSWORD !== entries[1].DB_ROOT_PASSWORD, 'root credentials vary per run')
  assert.ok(entries[0].PEM_ENCRYPTION_KEY !== entries[1].PEM_ENCRYPTION_KEY, 'validation keys vary per run')
})

test('unsafe workspace, symlink and preexisting data fail without mutation', t => {
  const base = directory(t)
  const privateDir = path.join(base, 'private'); fs.mkdirSync(privateDir, { mode: 0o700 })
  const link = path.join(base, 'link'); fs.symlinkSync(privateDir, link)
  assert.throws(() => createRestoreEnvironment(link), /UNSAFE/)
  const publicDir = path.join(base, 'public'); fs.mkdirSync(publicDir, { mode: 0o755 }); fs.chmodSync(publicDir, 0o755)
  assert.throws(() => createRestoreEnvironment(publicDir), /UNSAFE/)
  assert.equal(fs.statSync(publicDir).mode & 0o777, 0o755)
  fs.writeFileSync(path.join(privateDir, '.env'), 'preserve')
  assert.throws(() => createRestoreEnvironment(privateDir), /UNSAFE/)
  assert.equal(fs.readFileSync(path.join(privateDir, '.env'), 'utf8'), 'preserve')
  const parentLink = path.join(base, 'parent-link'); fs.symlinkSync(base, parentLink)
  const child = path.join(base, 'child'); fs.mkdirSync(child, { mode: 0o700 })
  assert.throws(() => createRestoreEnvironment(path.join(parentLink, 'child')), /UNSAFE/)
})

function fakeRun(t, options = {}) {
  const base = directory(t), bin = path.join(base, 'bin'), runtime = path.join(base, 'runtime')
  fs.mkdirSync(bin); fs.mkdirSync(runtime, { mode: 0o700 })
  const calls = path.join(base, 'calls.jsonl'), metadata = path.join(base, 'metadata.json')
  const dump = path.join(base, 'synthetic.sql.gz'); fs.writeFileSync(dump, gzipSync('SELECT 1;'))
  fs.writeFileSync(path.join(base, 'synthetic.sha256'), `${createHash('sha256').update(fs.readFileSync(dump)).digest('hex')}  synthetic.sql.gz\n`)
  const fake = `#!${process.execPath}\nconst fs=require('node:fs'),crypto=require('node:crypto'); const a=process.argv.slice(2); fs.appendFileSync(process.env.CALLS,JSON.stringify(a)+'\\n'); if(a[0]==='ps'||['network','volume'].includes(a[0])){if((a[0]==='ps'?'container':a[0])===process.env.EXISTING)process.stdout.write('existing');process.exit(0)} if(a.includes('up')){const e=fs.readFileSync(a[a.indexOf('--env-file')+1],'utf8');fs.writeFileSync(process.env.METADATA,JSON.stringify({privateMode:fs.statSync(a[a.indexOf('--env-file')+1]).mode&511,secretNotInArgs:!a.some(v=>v.includes(e.split('\\n')[0].split('=')[1]))}));process.exit(process.env.FAIL_UP==='1'?7:0)} if(a.includes('exec'))process.stdout.write('1');`
  fs.writeFileSync(path.join(bin, 'docker'), fake, { mode: 0o700 })
  if (options.marker) fs.writeFileSync(path.join(runtime, 'marker'), 'preserve')
  const result = spawnSync(resolveExecutable('bash'), ['tools/deploy/restore-mysql-isolated-harness.sh', dump], { cwd: root, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`, TMP_ROOT: runtime, RESTORE_PROJECT_NAME: 'na0153-contract', CALLS: calls, METADATA: metadata, EXISTING: options.existing || '', FAIL_UP: options.failUp ? '1' : '0' } })
  return { result, runtime, calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [], metadata: fs.existsSync(metadata) ? JSON.parse(fs.readFileSync(metadata, 'utf8')) : null }
}

test('actual shell orchestration restores and cleans its own workspace without host argv secrets', t => {
  const run = fakeRun(t)
  assert.equal(run.result.status, 0, run.result.stderr)
  assert.deepEqual(run.metadata, { privateMode: 0o600, secretNotInArgs: true })
  assert.equal(fs.existsSync(run.runtime), false)
  assert.ok(run.calls.some(args => args.includes('down')))
  assert.doesNotMatch(run.result.stdout + run.result.stderr, /DB_ROOT_PASSWORD=[a-f0-9]{64}|MYSQL_PASSWORD=[a-f0-9]{64}/)
})

for (const resource of ['container', 'network', 'volume']) test(`existing ${resource} rejects before creation or cleanup`, t => {
  const run = fakeRun(t, { existing: resource })
  assert.equal(run.result.status, 1)
  assert.match(run.result.stderr, /RESTORE_PROJECT_ALREADY_EXISTS/)
  assert.equal(fs.existsSync(run.runtime), true)
  assert.equal(run.calls.some(args => args.includes('up') || args.includes('down')), false)
})

test('workspace rejection preserves marker and never tears down project', t => {
  const run = fakeRun(t, { marker: true })
  assert.equal(run.result.status, 1)
  assert.equal(fs.readFileSync(path.join(run.runtime, 'marker'), 'utf8'), 'preserve')
  assert.equal(run.calls.some(args => args.includes('down')), false)
})

test('failed own startup still performs cleanup of partial resources', t => {
  const run = fakeRun(t, { failUp: true })
  assert.equal(run.result.status, 7)
  assert.ok(run.calls.some(args => args.includes('down')))
  assert.equal(fs.existsSync(run.runtime), false)
})


test('restrictive caller umask still produces an owner-readable private env', t => {
  const dir = directory(t)
  const previous = process.umask(0o777)
  try { createRestoreEnvironment(dir) } finally { process.umask(previous) }
  assert.equal(fs.statSync(path.join(dir, '.env')).mode & 0o777, 0o600)
  assert.ok(readEnv(path.join(dir, '.env')).DB_ROOT_PASSWORD.length === 64)
})

test('foreign-owned workspace is rejected without chmod or removal', { skip: process.getuid?.() !== 0 }, t => {
  const dir = directory(t)
  fs.chownSync(dir, 65534, 65534)
  assert.throws(() => createRestoreEnvironment(dir), /UNSAFE/)
  assert.equal(fs.statSync(dir).uid, 65534)
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  assert.deepEqual(fs.readdirSync(dir), [])
})


test('public non-sticky ancestor cannot substitute a private workspace', t => {
  const base = directory(t), parent = path.join(base, 'public-parent'), leaf = path.join(parent, 'private')
  fs.mkdirSync(parent, { mode: 0o777 }); fs.chmodSync(parent, 0o777)
  fs.mkdirSync(leaf, { mode: 0o700 })
  assert.throws(() => createRestoreEnvironment(leaf), /UNSAFE/)
  assert.deepEqual(fs.readdirSync(leaf), [])
  assert.equal(fs.statSync(parent).mode & 0o777, 0o777)
  assert.equal(fs.statSync(leaf).mode & 0o777, 0o700)
})

test('foreign-owned ancestor cannot rename an owned private workspace', { skip: process.getuid?.() !== 0 }, t => {
  const base = directory(t), parent = path.join(base, 'foreign-parent'), leaf = path.join(parent, 'private')
  fs.mkdirSync(parent, { mode: 0o755 }); fs.mkdirSync(leaf, { mode: 0o700 })
  fs.chownSync(parent, 65534, 65534)
  assert.throws(() => createRestoreEnvironment(leaf), /UNSAFE/)
  assert.equal(fs.statSync(parent).uid, 65534)
  assert.equal(fs.statSync(leaf).uid, 0)
  assert.deepEqual(fs.readdirSync(leaf), [])
})
