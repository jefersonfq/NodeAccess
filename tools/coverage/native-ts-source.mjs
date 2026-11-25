import { Session } from 'node:inspector'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { threadId } from 'node:worker_threads'

// Preloaded before application imports, including inherited Node subprocesses.
if (process.env.NODE_V8_COVERAGE && process.env.NODEACCESS_NATIVE_TS_PROVENANCE) {
  const manifest = JSON.parse(readFileSync(process.env.NODEACCESS_NATIVE_TS_PROVENANCE, 'utf8'))
  if (manifest.schemaVersion !== 1 || typeof manifest.session !== 'string' || !manifest.session
    || manifest.nodeVersion !== process.versions.node || manifest.mode !== 'strip') throw new Error('Invalid native TS capture manifest')
  const allowed = new Set(Object.keys(manifest.sourceHashes).map(file => pathToFileURL(resolve(manifest.root, file)).href))
  const output = join(process.env.NODE_V8_COVERAGE, `native-ts-${process.pid}-${threadId}.json`)
  const proof = { schemaVersion: 1, session: manifest.session, pid: process.pid, threadId,
    nodeVersion: process.versions.node, complete: false, scripts: [] }
  const persist = () => writeFileSync(output, JSON.stringify(proof), { mode: 0o600 })
  persist()
  const inspector = new Session()
  let pending = 0, failed = false, enabled = false
  inspector.connect()
  inspector.on('Debugger.scriptParsed', ({ params }) => {
    if (!allowed.has(params.url)) return
    pending++
    inspector.post('Debugger.getScriptSource', { scriptId: params.scriptId }, (error, result) => {
      pending--
      if (error || typeof result?.scriptSource !== 'string'
        || proof.scripts.some(script => script.scriptId === params.scriptId)) { failed = true; return }
      proof.scripts.push({ scriptId: params.scriptId, url: params.url,
        sha256: createHash('sha256').update(result.scriptSource).digest('hex'), length: result.scriptSource.length })
    })
  })
  inspector.post('Debugger.enable', error => { enabled = !error; failed ||= !!error })
  process.once('exit', () => {
    proof.complete = enabled && !failed && pending === 0
    persist()
    // Do not disconnect: that disables the shared V8 profiler before Node's exit
    // coverage flush, losing block ranges. Process teardown releases this session.
  })
}
