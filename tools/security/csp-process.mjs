import { spawn } from 'node:child_process'
/** Each command owns a process group; cancellation includes grandchildren and normal-exit orphans. */
export function runCspProcess(command, args, { cwd, env, signal, timeoutMs, graceMs = 500, stdio = 'pipe' }) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || signal?.aborted) return Promise.reject(new Error('CSP command budget exhausted or cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio })
    let stdout = '', stderr = '', interrupted = false, orphaned = false, exitCode = null, timer, force, done = false
    const kill = name => { if (child.pid) { try { process.kill(-child.pid, name) } catch (error) { if (error.code !== 'ESRCH') throw error } } }
    const finish = error => {
      if (done) return
      done = true; clearTimeout(timer); clearTimeout(force); signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve({ exitCode, timedOut: interrupted, orphaned, stdout: stdout.trim(), stderr: stderr.trim() })
    }
    const terminate = () => {
      try { kill('SIGTERM') } catch (error) { finish(error); return }
      force = setTimeout(() => { try { kill('SIGKILL'); finish() } catch (error) { finish(error) } }, graceMs)
    }
    const abort = () => { if (done || force) return; interrupted = true; terminate() }
    for (const [stream, append] of [[child.stdout, value => { stdout += value }], [child.stderr, value => { stderr += value }]]) {
      stream?.on('data', data => { append(data.toString()); if (stdout.length + stderr.length > 2 * 1024 * 1024) abort() })
    }
    child.once('error', finish)
    child.once('exit', code => {
      exitCode = code
      if (force || done) return
      try { process.kill(-child.pid, 0); orphaned = true; terminate() }
      catch (error) { if (error.code === 'ESRCH') finish(); else finish(error) }
    })
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(abort, timeoutMs)
    if (signal?.aborted) abort()
  })
}
export function cspCancellation(timeoutMs, owner = process) {
  const controller = new AbortController(), abort = () => controller.abort()
  const timer = setTimeout(abort, timeoutMs)
  owner.on('SIGINT', abort); owner.on('SIGTERM', abort)
  return { signal: controller.signal, close() { clearTimeout(timer); owner.removeListener('SIGINT', abort); owner.removeListener('SIGTERM', abort) } }
}
