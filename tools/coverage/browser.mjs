import { mkdirSync, openSync, closeSync, writeFileSync, rmSync, chmodSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const { manualPlugin } = createRequire(import.meta.url)('../manual/build.cjs')
export const requiredBrowserHarnesses = [
  ['frontend', 'tools/frontend/sonar-frontend-review.cjs'], ['table', 'tools/sonarqube/table-review.cjs'],
  ['terminal', 'tools/frontend/terminal-experience-playwright.cjs'], ['platform', 'tools/frontend/platform-settings-playwright.cjs'],
  ['flows', 'tools/frontend/sonar-flow-coverage.cjs'],
]

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
    child.once('close', code => {
      // The leader may exit on SIGTERM while a descendant survives in its private group.
      // Escalate now, before finish cancels the fallback timer; never retain a delayed PID target.
      if (timedOut) stop('SIGKILL')
      finish(null, code)
    })
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
  if (realpathSync(root) !== resolve(root)) throw new Error('Unsafe browser coverage root')
  for (const directory of [join(root, 'coverage'), output]) {
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 })
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== resolve(directory)) throw new Error('Unsafe browser coverage output directory')
  }
  chmodSync(output, 0o700)
  rmSync(join(output, 'chromium-v8'), { recursive: true, force: true })
  const result = { status: 'failed', phase: 'setup', captureRunId: randomUUID(), startedAt: new Date().toISOString(), kind: 'real Chromium; Node and mapped browser coverage are collected separately', harnesses: [] }
  let server
  try {
    const executablePath = env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath()
    server = await create({ configFile: false, root: join(root, 'apps/frontend'), logLevel: 'error',
      plugins: [vue(), { name: 'coverage-isolated-fixture', configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><body><main>Isolated coverage fixture</main></body></html>'); return }
          if (request.url?.startsWith('/api/')) { response.statusCode = 404; response.end('No backend in coverage fixture'); return }
          next()
        })
      } }, manualPlugin()],
      resolve: { alias: { '@': join(root, 'apps/frontend/src') } },
      optimizeDeps: { include: ['vue', 'naive-ui'], entries: ['index.html'] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: {}, fs: { allow: [root] } },
    })
    result.phase = 'listen'
    await server.listen()
    await server.environments?.client?.depsOptimizer?.scanProcessing
    const address = server.httpServer.address()
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Browser fixture must bind loopback')
    const base = `http://127.0.0.1:${address.port}`
    result.origin = base
    result.phase = 'readiness'
    await waitForBrowserModules(base)
    result.phase = 'harness'
    for (const [name, script] of requiredBrowserHarnesses) {
      const directory = join(output, name); mkdirSync(directory, { mode: 0o700, recursive: true })
      const childEnv = { ...env, FRONTEND_BASE: base, SONAR_REVIEW_OUTPUT: directory, SONAR_FLOW_OUTPUT: directory, BROWSER_COVERAGE_DIR: join(output, 'chromium-v8'), BROWSER_COVERAGE_RUN_ID: result.captureRunId,
        SONAR_ASSIGNED: join(root, 'docs/changes/2026/11/NA-0087-sonar-frontend/dispositions.json') }
      delete childEnv.SONAR_TOKEN; delete childEnv.SONAR_REVIEW_TOKEN; delete childEnv.CHROMIUM_PATH
      delete childEnv.CHROMIUM_CDP_URL; delete childEnv.NETWORK_DEVICE_PROFILE
      for (const key of Object.keys(childEnv)) if (key.endsWith('_REVIEW') || key.endsWith('_SMOKE')) delete childEnv[key]
      for (const key of ['REPORT_PATH', 'SCREENSHOT_PATH', 'AUTOCOMPLETE_SCREENSHOT_PATH', 'AUTOCOMPLETE_MOBILE_SCREENSHOT_PATH', 'THEME_SCREENSHOT_PATH', 'HIGHLIGHT_SCREENSHOT_PATH']) childEnv[key] = join(directory, key === 'REPORT_PATH' ? 'report.json' : key.toLowerCase() + '.png')
      childEnv.PLAYWRIGHT_EXECUTABLE_PATH = executablePath
      childEnv.CHROMIUM_PATH = executablePath
      const run = await execute(root, script, childEnv, join(output, `${name}.log`))
      result.harnesses.push({ name, ...run })
      if (run.exitCode !== 0 || run.timedOut) throw new Error(`Browser coverage harness failed: ${name}`)
    }
    result.status = 'passed'
    result.phase = 'complete'
  } catch (error) { result.error = error instanceof Error ? error.message : 'Browser coverage failed' }
  finally {
    if (server) {
      try { await server.close() } catch { result.status = 'failed'; result.phase = 'cleanup'; result.error = 'Browser fixture cleanup failed' }
    }
    result.finishedAt = new Date().toISOString()
    writeFileSync(join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  }
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await collectBrowserCoverage()
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : 1
}
