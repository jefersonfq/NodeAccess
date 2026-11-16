import { accessSync, constants, lstatSync, readdirSync, realpathSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const advice = {
  PREFLIGHT_NODE: 'Use the project Node 24.21+ toolchain (major 24).',
  PREFLIGHT_GIT: 'Install git and make /usr/bin/git executable.',
  PREFLIGHT_OPENSSL: 'Install OpenSSL and make /usr/bin/openssl executable.',
  PREFLIGHT_STORAGE: 'Review output, temporary and Vite cache permissions and symlinks as the workspace owner; no cache was repaired.',
  PREFLIGHT_LOOPBACK: 'Allow local ephemeral loopback listeners for the coverage laboratories.',
  PREFLIGHT_CHROMIUM: 'Install the project Playwright Chromium and its system dependencies, then verify browser launch as the workspace owner.',
  PREFLIGHT_CLEANUP: 'Review permissions on the private preflight temporary directory and remove the leftover probe as the workspace owner.',
}

function checkNode(version) {
  const [major, minor] = version.split('.').map(Number)
  if (major !== 24 || minor < 21 || !Number.isInteger(minor)) throw new Error('version')
}

function checkBinary(name, { root, env, spawnBinary }) {
  const result = spawnBinary(`/usr/bin/${name}`, [name === 'git' ? '--version' : 'version'], {
    cwd: root, env, timeout: 3000, stdio: 'ignore',
  })
  if (result.error || result.status !== 0) throw new Error('binary')
}

function inspectEntry(path) {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) throw new Error('symlink')
  if (process.getuid?.() !== 0 && stat.uid === 0) throw new Error('ownership')
  accessSync(path, constants.W_OK | (stat.isDirectory() ? constants.X_OK : 0))
  return stat
}

function inspectDirectory(path) {
  // Missing output/cache directories are valid if their nearest existing parent is writable.
  let current = path
  while (true) {
    try { lstatSync(current); break } catch (error) {
      if (error.code !== 'ENOENT') throw error
      current = dirname(current)
    }
  }
  if (realpathSync(current) !== resolve(current)) throw new Error('symlink')
  if (!inspectEntry(current).isDirectory()) throw new Error('directory')
  if (current !== path) return
  const pending = [path]
  while (pending.length) {
    for (const entry of readdirSync(pending.pop(), { withFileTypes: true })) {
      const child = join(entry.parentPath, entry.name)
      if (inspectEntry(child).isDirectory()) pending.push(child)
    }
  }
}

function checkStorage({ root }) {
  if (realpathSync(root) !== resolve(root) || root === parse(root).root) throw new Error('root')
  // Browser coverage owns coverage/browser/vite-cache; do not inspect or repair the app's unrelated dev cache.
  for (const relative of ['.tmp', 'coverage', 'node_modules/.vite', 'node_modules/.vite-temp']) {
    // .tmp may contain unrelated private logs: inspect its directory, not its contents.
    if (relative === '.tmp') {
      const path = join(root, relative)
      try { if (realpathSync(path) !== path || !inspectEntry(path).isDirectory()) throw new Error('temporary') }
      catch (error) { if (error.code !== 'ENOENT') throw error; inspectEntry(root) }
    } else inspectDirectory(join(root, relative))
  }
}

function checkLoopback() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    const timeout = setTimeout(() => { server.close(); reject(new Error('timeout')) }, 2000)
    server.once('error', () => { clearTimeout(timeout); reject(new Error('listener')) })
    server.listen(0, '127.0.0.1', () => server.close(error => {
      clearTimeout(timeout)
      if (error) reject(new Error('close')); else resolvePromise()
    }))
  })
}

function createRuntime({ root }) {
  mkdirSync(join(root, '.tmp'), { recursive: true, mode: 0o700 })
  return mkdtempSync(join(root, '.tmp/p-'))
}

function checkChromium({ root, env, runtime, spawnBrowser, killGroup }) {
  // The separate Node process ensures os.tmpdir()/Playwright use the short private runtime.
  const result = spawnBrowser(process.execPath, ['--input-type=module', '-e', `
    import { chromium } from 'playwright';
    const browser = await chromium.launch({headless:true, timeout:8000,
      executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, args:['--no-sandbox']});
    await browser.close();
  `], {
    cwd: root, env: { ...env, TMPDIR: runtime, TMP: runtime, TEMP: runtime, XDG_RUNTIME_DIR: runtime },
    timeout: 12000, killSignal: 'SIGKILL', detached: true, stdio: 'ignore',
  })
  // Kill only our private process group, including Chromium if Node timed out.
  if (Number.isSafeInteger(result.pid) && result.pid > 0) {
    try { killGroup(-result.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  if (result.error || result.status !== 0) throw new Error('chromium')
}

/** Safe, fast prerequisites only; never repairs caches or starts project services. */
export async function runEnvironmentPreflight({ root, env = process.env, requireLoopback = true, dependencies = {} }) {
  const deps = { spawnBinary: spawnSync, spawnBrowser: spawnSync, killGroup: process.kill, nodeVersion: process.versions.node, checkNode, checkBinary, checkStorage, checkLoopback, createRuntime, checkChromium,
    removeRuntime: runtime => rmSync(runtime, { recursive: true, force: true }), ...dependencies }
  const failures = []
  const check = async (code, probe) => {
    try { await probe(); return true } catch { failures.push({ code, advice: advice[code] }); return false }
  }
  const context = { root: resolve(root), env: { ...env }, spawnBinary: deps.spawnBinary,
    spawnBrowser: deps.spawnBrowser, killGroup: deps.killGroup }
  delete context.env.SONAR_TOKEN
  delete context.env.SONAR_REVIEW_TOKEN
  delete context.env.NODE_V8_COVERAGE
  await check('PREFLIGHT_NODE', () => deps.checkNode(deps.nodeVersion))
  await check('PREFLIGHT_GIT', () => deps.checkBinary('git', context))
  await check('PREFLIGHT_OPENSSL', () => deps.checkBinary('openssl', context))
  const storageReady = await check('PREFLIGHT_STORAGE', () => deps.checkStorage(context))
  if (requireLoopback) await check('PREFLIGHT_LOOPBACK', () => deps.checkLoopback(context))
  if (storageReady && !failures.length) {
    let runtime
    try {
      const ready = await check('PREFLIGHT_STORAGE', async () => { runtime = await deps.createRuntime(context) })
      if (ready) await check('PREFLIGHT_CHROMIUM', () => deps.checkChromium({ ...context, runtime }))
    } finally {
      if (runtime) await check('PREFLIGHT_CLEANUP', () => deps.removeRuntime(runtime))
    }
  }
  return { status: failures.length ? 'failed' : 'passed', failures }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runEnvironmentPreflight({ root: resolve(dirname(fileURLToPath(import.meta.url)), '../..') })
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'passed' ? 0 : 1
}
