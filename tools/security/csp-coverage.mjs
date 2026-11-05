import { mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, openSync, closeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCspProcess, cspCancellation } from './csp-process.mjs'
import { sourceInventory, sourceFingerprint } from '../coverage/inventory.mjs'
import { cspHarnesses, cspBudgetMs, sha256, cspConfigFingerprint, validCspHarnessReport } from './csp-coverage-policy.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { artifactPath } = createRequire(import.meta.url)('../shared/private-artifacts.cjs')
export async function collectCspCoverage(env = process.env) {
  if (env.NODEACCESS_CSP_COVERAGE !== 'true' || !/^[a-f0-9-]{36}$/.test(env.NODEACCESS_CSP_COVERAGE_RUN_ID ?? '')) throw new Error('Explicit CSP coverage opt-in and run ID required')
  const directory = join(root, 'coverage/csp'), started = Date.now(), deadline = started + cspBudgetMs
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const id = `na-csp-${randomUUID()}`, web = `${id}-web`, ws = `${id}-ws`
  let cleanupDeadline
  const docker = async (args, cleanup = false) => {
    const result = await runCspProcess('/usr/bin/docker', args, { env, cwd: root, signal: cleanup ? undefined : cancellation.signal, timeoutMs: cleanup ? Math.min(10_000, cleanupDeadline - Date.now()) : Math.min(60_000, deadline - Date.now()) })
    if (result.exitCode !== 0 || result.timedOut || result.orphaned) throw new Error(`CSP Docker operation failed: ${args[0]}`)
    return result.stdout
  }
  const proof = { schemaVersion: 1, runId: env.NODEACCESS_CSP_COVERAGE_RUN_ID, startedAt: new Date(started).toISOString(), head: execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceFingerprint: sourceFingerprint(root, sourceInventory(root)), configFingerprint: cspConfigFingerprint(root), harnesses: [], passed: false, cleanupVerified: false }
  const cancellation = cspCancellation(Math.max(1, deadline - Date.now()))
  const childEnv = { ...env }
  for (const key of Object.keys(childEnv)) if (key.includes('BROWSER_COVERAGE') || key.endsWith('_REVIEW') || key.endsWith('_SMOKE')) delete childEnv[key]
  const run = async (name, script, options = {}, additions = {}) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('CSP laboratory budget exhausted')
    const fd = openSync(join(directory, `${name}.log`), 'w', 0o600)
    let result
    try { result = await runCspProcess(process.execPath, [...(options.nodeArgs ?? []), join(root, script), ...(options.args ?? [])], { cwd: root, env: { ...childEnv, ...additions }, signal: cancellation.signal, timeoutMs: remaining, stdio: ['ignore', fd, fd] }) }
    finally { closeSync(fd) }
    if (result.exitCode !== 0 || result.timedOut || result.orphaned) throw new Error(`CSP stage failed: ${name}`)
    return result
  }
  try {
    await run('shared-build', 'node_modules/typescript/bin/tsc', { nodeArgs: ['--import', 'data:text/javascript,process.umask(0o022)'], args: ['-p', 'packages/shared/tsconfig.json'] })
    await run('frontend-build', 'node_modules/vite/bin/vite.js', { nodeArgs: ['--import', 'data:text/javascript,process.umask(0o022)'], args: ['build', 'apps/frontend'] })
    await docker(['network', 'create', '--label', `nodeaccess.csp=${id}`, id])
    await docker(['run', '-d', '--name', ws, '--label', `nodeaccess.csp=${id}`, '--network', id, '--network-alias', 'ssh-gateway', '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-e', 'RUN_CSP_WS_FIXTURE=true', '-v', `${root}/tools/frontend/csp-ws-fixture.cjs:/fixture/server.cjs:ro`, '-v', `${root}/node_modules/ws:/fixture/node_modules/ws:ro`, 'node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53', 'node', '/fixture/server.cjs'])
    await docker(['run', '-d', '--name', web, '--label', `nodeaccess.csp=${id}`, '--network', id, '--add-host', 'api:127.0.0.1', '-p', '127.0.0.1::80', '-v', `${root}/docker/csp:/etc/nginx/csp:ro`, '-v', `${root}/apps/frontend/dist:/usr/share/nginx/html:ro`, '-v', `${root}/docker/nginx.http.conf:/etc/nginx/nginx.conf:ro`, 'nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951'])
    const binding = await docker(['port', web, '80/tcp'])
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Non-loopback CSP binding')
    proof.origin = `http://${binding}`
    let ready = false
    for (let attempt = 0; attempt < 30; attempt++) {
      cancellation.signal.throwIfAborted()
      try { const response = await fetch(proof.origin, { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(1000)]) }); ready = response.ok; await response.body?.cancel(); if (ready) break } catch { /* bounded readiness retry */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!ready) throw new Error('CSP Nginx readiness failed')
    for (const [name, script] of cspHarnesses) {
      const report = join(directory, `${name}.json`)
      rmSync(report, { force: true })
      if (name === 'styles') rmSync(artifactPath('nodeaccess-csp-styles.json'), { force: true })
      const result = await run(name, script, name === 'sanitizer' ? { nodeArgs: ['--test', '--test-reporter=tap'] } : {}, {
        ASSERT_CSP_NONCE: 'true', FRONTEND_BASE: proof.origin, REPORT_PATH: report, UX_REPORT_DIR: join(directory, 'supervision'), TERMINAL_LIFECYCLE_REVIEW: name === 'lifecycle' ? '1' : '', SUPERVISION_CSP_ONLY: name === 'supervision' ? '1' : '', RUN_MONACO_SANITIZER_REAL: name === 'sanitizer' ? 'true' : '',
      })
      if (name === 'styles') copyFileSync(artifactPath('nodeaccess-csp-styles.json'), report)
      if (name === 'supervision') copyFileSync(join(directory, 'supervision/report.json'), report)
      if (name === 'sanitizer') {
        const log = readFileSync(join(directory, 'sanitizer.log'), 'utf8'), counts = {}
        for (const key of ['tests', 'pass', 'fail', 'skipped']) counts[key] = Number(log.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1] ?? Number.NaN)
        writeFileSync(report, JSON.stringify(counts), { mode: 0o600 })
      }
      const bytes = readFileSync(report)
      if (!validCspHarnessReport(name, JSON.parse(bytes))) throw new Error(`CSP report not verified: ${name}`)
      proof.harnesses.push({ name, exitCode: result.exitCode, timedOut: result.timedOut, orphaned: result.orphaned, reportSha256: sha256(bytes) })
    }
    proof.passed = proof.sourceFingerprint === sourceFingerprint(root, sourceInventory(root)) && proof.configFingerprint === cspConfigFingerprint(root)
  } catch (error) { proof.error = error.message }
  finally {
    cleanupDeadline = Date.now() + 30_000
    try {
      // Query our unique label, never remove resources belonging to another lab.
      for (let attempt = 0; attempt < 2; attempt++) {
        const containers = await docker(['ps', '-aq', '--filter', `label=nodeaccess.csp=${id}`], true)
        if (containers) await docker(['rm', '-f', ...containers.split(/\s+/)], true)
        const networks = await docker(['network', 'ls', '-q', '--filter', `label=nodeaccess.csp=${id}`], true)
        if (networks) await docker(['network', 'rm', ...networks.split(/\s+/)], true)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      proof.cleanupVerified = await docker(['ps', '-aq', '--filter', `label=nodeaccess.csp=${id}`], true) === '' && await docker(['network', 'ls', '-q', '--filter', `label=nodeaccess.csp=${id}`], true) === ''
    } catch { proof.cleanupVerified = false }
    cancellation.close()
    proof.passed &&= proof.cleanupVerified && !cancellation.signal.aborted
    proof.finishedAt = new Date().toISOString()
    writeFileSync(join(directory, 'summary.json'), JSON.stringify(proof, null, 2), { mode: 0o600 })
  }
  return proof
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const proof = await collectCspCoverage(); console.log(JSON.stringify({ passed: proof.passed, error: proof.error, cleanupVerified: proof.cleanupVerified })); process.exitCode = proof.passed ? 0 : 1 }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
