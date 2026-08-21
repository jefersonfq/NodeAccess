'use strict'

const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 60_000

function reconnectDelay(attempt, random = Math.random) {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt - 1)))
  return Math.round(exponential * (0.75 + random() * 0.5))
}

function resolveToken(values, env = process.env, readFile) {
  if (values.token) return values.token
  if (values['token-file']) return readFile(values['token-file'], 'utf8').trim()
  return env.NODEACCESS_AGENT_TOKEN?.trim() || ''
}

module.exports = { RECONNECT_BASE_MS, RECONNECT_MAX_MS, reconnectDelay, resolveToken }
