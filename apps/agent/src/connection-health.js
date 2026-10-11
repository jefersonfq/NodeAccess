'use strict'
const catalog = require('../../../packages/shared/src/data/agent-diagnostics.json')
function errorCode(error, target = false) {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (/ENOTFOUND|EAI_AGAIN/.test(code) || /DNS policy timeout/.test(message)) return target ? 'TARGET_DNS_FAILED' : 'DNS_FAILED'
  if (/ECONNREFUSED/.test(code)) return target ? 'TCP_REFUSED' : 'CONNECTION_REFUSED'
  if (/ETIMEDOUT/.test(code) || /timed out|timeout/i.test(message)) return target ? 'TCP_TIMEOUT' : 'CONNECT_TIMEOUT'
  if (target) {
    if (/denied by local access policy/.test(message)) return 'LOCAL_POLICY_DENIED'
    if (/EHOSTUNREACH|ENETUNREACH/.test(code)) return 'TARGET_UNREACHABLE'
    return 'TARGET_ERROR'
  }
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return 'TLS_FAILED'
  if (/401|403/.test(message)) return 'AUTH_REVOKED'
  if (/Unexpected server response/.test(message)) return 'HTTP_ERROR'
  return 'CONNECTION_LOST'
}
function closeCode(code, reason) {
  if (/heartbeat timeout/i.test(reason)) return 'HEARTBEAT_TIMEOUT'
  if (/registration replaced/i.test(reason)) return 'REGISTRATION_REPLACED'
  if (/authorization unavailable/i.test(reason)) return 'AUTH_UNAVAILABLE'
  if (/bookkeeping unavailable/i.test(reason)) return 'BOOKKEEPING_UNAVAILABLE'
  if (/budget exceeded|buffer limit/i.test(reason)) return 'LIMIT_EXCEEDED'
  if (code === 1008) return 'AUTH_REVOKED'
  if (code === 1000) return 'STOPPED'
  return 'CONNECTION_LOST'
}
// Only registration and heartbeat refresh this deadline: terminal traffic must not mask a dead control channel.
function watchConnection(onTimeout, { registrationMs = 10_000, heartbeatMs = 90_000 } = {}) {
  let registered = false, stopped = false
  let timer
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => { if (!stopped) onTimeout(registered ? 'HEARTBEAT_TIMEOUT' : 'REGISTRATION_TIMEOUT') }, ms); timer.unref?.() }
  arm(registrationMs)
  return {
    registered() { if (stopped) return; registered = true; arm(heartbeatMs) },
    ping() { if (registered && !stopped) arm(heartbeatMs) },
    stop() { stopped = true; clearTimeout(timer) },
  }
}
module.exports = { catalog, errorCode, closeCode, watchConnection }
