const { createHash, timingSafeEqual } = require('node:crypto')
const { isIP } = require('node:net')
function invalid() { return new Error('TRIAL_LIVE_EXPLICIT_DISPOSABLE_SSH_REQUIRED') }
function ipv4(value) { return value.split('.').reduce((result, part) => (result * 256 + Number(part)) >>> 0, 0) }
function readTrialBoundary(env) {
  const host = env.TRIAL_LIVE_SSH_HOST
  const port = Number(env.TRIAL_LIVE_SSH_PORT)
  const username = env.TRIAL_LIVE_SSH_USER
  const password = env.TRIAL_LIVE_SSH_PASSWORD
  const fingerprint = env.TRIAL_LIVE_SSH_FINGERPRINT
  const networkCidr = env.TRIAL_LIVE_NETWORK_CIDR
  const [network, prefixText, extra] = (networkCidr ?? '').split('/')
  const prefix = Number(prefixText)
  if (isIP(host ?? '') !== 4 || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password
      || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint ?? '') || isIP(network ?? '') !== 4
      || !/^\d{1,2}$/.test(prefixText ?? '') || prefix < 8 || prefix > 30 || extra !== undefined) throw invalid()
  let demoHosts, protectedAddresses
  try { demoHosts = JSON.parse(env.TRIAL_LIVE_DEMO_HOSTS); protectedAddresses = JSON.parse(env.TRIAL_LIVE_PROTECTED_ADDRESSES) } catch { throw invalid() }
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const inside = value => typeof value === 'string' && isIP(value) === 4 && ((ipv4(value) & mask) >>> 0) === ((ipv4(network) & mask) >>> 0)
  if (!Array.isArray(demoHosts) || demoHosts.length !== 3 || new Set(demoHosts).size !== 3 || demoHosts[0] !== host
      || !demoHosts.every(inside) || !inside(env.TRIAL_LIVE_FORBIDDEN_HOST) || demoHosts.includes(env.TRIAL_LIVE_FORBIDDEN_HOST)
      || !Array.isArray(protectedAddresses) || !protectedAddresses.length || !protectedAddresses.every(value => typeof value === 'string' && isIP(value) !== 0)
      || demoHosts.some(value => protectedAddresses.includes(value))) throw invalid()
  return { host, port, username, password, fingerprint, networkCidr, demoHosts, protectedAddresses, forbiddenHost: env.TRIAL_LIVE_FORBIDDEN_HOST }
}
function verifyDisposableSsh(config, { Client = require('ssh2').Client, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let finished = false
    const finish = error => {
      if (finished) return
      finished = true; clearTimeout(timer); client.destroy()
      if (error) reject(new Error(error)); else resolve(config.fingerprint)
    }
    const timer = setTimeout(() => finish('TRIAL_LIVE_SSH_TIMEOUT'), timeoutMs)
    client.on('error', () => finish('TRIAL_LIVE_SSH_REJECTED'))
    client.once('close', () => { if (!finished) finish('TRIAL_LIVE_SSH_CLOSED') })
    client.once('ready', () => finish())
    try {
      client.connect({ host: config.host, port: config.port, username: config.username, password: config.password, readyTimeout: timeoutMs,
        hostVerifier: key => {
          const actual = `SHA256:${createHash('sha256').update(key).digest('base64url').replaceAll('-', '+').replaceAll('_', '/')}`
          return actual.length === config.fingerprint.length && timingSafeEqual(Buffer.from(actual), Buffer.from(config.fingerprint))
        } })
    } catch { finish('TRIAL_LIVE_SSH_REJECTED') }
  })
}
module.exports = { readTrialBoundary, verifyDisposableSsh }
