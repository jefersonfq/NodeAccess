// Test-lab transport only: wait for stdio to drain before decoding the probe.
export function collectProbeResponse(child) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let stdoutBytes = 0, stderrBytes = 0, timedOut = false
    const failure = (reason, code = null, signal = null) => new Error(`NETWORK_PROBE_${reason} ${JSON.stringify({ code, signal, timedOut, stdoutBytes, stderrBytes })}`)
    const deadline = setTimeout(() => {
      timedOut = true
      // A child may already have exited while a descendant still owns its pipes.
      // Settle independently of close, then release only this collector's stdio.
      reject(failure('TIMEOUT', child.exitCode ?? null, child.signalCode ?? null))
      try { child.kill('SIGKILL') } catch {
        // Timeout is already rejected; an unavailable process cannot delay cleanup.
      } finally {
        child.stdin?.destroy()
        child.stdout.destroy()
        child.stderr.destroy()
        chunks.length = 0
      }
    }, 10000)
    child.stdout.on('data', chunk => { chunks.push(Buffer.from(chunk)); stdoutBytes += chunk.length })
    // Never include the client's output, request, credentials or TLS paths in errors.
    child.stderr.on('data', chunk => { stderrBytes += chunk.length })
    child.once('error', () => { clearTimeout(deadline); reject(failure('START_FAILED')) })
    child.once('close', (code, signal) => {
      clearTimeout(deadline)
      if (code !== 0 || signal || timedOut) { reject(failure('EXIT_FAILED', code, signal)); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(failure('INVALID_JSON', code, signal)) }
    })
  })
}
