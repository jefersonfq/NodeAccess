const assert = require('node:assert/strict')
const test = require('node:test')
const { assertLoopbackBase, exitCodeFor, parseEnv, runWarmup, runWarmupWithRetries, safeSummary, signDevelopmentJwt } = require('./dev-warmup-lib.cjs')

test('parses quoted local env values', () => {
  assert.deepEqual(parseEnv('JWT_SECRET="safe-secret-value"\nTENANT_ID=2\n# ignored'), {
    JWT_SECRET: 'safe-secret-value',
    TENANT_ID: '2',
  })
})

test('signs a short-lived JWT without exposing the secret', () => {
  const secret = 'local-secret-that-must-not-leak'
  const token = signDevelopmentJwt({ sub: '1' }, secret, 60, 100)
  assert.equal(token.split('.').length, 3)
  assert.equal(token.includes(secret), false)
})

test('warms only the allowlisted GET resources and redacts authorization from summary', async () => {
  const calls = []
  const token = 'header.payload.signature'
  const report = await runWarmup({
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token,
    timeoutMs: 100,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 200 }
    },
  })
  assert.equal(report.status, 'passed')
  assert.equal(calls.length, 4)
  assert.ok(calls.every(call => call.options.method === 'GET'))
  assert.equal(safeSummary(report).includes(token), false)
  assert.equal(calls[0].options.headers, undefined)
  assert.equal(calls.slice(1).every(call => call.options.headers.authorization === `Bearer ${token}`), true)
})

test('classifies an endpoint failure and remains reportable', async () => {
  let call = 0
  const report = await runWarmup({
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token: 'token',
    timeoutMs: 100,
    fetchImpl: async () => ({ ok: ++call !== 2, status: call === 2 ? 503 : 200 }),
  })
  assert.equal(report.status, 'failed')
  assert.equal(report.results.filter(result => result.status === 'failed').length, 1)
})

test('gives the cold Vite transform a larger timeout budget than API requests', async () => {
  const observedTimeouts = []
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (callback, timeout, ...args) => {
    observedTimeouts.push(timeout)
    return originalSetTimeout(callback, 0, ...args)
  }
  try {
    await runWarmup({
      frontendBase: 'http://localhost:5173',
      apiBase: 'http://127.0.0.1:3000/api/v1',
      token: 'token',
      timeoutMs: 5000,
      fetchImpl: async () => ({ ok: true, status: 200 }),
    })
  } finally {
    global.setTimeout = originalSetTimeout
  }
  assert.ok(observedTimeouts.includes(30000))
  assert.equal(observedTimeouts.filter(timeout => timeout === 5000).length, 3)
})

test('refuses to send the development token to a non-loopback origin', () => {
  assert.throws(() => assertLoopbackBase('https://example.com/api/v1', 'API_BASE'), /loopback/)
  assert.equal(assertLoopbackBase('http://localhost:3000/api/v1/', 'API_BASE'), 'http://localhost:3000/api/v1')
})

test('retries startup races and applies strict versus best-effort exit codes', async () => {
  let call = 0
  const report = await runWarmupWithRetries({
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token: 'token',
    timeoutMs: 100,
    fetchImpl: async () => {
      call++
      return { ok: call > 4, status: call > 4 ? 200 : 503 }
    },
  }, 2, 0)
  assert.equal(report.status, 'passed')
  assert.equal(report.attempts, 2)
  assert.deepEqual(report.results.map(result => result.attempts), [2, 2, 2, 2])
  assert.equal(exitCodeFor(report, true), 0)
  assert.equal(exitCodeFor({ status: 'failed' }, false), 0)
  assert.equal(exitCodeFor({ status: 'failed' }, true), 1)
})

test('retries only failed resources and preserves the complete ordered report', async () => {
  const callsByUrl = new Map()
  const report = await runWarmupWithRetries({
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token: 'token',
    timeoutMs: 100,
    fetchImpl: async (url) => {
      const calls = (callsByUrl.get(url) || 0) + 1
      callsByUrl.set(url, calls)
      const isSidebar = url.includes('sidebar-bootstrap')
      return { ok: !isSidebar || calls > 1, status: isSidebar && calls === 1 ? 503 : 200 }
    },
  }, 3, 0)

  assert.equal(report.status, 'passed')
  assert.equal(report.attempts, 2)
  assert.deepEqual(report.results.map(result => result.name), [
    'vite:hosts-view',
    'api:hosts',
    'api:hosts-sidebar',
    'api:inventory',
  ])
  assert.deepEqual(report.results.map(result => result.attempts), [1, 1, 2, 1])
  assert.deepEqual([...callsByUrl.values()].sort(), [1, 1, 1, 2])
})

test('limits a persistent partial failure without repeating successful resources', async () => {
  const callsByUrl = new Map()
  const report = await runWarmupWithRetries({
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token: 'token',
    timeoutMs: 100,
    fetchImpl: async (url) => {
      callsByUrl.set(url, (callsByUrl.get(url) || 0) + 1)
      const failed = url.endsWith('/inventory')
      return { ok: !failed, status: failed ? 503 : 200 }
    },
  }, 3, 0)

  assert.equal(report.status, 'failed')
  assert.equal(report.attempts, 3)
  assert.deepEqual(report.results.map(result => result.attempts), [1, 1, 1, 3])
  assert.deepEqual([...callsByUrl.values()].sort(), [1, 1, 1, 3])
  assert.equal(exitCodeFor(report, false), 0)
  assert.equal(exitCodeFor(report, true), 1)
})

test('supports failed resources recovering in different retry cycles', async () => {
  const callsByUrl = new Map()
  const report = await runWarmupWithRetries({
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token: 'token',
    timeoutMs: 100,
    fetchImpl: async (url) => {
      const calls = (callsByUrl.get(url) || 0) + 1
      callsByUrl.set(url, calls)
      const requiredCalls = url.includes('sidebar-bootstrap') ? 2 : url.endsWith('/inventory') ? 3 : 1
      return { ok: calls >= requiredCalls, status: calls >= requiredCalls ? 200 : 503 }
    },
  }, 3, 0)

  assert.equal(report.status, 'passed')
  assert.equal(report.attempts, 3)
  assert.deepEqual(report.results.map(result => result.attempts), [1, 1, 2, 3])
  assert.deepEqual([...callsByUrl.values()].sort(), [1, 1, 2, 3])
})

test('rejects invalid resource selections and normalizes invalid cycle limits', async () => {
  const options = {
    frontendBase: 'http://localhost:5173',
    apiBase: 'http://127.0.0.1:3000/api/v1',
    token: 'token',
    timeoutMs: 100,
    fetchImpl: async () => ({ ok: true, status: 200 }),
  }
  await assert.rejects(runWarmup({ ...options, resourceNames: ['api:unknown'] }), /Recurso desconhecido/)
  await assert.rejects(runWarmup({ ...options, resourceNames: [] }), /não pode ser vazia/)
  const report = await runWarmupWithRetries(options, 0, 0)
  assert.equal(report.status, 'passed')
  assert.equal(report.attempts, 1)
  assert.deepEqual(report.results.map(result => result.attempts), [1, 1, 1, 1])
  const infiniteReport = await runWarmupWithRetries(options, Number.POSITIVE_INFINITY, 0)
  assert.equal(infiniteReport.status, 'passed')
  assert.equal(infiniteReport.attempts, 1)
})
