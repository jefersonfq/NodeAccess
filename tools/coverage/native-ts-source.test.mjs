import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { nodeCoverageMap, nativeTypeScriptProvenance } from './node-map.mjs'

async function capture(t, { hook = false, worker = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'na0203-executed-ts-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = 'export function choose(flag: boolean): number { if (flag) return 1; return 2 }\nchoose(true)\n'
  for (const file of ['first.mts', 'second.mts']) writeFileSync(join(root, file), source)
  writeFileSync(join(root, 'plain.mjs'), 'export function plain(flag) { if (flag) return 1; return 2 }\nplain(true)\n')
  writeFileSync(join(root, 'entry.mjs'), worker
    ? "import './first.mts'; import {Worker} from 'node:worker_threads'; new Worker(new URL('./second.mts', import.meta.url))"
    : "import './first.mts'; import './second.mts'; import './plain.mjs'")
  writeFileSync(join(root, 'hook.mjs'), `import {registerHooks} from 'node:module';
registerHooks({ load(url, context, next) { const result = next(url, context);
if (url.endsWith('/second.mts')) return {...result, source: String(result.source).replace('return 1', 'return 9')};
return result } })`)
  const files = ['first.mts', 'second.mts', 'plain.mjs']
  const nativeTypeScript = await nativeTypeScriptProvenance(root, files)
  const manifest = join(root, 'manifest.json'); writeFileSync(manifest, JSON.stringify(nativeTypeScript))
  const directory = join(root, 'raw'); mkdirSync(directory)
  const env = { ...process.env, NODE_V8_COVERAGE: directory, NODEACCESS_NATIVE_TS_PROVENANCE: manifest,
    NODE_OPTIONS: `--import=${new URL('./native-ts-source.mjs', import.meta.url).href}` }
  const args = [...(hook ? ['--import', join(root, 'hook.mjs')] : []), join(root, 'entry.mjs')]
  const run = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 15000 })
  assert.equal(run.status, 0, run.stderr)
  const rawFiles = readdirSync(directory).filter(file => file.startsWith('coverage-'))
  const proofs = readdirSync(directory).filter(file => file.startsWith('native-ts-'))
  return { root, directory, files, nativeTypeScript, rawFiles, proofs, env, args }
}

test('Inspector IDs match raw coverage and capture leaves native TS and JS block counts unchanged', async t => {
  const f = await capture(t)
  const proof = JSON.parse(readFileSync(join(f.directory, f.proofs[0]), 'utf8'))
  assert.equal(proof.complete, true); assert.equal(proof.scripts.length, 2)
  const raw = JSON.parse(readFileSync(join(f.directory, f.rawFiles[0]), 'utf8'))
  for (const script of proof.scripts) {
    const executed = raw.result.find(entry => entry.scriptId === script.scriptId && entry.url === script.url)
    assert.ok(executed); assert.equal(executed.functions[0].ranges[0].endOffset, script.length)
  }
  const plainDirectory = join(f.root, 'no-inspector'); mkdirSync(plainDirectory)
  const env = { ...f.env, NODE_V8_COVERAGE: plainDirectory }; delete env.NODE_OPTIONS; delete env.NODEACCESS_NATIVE_TS_PROVENANCE
  const run = spawnSync(process.execPath, f.args, { env, encoding: 'utf8', timeout: 15000 })
  assert.equal(run.status, 0, run.stderr)
  const plain = JSON.parse(readFileSync(join(plainDirectory, readdirSync(plainDirectory)[0]), 'utf8'))
  for (const file of f.files) {
    const url = new URL(file, 'file://' + f.root + '/').href
    assert.deepEqual(raw.result.find(script => script.url === url).functions, plain.result.find(script => script.url === url).functions)
  }
  const map = await nodeCoverageMap(f)
  assert.equal(map.files().length, 3)
  assert.ok(map.getCoverageSummary().branches.covered < map.getCoverageSummary().branches.total)
})

test('same-length custom hook on a second module is rejected even when the process also strips native TS', async t => {
  const f = await capture(t, { hook: true })
  const proof = JSON.parse(readFileSync(join(f.directory, f.proofs[0]), 'utf8'))
  assert.equal(proof.complete, true); assert.equal(proof.scripts.length, 2)
  await assert.rejects(nodeCoverageMap(f), /executed source mismatch.*second\.mts/)
})

test('worker-thread coverage is bound to its own producer proof rather than the main process proof', async t => {
  const f = await capture(t, { worker: true })
  assert.equal(f.proofs.length, 2)
  const proofs = f.proofs.map(file => JSON.parse(readFileSync(join(f.directory, file), 'utf8')))
  assert.equal(proofs[0].pid, proofs[1].pid)
  assert.notEqual(proofs[0].threadId, proofs[1].threadId)
  const map = await nodeCoverageMap(f); assert.equal(map.files().length, 2)
  const workerProof = f.proofs.find(file => !file.endsWith('-0.json'))
  rmSync(join(f.directory, workerProof))
  await assert.rejects(nodeCoverageMap(f), /executed source proof missing/)
})

test('missing, incomplete, stale, ambiguous or foreign per-script capture cannot grant coverage', async t => {
  const f = await capture(t), path = join(f.directory, f.proofs[0])
  const original = readFileSync(path, 'utf8')
  const mutations = [
    proof => { proof.complete = false },
    proof => { proof.schemaVersion++ },
    proof => { proof.session = 'stale-session' },
    proof => { proof.nodeVersion = '24.0.0' },
    proof => { proof.pid++ },
    proof => { proof.threadId++ },
    proof => { proof.scripts.push(proof.scripts[0]) },
    proof => { proof.scripts[0].url += '?foreign' },
    proof => { proof.scripts[0].scriptId = 'unknown' },
    proof => { proof.scripts[0].sha256 = '0'.repeat(64) },
    proof => { proof.scripts[0].length++ },
  ]
  for (const mutate of mutations) {
    const proof = JSON.parse(original); mutate(proof); writeFileSync(path, JSON.stringify(proof))
    await assert.rejects(nodeCoverageMap(f), /executed source (proof invalid|mismatch)/)
  }
  rmSync(path)
  await assert.rejects(nodeCoverageMap(f), /executed source proof missing/)
})
