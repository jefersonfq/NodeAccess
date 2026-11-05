/** This pilot only inspects the disposable frontend. Arbitrary targets are not supported. */
export const zapTarget = 'https://web'
export function assertZapTarget(value) {
  if (value !== zapTarget) throw new Error('ZAP target must be the owned disposable frontend')
}
export const zapScenarios = {
  'login-page': ['GET', '/login', 200], javascript: ['GET', /^\/assets\/[A-Za-z0-9_.-]+\.js$/, 200], stylesheet: ['GET', /^\/assets\/[A-Za-z0-9_.-]+\.css$/, 200],
  ready: ['GET', '/health/ready', 200], 'anonymous-hosts': ['GET', '/api/v1/hosts', 401],
  'invalid-login': ['POST', '/api/v1/auth/login', 400], login: ['POST', '/api/v1/auth/login', 200],
  mfa: ['POST', '/api/v1/auth/verify-totp', 200], 'authenticated-hosts': ['GET', '/api/v1/hosts', 200],
  refresh: ['POST', '/api/v1/auth/refresh', 200], logout: ['POST', '/api/v1/auth/logout', 204], 'revoked-refresh': ['POST', '/api/v1/auth/refresh', 401],
}
export function summarizeZapReport(raw) {
  if (raw?.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(raw.version ?? '') || raw.mode !== 'passive'
    || raw.target !== zapTarget || !Number.isInteger(raw.enabledRules) || raw.enabledRules < 1 || raw.queueRemaining !== 0 || !Number.isInteger(raw.messages) || raw.messages < 10
    || !Array.isArray(raw.requests) || raw.requests.length !== Object.keys(zapScenarios).length || raw.messages < raw.requests.length || !Array.isArray(raw.alerts)) throw new Error('Incomplete ZAP report')
  if (new Set(raw.requests.map(r => r.name)).size !== Object.keys(zapScenarios).length) throw new Error('Duplicate/missing scenarios')
  const requests = raw.requests.map(r => {
    const expected = Object.hasOwn(zapScenarios, r.name) ? zapScenarios[r.name] : null
    const path = cleanPath(r.path)
    if (!expected || r.method !== expected[0] || r.status !== expected[2]
      || !(expected[1] instanceof RegExp ? expected[1].test(path) : path === expected[1])) throw new Error('Scenario response mismatch')
    if (typeof r.name !== 'string' || !/^[a-z-]+$/.test(r.name) || !['GET', 'POST'].includes(r.method)
      || !Number.isInteger(r.status) || r.status < 100 || r.status > 599 || r.passed !== true) throw new Error('Invalid request evidence')
    return { name: r.name, path, method: r.method, status: r.status, passed: true }
  })
  const alerts = raw.alerts.map(a => {
    if (!/^\d+(?:-\d+)?$/.test(a.rule ?? '') || ![0, 1, 2, 3].includes(a.risk)
      || !Array.isArray(a.paths) || !a.paths.length) throw new Error('Invalid alert evidence')
    // Only rule identity/severity and paths are exported: no evidence, headers, tokens or bodies.
    return { rule: a.rule, risk: a.risk, paths: [...new Set(a.paths.map(cleanPath))].sort((left, right) => left.localeCompare(right, 'en')) }
  })
  return { schemaVersion: 1, mode: 'passive', target: zapTarget, version: raw.version,
    messages: raw.messages, enabledRules: raw.enabledRules, queueRemaining: 0, requests, alerts,
    passed: alerts.every(a => a.risk < 2), blocking: alerts.filter(a => a.risk >= 2) }
}
function cleanPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('?')
    || value.includes('#') || value.includes('\\') || /[\x00-\x20]/.test(value)) throw new Error('Unsafe report path')
  if (!/^\/(?:$|login$|health\/ready$|assets\/[A-Za-z0-9_.-]+\.(?:js|css)$|api\/v1\/(?:hosts|auth\/(?:login|verify-totp|refresh|logout))$)/.test(value)) throw new Error('Unreviewed report path')
  return value
}
