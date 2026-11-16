const tls = require('node:tls')
const { performance } = require('node:perf_hooks')
const fingerprintPattern = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/

function inspectFingerprint({ host, port, servername, ca, timeoutMs = 2000 }, connect = tls.connect) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername, ca, rejectUnauthorized: true })
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('TLS handshake deadline exceeded')), timeoutMs)
    socket.once('error', error => finish(error))
    socket.once('close', () => finish(new Error('TLS connection closed before verification')))
    socket.once('secureConnect', () => {
      try {
        const fingerprint = socket.getPeerCertificate().fingerprint256
        if (!socket.authorized || !fingerprintPattern.test(fingerprint)) throw new Error('TLS peer certificate was not verified')
        finish(null, fingerprint)
      } catch (error) { finish(error) }
    })
  })
}

async function waitForFingerprint(inspect, expected, {
  timeoutMs = 5000, intervalMs = 100, now = () => performance.now(),
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof expected !== 'string' || !fingerprintPattern.test(expected)) throw new Error('Expected SHA-256 fingerprint is required')
  const deadline = now() + timeoutMs
  let cause
  while (now() < deadline) {
    try {
      const actual = await inspect(Math.min(2000, deadline - now()))
      if (actual === expected && now() < deadline) return actual
    } catch (error) { cause = error }
    const remaining = deadline - now()
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining))
  }
  throw new Error('Expected TLS certificate was not observed before the deadline', { cause })
}

module.exports = { inspectFingerprint, waitForFingerprint }
