import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export function executeBrowserHarness(root, script, env, logfile, timeoutMs = 120_000) {
  return new Promise((resolveRun, reject) => {
    const fd = openSync(logfile, 'w', 0o600)
    const child = spawn(process.execPath, [join(root, script)], { cwd: root, env, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' })
    let timedOut = false, force, settled = false
    const stop = signal => {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal) } catch { /* Process already closed. */ }
    }
    const timer = setTimeout(() => { timedOut = true; stop('SIGTERM'); force = setTimeout(() => stop('SIGKILL'), 5000) }, timeoutMs)
    const finish = (error, code) => {
      if (settled) return
      settled = true; clearTimeout(timer); clearTimeout(force); closeSync(fd)
      if (error) reject(error)
      else resolveRun({ exitCode: code ?? 1, timedOut })
    }
    child.once('error', error => finish(error))
    child.once('close', code => finish(null, code))
  })
}
export async function waitForBrowserModules(base, { timeoutMs = 60_000, fetcher = fetch } = {}) {
  const deadline = performance.now() + timeoutMs
  for (const module of ['vue.js', 'naive-ui.js']) {
    let ready = false
    while (performance.now() < deadline) {
      try {
        const response = await fetcher(`${base}/node_modules/.vite/deps/${module}`, { signal: AbortSignal.timeout(Math.max(1, Math.min(3000, Math.floor(deadline - performance.now())))) })
        await response.arrayBuffer()
        if (response.ok) { ready = true; break }
      } catch { /* Bounded readiness retry while Vite prebundles dependencies. */ }
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
    if (!ready) throw new Error('Browser fixture dependencies did not become ready')
  }
}
export async function collectBrowserCoverage({ root = projectRoot, env = process.env, create = createServer, execute = executeBrowserHarness } = {}) {
  const output = join(root, 'coverage/browser')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const result = { status: 'failed', kind: 'real Chromium against isolated Vite fixtures; V8 credit is Node-only', harnesses: [] }
  let server
  try {
    server = await create({ configFile: false, root: join(root, 'apps/frontend'), logLevel: 'error',
      plugins: [vue(), { name: 'coverage-isolated-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><body><main>Isolated coverage fixture</main></body></html>'); return }
          if (request.url?.startsWith('/api/')) { response.statusCode = 404; response.end('No backend in coverage fixture'); return }
          next()
        })
      } }],
      resolve: { alias: { '@': join(root, 'apps/frontend/src') } },
      optimizeDeps: { include: ['vue', 'naive-ui'], entries: [] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: {}, fs: { allow: [root] } },
    })
    await server.listen()
    const address = server.httpServer.address()
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Browser fixture must bind loopback')
    const base = `http://127.0.0.1:${address.port}`
    await waitForBrowserModules(base)
    for (const [name, script] of [['frontend', 'tools/frontend/sonar-frontend-review.cjs'], ['table', 'tools/sonarqube/table-review.cjs']]) {
      const directory = join(output, name); mkdirSync(directory, { mode: 0o700, recursive: true })
      const childEnv = { ...env, FRONTEND_BASE: base, SONAR_REVIEW_OUTPUT: directory,
        SONAR_ASSIGNED: join(root, 'docs/changes/2026/11/NA-0087-sonar-frontend/dispositions.json') }
      delete childEnv.SONAR_TOKEN; delete childEnv.SONAR_REVIEW_TOKEN; delete childEnv.CHROMIUM_PATH
      if (env.PLAYWRIGHT_EXECUTABLE_PATH) childEnv.CHROMIUM_PATH = env.PLAYWRIGHT_EXECUTABLE_PATH
      const run = await execute(root, script, childEnv, join(output, `${name}.log`))
      result.harnesses.push({ name, ...run })
      if (run.exitCode !== 0 || run.timedOut) throw new Error(`Browser coverage harness failed: ${name}`)
    }
    result.status = 'passed'
  } catch (error) { result.error = error instanceof Error ? error.message : 'Browser coverage failed' }
  finally {
    if (server) {
      try { await server.close() } catch { result.status = 'failed'; result.error = 'Browser fixture cleanup failed' }
    }
    writeFileSync(join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  }
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await collectBrowserCoverage()
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : 1
}
