const crypto = require('node:crypto')

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signDevelopmentJwt(payload, secret, ttlSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || secret.length < 16) throw new Error('JWT_SECRET local ausente ou muito curto')
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: nowSeconds, exp: nowSeconds + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function parseEnv(content) {
  const values = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

function assertLoopbackBase(value, label) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`${label} deve apontar para loopback no warm-up de desenvolvimento`)
  }
  return url.origin + url.pathname.replace(/\/$/, '')
}

async function requestResource(resource, { token, timeoutMs = 5000, fetchImpl = fetch }) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), resource.timeoutMs ?? timeoutMs)
  try {
    const response = await fetchImpl(resource.url, {
      method: 'GET',
      headers: resource.auth ? { authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    })
    return {
      name: resource.name,
      status: response.ok ? 'passed' : 'failed',
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      name: resource.name,
      status: 'failed',
      httpStatus: null,
      durationMs: Date.now() - startedAt,
      reason: error?.name === 'AbortError' ? 'timeout' : 'request-error',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function runWarmup({ frontendBase, apiBase, token, timeoutMs, fetchImpl = fetch }) {
  const safeFrontendBase = assertLoopbackBase(frontendBase, 'FRONTEND_BASE')
  const safeApiBase = assertLoopbackBase(apiBase, 'API_BASE')
  const resources = [
    { name: 'vite:hosts-view', url: `${safeFrontendBase}/src/views/HostsView.vue`, auth: false, timeoutMs: 30000 },
    { name: 'api:hosts', url: `${safeApiBase}/hosts?page=1&limit=12`, auth: true },
    { name: 'api:hosts-sidebar', url: `${safeApiBase}/hosts/sidebar-bootstrap`, auth: true },
    { name: 'api:inventory', url: `${safeApiBase}/inventory`, auth: true },
  ]
  const results = await Promise.all(resources.map(resource => requestResource(resource, {
    token,
    timeoutMs,
    fetchImpl,
  })))
  return {
    status: results.every(result => result.status === 'passed') ? 'passed' : 'failed',
    results,
  }
}

async function runWarmupWithRetries(options, attempts = 3, delayMs = 500) {
  let report
  for (let attempt = 1; attempt <= attempts; attempt++) {
    report = await runWarmup(options)
    if (report.status === 'passed' || attempt === attempts) return { ...report, attempts: attempt }
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  return { ...report, attempts }
}

function exitCodeFor(report, strict) {
  return strict && report.status !== 'passed' ? 1 : 0
}

function safeSummary(report) {
  return JSON.stringify(report)
}

module.exports = { assertLoopbackBase, exitCodeFor, parseEnv, requestResource, runWarmup, runWarmupWithRetries, safeSummary, signDevelopmentJwt }
