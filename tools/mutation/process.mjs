import { spawn } from 'node:child_process'

/** POSIX process groups keep the compiler and worker descendants within the budget. */
export function runBounded(command, args, { cwd, timeoutMs, graceMs = 5000, stdio = 'inherit' }) {
  if (process.platform === 'win32') throw new Error('Mutation budget requires a POSIX process group (WSL is supported)')
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(graceMs) || graceMs < 0) {
    throw new Error('Invalid mutation time budget')
  }
  return new Promise((resolve, reject) => {
    let interrupted = false, orphaned = false, timer, forceTimer, exitCode = null, settled = false
    const child = spawn(command, args, { cwd, detached: true, stdio })
    const signalGroup = signal => {
      if (!child.pid) return
      try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(forceTimer)
      process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort)
    }
    const finish = error => {
      if (settled) return
      settled = true; cleanup()
      if (error) reject(error)
      else resolve({ exitCode, interrupted, orphaned })
    }
    const terminateGroup = () => {
      clearTimeout(timer)
      try { signalGroup('SIGTERM') } catch (error) { finish(error); return }
      // Do not cancel this when the direct child exits: its workers may ignore TERM.
      forceTimer = setTimeout(() => {
        try { signalGroup('SIGKILL'); finish() } catch (error) { finish(error) }
      }, graceMs)
    }
    const abort = () => {
      if (interrupted || settled || forceTimer) return
      interrupted = true
      terminateGroup()
    }
    const finishExited = code => {
      exitCode = code
      if (interrupted || forceTimer) return
      try {
        process.kill(-child.pid, 0)
        // A successful parent must not conceal abandoned descendants.
        orphaned = true
        terminateGroup()
      } catch (error) {
        if (error.code === 'ESRCH') finish()
        else finish(error)
      }
    }
    process.once('SIGINT', abort); process.once('SIGTERM', abort)
    child.once('error', finish)
    child.once('exit', finishExited)
    timer = setTimeout(abort, timeoutMs)
  })
}
