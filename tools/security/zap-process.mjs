import { spawn } from 'node:child_process'
/** Bounded subprocesses let the owner reach its finally block on cancellation. */
export function createZapProcessRunner({ cwd, budgetMs = 20 * 60 * 1000 } = {}) {
  let child, killActive, cancelled = false, cleaning = false
  const cancel = () => { cancelled = true; if (!cleaning) killActive?.() }
  const budget = setTimeout(cancel, budgetMs)
  const run = (executable, args, { input, timeout = 180_000, maxBuffer = 16 * 1024 * 1024 } = {}) => new Promise((resolve, reject) => {
    if (cancelled && !cleaning) { reject(new Error('ZAP execution cancelled')); return }
    if (process.platform === 'win32') { reject(new Error('ZAP requires POSIX process groups; use WSL')); return }
    child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    const current = child
    let output = '', diagnostic = '', failed = false, size = 0, force, settled = false, closed = false, treeDone = false, exitCode
    const terminate = signal => {
      if (!current.pid) return
      try { process.kill(-current.pid, signal) } catch { /* Group already gone. */ }
    }
    const finish = () => {
      if (settled) return
      settled = true; clearTimeout(timer); clearTimeout(force)
      if (child === current) { child = undefined; killActive = undefined }
      if (failed || exitCode !== 0 || (cancelled && !cleaning)) {
        const error = new Error(safeFailure(diagnostic)); error.privateDiagnostic = diagnostic; error.exitCode = exitCode; reject(error)
      } else resolve(output.trim())
    }
    const stop = () => {
      if (force || settled) return
      failed = true; clearTimeout(timer); terminate('SIGTERM')
      // The parent may already have exited. Wait the full grace period for its workers.
      force = setTimeout(() => {
        terminate('SIGKILL'); current.stdout.destroy(); current.stderr.destroy(); finish()
      }, 2000)
    }
    killActive = stop
    const timer = setTimeout(stop, timeout)
    const collect = (data, stdout) => {
      size += data.length
      if (size > maxBuffer) stop()
      else if (stdout) output += data
      else diagnostic = (diagnostic + data).slice(-4096)
    }
    current.stdout.on('data', data => collect(data, true)); current.stderr.on('data', data => collect(data, false))
    current.stdin.on('error', () => { /* Child may exit before consuming disposable input. */ })
    current.once('error', () => { failed = true; treeDone = true })
    current.once('exit', code => {
      exitCode = code
      if (force) return
      try { process.kill(-current.pid, 0); stop() } catch {
        treeDone = true
        if (closed) finish()
      }
    })
    current.once('close', () => { closed = true; if (treeDone && !force) finish() })
    current.stdin.end(input)
  })
  const beginCleanup = () => { cleaning = true; clearTimeout(budget) }
  const dispose = () => clearTimeout(budget)
  return { run, cancel, beginCleanup, dispose, get cancelled() { return cancelled } }
}

function safeFailure(text) {
  try {
    const info = JSON.parse(text.trim())
    if (['KeyError', 'RuntimeError', 'HTTPError', 'URLError', 'JSONDecodeError', 'ValueError', 'TypeError'].includes(info.category)
      && /^(?:startup|login-page|javascript|stylesheet|ready|anonymous-hosts|invalid-login|login|mfa|authenticated-hosts|refresh|logout|revoked-refresh)$/.test(info.phase)) return `ZAP subprocess failed: ${info.category} at ${info.phase}`
  } catch { /* Arbitrary stderr is private and never exported. */ }
  return 'ZAP subprocess failed'
}
