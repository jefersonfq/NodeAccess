#!/usr/bin/env node
/*
 * Hosts page performance check via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9339 --user-data-dir=/tmp/nodeaccess-hosts-perf \
 *     --window-size=1440,1000 about:blank
 *
 *   node tools/frontend/hosts-cdp-perf.cjs
 *
 * Useful env vars:
 *   FRONTEND_BASE=http://127.0.0.1:5173
 *   CDP_BASE=http://127.0.0.1:9339
 *   ADMIN_USER_ID=1
 *   ADMIN_EMAIL=admin@nodeaccess.local
 *   TENANT_ID=1
 *   RECENT_IDS=236,235,829,424,629,830,726,173
 *   POST_CLICK_WAIT_MS=1200
 *   PERF_MODES=normal,list-minimal,no-presence
 *   PRESENCE_RESILIENCE_CHECK=1
 *   STARTUP_SNIPPET_FORM_CHECK=1
 *   CACHE_DIAGNOSTICS=1
 *   REPORT_PATH=/tmp/nodeaccess-hosts-perf.json
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9339'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '1'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nodeaccess.local'
const TENANT_ID = Number(process.env.TENANT_ID || '1')
const POST_CLICK_WAIT_MS = Number(process.env.POST_CLICK_WAIT_MS || '1200')
const PERF_MODES = (process.env.PERF_MODES || process.env.PERF_MODE || 'normal')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const PRESENCE_RESILIENCE_CHECK = process.env.PRESENCE_RESILIENCE_CHECK === '1'
const STARTUP_SNIPPET_FORM_CHECK = process.env.STARTUP_SNIPPET_FORM_CHECK === '1'
const CACHE_DIAGNOSTICS = process.env.CACHE_DIAGNOSTICS !== '0'
const CACHE_DIAGNOSTICS_DETAIL = process.env.CACHE_DIAGNOSTICS_DETAIL === '1'
const PERF_CARD_PAGE_SIZE = Number(process.env.PERF_CARD_PAGE_SIZE || '0')
const recentIds = (process.env.RECENT_IDS || '236,235,829,424,629,830,726,173')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0)

function readJwtSecret() {
  const envPath = process.env.BACKEND_ENV_PATH || path.join(REPO_ROOT, 'apps/backend/.env')
  const envFile = fs.readFileSync(envPath, 'utf8')
  const match = envFile.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error(`JWT_SECRET not found in ${envPath}`)
  return match[1].trim().replace(/^"|"$/g, '')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(payload, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: now, exp: now + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timeout } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(timeout)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
        return
      }
      if (msg.method) {
        this.events.push({ at: Date.now(), ...msg })
        const handlers = this.handlers.get(msg.method) || []
        for (const handler of handlers) {
          Promise.resolve(handler(msg)).catch(() => {})
        }
      }
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  close() {
    this.ws.close()
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || []
    handlers.push(handler)
    this.handlers.set(method, handlers)
  }
}

async function waitFor(cdp, expression, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    last = result.result?.value
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    const description = details.exception?.description || details.exception?.value || details.text
    throw new Error(description || 'Runtime exception')
  }
  return result.result?.value
}

function makeAccessMapPayload({ host, activeSessions = 2, uniqueUsers = 2 }) {
  const now = new Date()
  const hostInfo = {
    id: host.id,
    tenantId: TENANT_ID,
    name: host.name,
    ip: host.ip || '127.0.0.1',
    port: host.port || 22,
    accessProtocol: host.accessProtocol || 'ssh',
    scope: host.scope || 'global',
    groupName: host.groupName || null,
  }
  const sessions = Array.from({ length: activeSessions }, (_, index) => {
    const userId = index < uniqueUsers ? 9000 + index : 9000
    return {
      id: 8000 + index,
      user: {
        id: userId,
        name: index === 0 ? 'Admin Harness' : `Operador ${index}`,
        email: index === 0 ? ADMIN_EMAIL : `operador${index}@nodeaccess.local`,
        avatarUrl: null,
        avatarVersion: null,
      },
      startedAt: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
      lastSeenAt: now.toISOString(),
      durationSeconds: (index + 1) * 60,
      connectionMethod: 'direct',
      accessType: 'authenticated',
      clientIp: index === 0 ? '127.0.0.1' : `127.0.0.${index + 1}`,
      agentRemoteIp: null,
      agentNameSnapshot: null,
    }
  })
  return {
    generatedAt: now.toISOString(),
    refreshAfterSeconds: 1,
    totals: {
      activeSessions,
      activeHosts: activeSessions > 0 ? 1 : 0,
      uniqueUsers,
      concurrentHosts: uniqueUsers > 1 || activeSessions > 1 ? 1 : 0,
    },
    hosts: activeSessions > 0
      ? [{
          host: hostInfo,
          activeSessions,
          uniqueUsers,
          oldestStartedAt: sessions[0]?.startedAt || now.toISOString(),
          lastStartedAt: sessions[sessions.length - 1]?.startedAt || now.toISOString(),
          lastSeenAt: now.toISOString(),
          sessions,
        }]
      : [],
  }
}

async function installAccessMapMock(cdp, state) {
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*://*/api/v1/sessions/access-map*', requestStage: 'Request' }],
  })
  cdp.on('Fetch.requestPaused', async (event) => {
    const requestId = event.params.requestId
    if (!event.params.request.url.includes('/api/v1/sessions/access-map')) {
      await cdp.send('Fetch.continueRequest', { requestId }).catch(() => {})
      return
    }
    state.calls += 1
    const mode = typeof state.mode === 'function' ? state.mode(state.calls) : state.mode
    if (mode === 'fail') {
      await cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' }).catch(() => {})
      return
    }
    const payload = typeof state.payload === 'function'
      ? state.payload(state.calls)
      : state.payload
    await cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(payload || {
        generatedAt: new Date().toISOString(),
        refreshAfterSeconds: 1,
        totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 },
        hosts: [],
      })).toString('base64'),
    }).catch(() => {})
  })
}

function summarizeNetwork(events) {
  const requests = new Map()
  const responses = new Map()
  const finishes = new Map()
  const failures = []
  for (const event of events) {
    const params = event.params || {}
    const requestId = params.requestId
    if (event.method === 'Network.requestWillBeSent' && params.request?.url?.includes('/api/')) {
      requests.set(requestId, {
        requestId,
        url: params.request.url,
        method: params.request.method,
        startedAt: event.at,
      })
    } else if (event.method === 'Network.responseReceived' && requestId && params.response?.url?.includes('/api/')) {
      responses.set(requestId, {
        status: params.response.status,
        mimeType: params.response.mimeType,
        fromDiskCache: !!params.response.fromDiskCache,
        fromServiceWorker: !!params.response.fromServiceWorker,
      })
    } else if (event.method === 'Network.loadingFinished' && requestId) {
      finishes.set(requestId, {
        finishedAt: event.at,
        encodedDataLength: params.encodedDataLength,
      })
    } else if (event.method === 'Network.loadingFailed' && requestId) {
      failures.push({
        requestId,
        errorText: params.errorText,
        canceled: !!params.canceled,
      })
    }
  }

  const calls = Array.from(requests.values()).map((request) => {
    const response = responses.get(request.requestId)
    const finish = finishes.get(request.requestId)
    return {
      method: request.method,
      url: request.url.replace(FRONTEND, ''),
      status: response?.status ?? null,
      durationMs: finish ? finish.finishedAt - request.startedAt : null,
      encodedDataLength: finish?.encodedDataLength ?? null,
      fromDiskCache: response?.fromDiskCache ?? false,
      fromServiceWorker: response?.fromServiceWorker ?? false,
    }
  })
  return { calls, failures }
}

function normalizeApiEndpoint(url) {
  try {
    const parsed = new URL(url, FRONTEND)
    if (!parsed.pathname.startsWith('/api/v1/')) return null
    return parsed.pathname
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
  } catch {
    return null
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function summarizeValues(values) {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 }
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  }
}

function summarizeApiCalls(networkItems) {
  const byEndpoint = new Map()
  for (const item of networkItems) {
    for (const call of item.network?.calls || []) {
      const endpoint = normalizeApiEndpoint(call.url)
      if (!endpoint) continue
      const key = `${call.method} ${endpoint}`
      const rows = byEndpoint.get(key) || []
      rows.push(call)
      byEndpoint.set(key, rows)
    }
  }
  return [...byEndpoint.entries()]
    .map(([key, rows]) => {
      const [method, ...endpointParts] = key.split(' ')
      const endpoint = endpointParts.join(' ')
      const statuses = rows.reduce((acc, row) => {
        const status = String(row.status || 'failed')
        acc[status] = (acc[status] || 0) + 1
        return acc
      }, {})
      return {
        method,
        endpoint,
        count: rows.length,
        statuses,
        durationMs: summarizeValues(rows.map((row) => row.durationMs).filter((value) => Number.isFinite(value))),
        encodedBodyBytes: summarizeValues(rows.map((row) => row.encodedDataLength || 0).filter((value) => Number.isFinite(value))),
        browserCacheHits: rows.filter((row) => row.fromDiskCache || row.fromServiceWorker).length,
      }
    })
    .sort((a, b) => b.count - a.count || b.durationMs.p95 - a.durationMs.p95)
}

function summarizeCacheSnapshot(snapshot) {
  const caches = snapshot?.caches || []
  return caches
    .filter((cache) => cache.totalReads > 0 || cache.entryCount > 0 || cache.stats?.clears > 0)
    .map((cache) => ({
      name: cache.name,
      kind: cache.kind,
      entryCount: cache.entryCount,
      ttlMs: cache.ttlMs,
      totalReads: cache.totalReads,
      hitRate: Math.round((cache.hitRate || 0) * 1000) / 10,
      hits: cache.stats?.hits || 0,
      misses: cache.stats?.misses || 0,
      sets: cache.stats?.sets || 0,
      clears: cache.stats?.clears || 0,
      health: cache.health,
      keyInsights: (cache.keyInsights || []).slice(0, 6),
      lastMutation: cache.meta || null,
    }))
    .sort((a, b) => b.totalReads - a.totalReads || b.misses - a.misses || a.name.localeCompare(b.name))
}

function compactCacheSnapshot(snapshot) {
  if (!snapshot) return null
  if (CACHE_DIAGNOSTICS_DETAIL) return snapshot
  return {
    at: snapshot.at,
    caches: (snapshot.caches || []).map((cache) => ({
      name: cache.name,
      kind: cache.kind,
      ttlMs: cache.ttlMs,
      entryCount: cache.entryCount,
      stats: {
        hits: cache.stats?.hits || 0,
        misses: cache.stats?.misses || 0,
        sets: cache.stats?.sets || 0,
        updates: cache.stats?.updates || 0,
        clears: cache.stats?.clears || 0,
      },
      totalReads: cache.totalReads || 0,
      hitRate: cache.hitRate || 0,
      health: cache.health,
      keyInsights: (cache.keyInsights || []).slice(0, 4).map((item) => ({
        label: item.label,
        reads: item.reads,
        hits: item.hits,
        misses: item.misses,
        hitRate: item.hitRate,
      })),
      meta: cache.meta || null,
    })),
  }
}

function diffCacheSnapshots(before, after) {
  const beforeByName = new Map((before?.caches || []).map((cache) => [cache.name, cache]))
  return (after?.caches || [])
    .map((cache) => {
      const previous = beforeByName.get(cache.name)
      const hits = (cache.stats?.hits || 0) - (previous?.stats?.hits || 0)
      const misses = (cache.stats?.misses || 0) - (previous?.stats?.misses || 0)
      const clears = (cache.stats?.clears || 0) - (previous?.stats?.clears || 0)
      const reads = hits + misses
      return {
        name: cache.name,
        entryCount: cache.entryCount,
        hits,
        misses,
        clears,
        reads,
        hitRate: reads > 0 ? Math.round((hits / reads) * 1000) / 10 : null,
      }
    })
    .filter((cache) => cache.reads > 0 || cache.clears > 0)
    .sort((a, b) => b.reads - a.reads || b.misses - a.misses || a.name.localeCompare(b.name))
}

async function collectSnapshot(cdp, label) {
  const snapshot = await evaluate(cdp, `(() => {
    const active = [...document.querySelectorAll('.sidebar-item--active')]
      .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())[0] || null
    const hostCards = document.querySelectorAll('.host-card').length
    const hostRows = document.querySelectorAll('tbody tr').length
    const dataHostItems = document.querySelectorAll('[data-host-id]').length
    const hostConnectButtons = document.querySelectorAll('[data-host-connect-button]').length
    const hostDashboardButtons = document.querySelectorAll('[data-host-dashboard-button]').length
    const hostActionButtons = document.querySelectorAll('[data-host-actions-button]').length
    const hostActionMenus = document.querySelectorAll('.n-dropdown-menu').length
    const hostActionOptions = document.querySelectorAll('.n-dropdown-option').length
    const visibleButtons = [...document.querySelectorAll('button')]
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }).length
    const nodeCount = document.getElementsByTagName('*').length
    const perf = window.__hostsPerf || {}
    const longTasks = perf.longTasks || []
    const layoutShifts = perf.layoutShifts || []
    const memory = performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null
    return {
      label: ${JSON.stringify(label)},
      at: Math.round(performance.now()),
      active,
      hostCards,
      hostRows,
      dataHostItems,
      hostConnectButtons,
      hostDashboardButtons,
      hostActionButtons,
      hostActionMenus,
      hostActionOptions,
      visibleButtons,
      sidebarItems: document.querySelectorAll('.sidebar-item').length,
      inventoryTreeNodes: document.querySelectorAll('.inventory-sidebar-tree .n-tree-node').length,
      nCards: document.querySelectorAll('.n-card').length,
      nTooltips: document.querySelectorAll('.n-tooltip').length,
      nodeCount,
      mutationCount: perf.mutationCount || 0,
      longTaskCount: longTasks.length,
      longTaskTotalMs: Math.round(longTasks.reduce((total, item) => total + item.duration, 0)),
      longestLongTaskMs: Math.round(longTasks.reduce((max, item) => Math.max(max, item.duration), 0)),
      layoutShiftCount: layoutShifts.length,
      layoutShiftTotal: Number(layoutShifts.reduce((total, item) => total + item.value, 0).toFixed(4)),
      memory,
      cacheSnapshot: ${CACHE_DIAGNOSTICS ? `(window.__NODEACCESS_CACHE_DIAGNOSTICS__?.snapshot?.() ?? null)` : 'null'},
      bodyStart: document.body.innerText.slice(0, 260),
    }
  })()`)
  snapshot.cacheSnapshot = compactCacheSnapshot(snapshot.cacheSnapshot)
  return snapshot
}

async function measureClick(cdp, label, text) {
  const startEventIndex = cdp.events.length
  const before = await collectSnapshot(cdp, `${label}:before`)
  const started = Date.now()
  await evaluate(cdp, `(() => {
    window.__hostsPerf = window.__hostsPerf || {};
    window.__hostsPerf.measureStart = performance.now();
    window.__hostsPerf.mutationCount = 0;
    window.__hostsPerf.longTasks = [];
    window.__hostsPerf.layoutShifts = [];
  })()`)
  const result = await evaluate(cdp, `new Promise((resolve) => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const candidates = [...document.querySelectorAll('button, .sidebar-item, [role="button"], a, div')]
      .filter((el) => normalize(el.textContent).includes(${JSON.stringify(text)}))
      .map((el) => ({ el, rect: el.getBoundingClientRect(), text: normalize(el.textContent), className: String(el.className || '') }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0)
    const target = candidates.find((item) => item.className.includes('sidebar-item')) || candidates[0]
    if (!target) return resolve({ clicked: false, reason: 'target-not-found', text: ${JSON.stringify(text)} })
    target.el.click()
    const clickedAt = performance.now()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = [...document.querySelectorAll('.sidebar-item--active')]
        .map((el) => normalize(el.textContent))
        .find((value) => value.includes(${JSON.stringify(text)})) || null
      resolve({
        clicked: true,
        clickedAt,
        settledAt: performance.now(),
        active,
        bodyStart: document.body.innerText.slice(0, 260),
        hostCards: document.querySelectorAll('.host-card').length,
        hostRows: document.querySelectorAll('tbody tr').length,
        dataHostItems: document.querySelectorAll('[data-host-id]').length,
      })
    }))
  })`)
  const afterTwoFrames = await collectSnapshot(cdp, `${label}:after-two-frames`)
  await new Promise((resolve) => setTimeout(resolve, POST_CLICK_WAIT_MS))
  const afterWait = await collectSnapshot(cdp, `${label}:after-${POST_CLICK_WAIT_MS}ms`)
  const finished = Date.now()
  const events = cdp.events.slice(startEventIndex)
  const network = summarizeNetwork(events)
  return {
    label,
    clicked: result.clicked,
    active: result.active,
    frameSettleMs: result.clicked ? Math.round(result.settledAt - result.clickedAt) : null,
    observationMs: finished - started,
    network,
    snapshots: {
      before,
      afterTwoFrames,
      afterWait,
    },
    deltas: {
      nodeCount: afterWait.nodeCount - before.nodeCount,
      hostCards: afterWait.hostCards - before.hostCards,
      hostRows: afterWait.hostRows - before.hostRows,
      dataHostItems: afterWait.dataHostItems - before.dataHostItems,
      mutationCount: afterWait.mutationCount,
      longTaskCount: afterWait.longTaskCount,
      longTaskTotalMs: afterWait.longTaskTotalMs,
      layoutShiftTotal: afterWait.layoutShiftTotal,
      caches: diffCacheSnapshots(before.cacheSnapshot, afterWait.cacheSnapshot),
    },
    bodyStart: result.bodyStart,
    hostCards: result.hostCards,
    hostRows: result.hostRows,
    dataHostItems: result.dataHostItems,
  }
}

async function measureHostActionMenu(cdp, label) {
  const before = await collectSnapshot(cdp, `${label}:before`)
  const opened = await evaluate(cdp, `new Promise((resolve) => {
    const connectButtons = [...document.querySelectorAll('[data-host-connect-button]')]
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }).length
    const dashboardButtons = [...document.querySelectorAll('[data-host-dashboard-button]')]
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }).length
    const button = [...document.querySelectorAll('[data-host-actions-button]')]
      .find((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
    if (!button) {
      return resolve({
        clicked: false,
        reason: 'menu-not-available',
        connectButtons,
        dashboardButtons,
      })
    }
    button.click()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const options = [...document.querySelectorAll('.n-dropdown-option')]
        .filter((el) => {
          const rect = el.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
      resolve({
        clicked: true,
        optionCount: options.length,
        options,
        menuCount: document.querySelectorAll('.n-dropdown-menu').length,
        buttonCount: document.querySelectorAll('[data-host-actions-button]').length,
        connectButtons,
        dashboardButtons,
      })
    }))
  })`)
  const afterOpen = await collectSnapshot(cdp, `${label}:after-open`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: 8, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: 8, button: 'left', clickCount: 1 })
  const closed = await evaluate(cdp, `new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({
        menuCount: document.querySelectorAll('.n-dropdown-menu').length,
        optionCount: document.querySelectorAll('.n-dropdown-option').length,
      })
    }))
  })`)
  const afterClose = await collectSnapshot(cdp, `${label}:after-close`)
  return {
    label,
    before,
    opened,
    afterOpen,
    closed,
    afterClose,
    ok: opened.clicked === true
      ? opened.menuCount === 1 && opened.optionCount >= 1 && closed.menuCount === 0
      : opened.reason === 'menu-not-available' && opened.connectButtons > 0,
  }
}

async function collectPresenceSnapshot(cdp, label) {
  return evaluate(cdp, `(() => {
    const panel = document.querySelector('[data-open-sessions-panel="true"]')
    const openSessionCards = [...document.querySelectorAll('[data-open-session-host-id]')]
      .map((el) => Number(el.getAttribute('data-open-session-host-id')))
      .filter((value) => Number.isInteger(value))
    const presencePills = [...document.querySelectorAll('[data-host-presence-pill="true"]')]
      .map((el) => ({
        activeSessions: Number(el.getAttribute('data-active-sessions') || '0'),
        uniqueUsers: Number(el.getAttribute('data-unique-users') || '0'),
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
      }))
    return {
      label: ${JSON.stringify(label)},
      panelVisible: !!panel,
      openSessionCards,
      presencePills,
      maxActiveSessions: presencePills.reduce((max, item) => Math.max(max, item.activeSessions), 0),
      maxUniqueUsers: presencePills.reduce((max, item) => Math.max(max, item.uniqueUsers), 0),
      bodyIncludesOpenSessions: document.body.innerText.includes('Sessões abertas') || document.body.innerText.includes('Open sessions'),
    }
  })()`)
}

async function runPresenceResilienceScenario(cdp) {
  const state = {
    mode: 'ok',
    calls: 0,
    payload: null,
  }
  await installAccessMapMock(cdp, state)

  const query = new URLSearchParams({
    cdp_perf: String(Date.now()),
    presence_resilience: '1',
  })
  await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?${query.toString()}` })
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await waitFor(cdp, `document.body.innerText.includes('Recentes') || document.body.innerText.includes('Recent')`, 15000)
  await waitFor(cdp, `typeof window.__nodeAccessHostsPerf?.addOpenSession === 'function'`, 8000)

  const seeded = await evaluate(cdp, `(() => {
    return window.__nodeAccessHostsPerf?.addOpenSession() ?? null
  })()`)
  if (!seeded?.hostId) {
    throw new Error('presence resilience: could not seed open terminal session')
  }
  const refreshPresence = () =>
    evaluate(cdp, `window.__nodeAccessHostsPerf?.refreshAccessPresence?.().catch(() => null) ?? null`)
  const dispatchPresenceEvent = (action) => {
    const detail = {
      tenantId: TENANT_ID,
      hostId: seeded.hostId,
      sessionId: 8000,
      userId: Number(ADMIN_USER_ID),
      action,
      changedAt: new Date().toISOString(),
    }
    return evaluate(cdp, `window.dispatchEvent(new CustomEvent('nodeaccess:session-presence-changed', { detail: ${JSON.stringify(detail)} }))`)
  }
  const refreshPresenceAndWaitForRequest = async () => {
    const before = state.calls
    await refreshPresence()
    const start = Date.now()
    while (Date.now() - start < 7000) {
      if (state.calls > before) return true
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return false
  }

  state.payload = makeAccessMapPayload({
    host: {
      id: seeded.hostId,
      name: seeded.hostName || `Host #${seeded.hostId}`,
      ip: '127.0.0.1',
      port: 22,
      accessProtocol: 'ssh',
      scope: 'global',
    },
    activeSessions: 2,
    uniqueUsers: 2,
  })
  await dispatchPresenceEvent('started')
  await refreshPresenceAndWaitForRequest()
  await waitFor(cdp, `document.querySelector('[data-host-presence-pill="true"][data-active-sessions="2"][data-unique-users="2"]') !== null`, 8000)
  const concurrent = await collectPresenceSnapshot(cdp, 'presence:concurrent')

  state.mode = 'fail'
  await dispatchPresenceEvent('timeout')
  await refreshPresenceAndWaitForRequest()
  await waitFor(cdp, `document.querySelectorAll('[data-host-presence-pill="true"]').length === 0`, 8000)
  const failed = await collectPresenceSnapshot(cdp, 'presence:access-map-failed')

  state.mode = 'ok'
  state.payload = makeAccessMapPayload({
    host: {
      id: seeded.hostId,
      name: seeded.hostName || `Host #${seeded.hostId}`,
      ip: '127.0.0.1',
      port: 22,
      accessProtocol: 'ssh',
      scope: 'global',
    },
    activeSessions: 2,
    uniqueUsers: 2,
  })
  await dispatchPresenceEvent('reconnected')
  await refreshPresenceAndWaitForRequest()
  await waitFor(cdp, `document.querySelector('[data-host-presence-pill="true"][data-active-sessions="2"][data-unique-users="2"]') !== null`, 8000)
  const recovered = await collectPresenceSnapshot(cdp, 'presence:recovered')

  state.payload = makeAccessMapPayload({
    host: {
      id: seeded.hostId,
      name: seeded.hostName || `Host #${seeded.hostId}`,
      ip: '127.0.0.1',
      port: 22,
      accessProtocol: 'ssh',
      scope: 'global',
    },
    activeSessions: 0,
    uniqueUsers: 0,
  })
  await dispatchPresenceEvent('ended')
  await refreshPresenceAndWaitForRequest()
  await waitFor(cdp, `document.querySelectorAll('[data-host-presence-pill="true"]').length === 0`, 8000)
  const remoteEnded = await collectPresenceSnapshot(cdp, 'presence:remote-ended')

  await evaluate(cdp, `window.__nodeAccessHostsPerf?.clearOpenSessions?.() ?? null`)
  await waitFor(cdp, `document.querySelector('[data-open-sessions-panel="true"]') === null`, 8000)
  const localClosed = await collectPresenceSnapshot(cdp, 'presence:local-closed')

  return {
    seeded,
    accessMapCalls: state.calls,
    snapshots: { concurrent, failed, recovered, remoteEnded, localClosed },
    ok: concurrent.panelVisible
      && concurrent.maxActiveSessions >= 2
      && concurrent.maxUniqueUsers >= 2
      && failed.panelVisible
      && failed.presencePills.length === 0
      && recovered.panelVisible
      && recovered.maxActiveSessions >= 2
      && remoteEnded.panelVisible
      && remoteEnded.presencePills.length === 0
      && !localClosed.panelVisible,
  }
}

async function runStartupSnippetFormScenario(cdp) {
  const query = new URLSearchParams({
    cdp_perf: String(Date.now()),
  })
  await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?${query.toString()}` })
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await waitFor(cdp, `document.body.innerText.includes('Recentes') || document.body.innerText.includes('Recent')`, 15000)
  await waitFor(cdp, `typeof window.__nodeAccessHostsPerf?.openCreateHostForm === 'function'`, 8000)

  const opened = await evaluate(cdp, `new Promise((resolve) => {
    Promise.resolve(window.__nodeAccessHostsPerf.openCreateHostForm())
      .then((result) => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({
        ok: !!document.querySelector('.n-modal, [role="dialog"]') && result?.visible === true,
        hookResult: result,
        modalText: document.body.innerText.slice(0, 400),
      })
    })))
      .catch((error) => resolve({ ok: false, reason: String(error) }))
  })`)
  if (!opened.ok) return { ok: false, opened }

  await waitFor(cdp, `document.body.innerText.includes('Acesso e organização') || document.body.innerText.includes('Access and organization')`, 8000)
  const expanded = await evaluate(cdp, `new Promise((resolve) => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const headerCandidates = [...document.querySelectorAll('.n-collapse-item__header')]
      .find((el) => {
        const rect = el.getBoundingClientRect()
        const text = normalize(el.textContent)
        return rect.width > 0 && rect.height > 0 && (text.includes('Acesso e organização') || text.includes('Access and organization'))
      })
    const header = headerCandidates || [...document.querySelectorAll('[role="button"], button')]
      .find((el) => {
        const rect = el.getBoundingClientRect()
        const text = normalize(el.textContent)
        return rect.width > 0 && rect.height > 0 && (text.includes('Acesso e organização') || text.includes('Access and organization'))
      })
    if (!header) return resolve({ ok: false, reason: 'organization-section-not-found' })
    header.click()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const section = document.querySelector('[data-host-startup-snippet-section="true"]')
      const mode = document.querySelector('[data-host-startup-snippet-mode="true"]')
      const select = document.querySelector('[data-host-startup-snippet-select="true"]')
      const sectionRect = section?.getBoundingClientRect()
      const modeRect = mode?.getBoundingClientRect()
      const selectRect = select?.getBoundingClientRect()
      const visible = (rect) => !!rect && rect.width >= 120 && rect.height >= 22
      resolve({
        ok: !!section && visible(sectionRect) && visible(modeRect) && visible(selectRect),
        sectionRect: sectionRect ? { width: Math.round(sectionRect.width), height: Math.round(sectionRect.height), top: Math.round(sectionRect.top) } : null,
        modeRect: modeRect ? { width: Math.round(modeRect.width), height: Math.round(modeRect.height), top: Math.round(modeRect.top) } : null,
        selectRect: selectRect ? { width: Math.round(selectRect.width), height: Math.round(selectRect.height), top: Math.round(selectRect.top) } : null,
        text: section ? normalize(section.textContent) : null,
        hasMode: !!mode,
        hasSelect: !!select,
      })
    }))
  })`)

  const visual = await evaluate(cdp, `(() => {
    const section = document.querySelector('[data-host-startup-snippet-section="true"]')
    if (!section) return { ok: false, reason: 'section-not-rendered' }
    const rect = section.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const clipped = rect.left < 0 || rect.right > viewportWidth || rect.width < 260
    const controls = [...section.querySelectorAll('[data-host-startup-snippet-mode="true"], [data-host-startup-snippet-select="true"]')]
      .map((el) => {
        const itemRect = el.getBoundingClientRect()
        return {
          width: Math.round(itemRect.width),
          height: Math.round(itemRect.height),
          clipped: itemRect.left < rect.left - 1 || itemRect.right > rect.right + 1,
        }
      })
    return {
      ok: !clipped && controls.length === 2 && controls.every((item) => item.width >= 120 && item.height >= 22 && !item.clipped),
      section: { width: Math.round(rect.width), height: Math.round(rect.height), left: Math.round(rect.left), right: Math.round(rect.right) },
      controls,
      clipped,
    }
  })()`)

  const protocolRules = await evaluate(cdp, `new Promise((resolve) => {
    const afterFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn))
    const hasStartupSection = () => !!document.querySelector('[data-host-startup-snippet-section="true"]')
    const state = () => window.__nodeAccessHostsPerf?.startupSnippetFormState?.() ?? null
    const setProtocol = (protocol) => Promise.resolve(window.__nodeAccessHostsPerf.setCreateHostProtocol(protocol))
    const setStartup = (id, mode) => Promise.resolve(window.__nodeAccessHostsPerf.setStartupSnippetFormValue(id, mode))
    ;(async () => {
      if (typeof window.__nodeAccessHostsPerf?.setCreateHostProtocol !== 'function') {
        resolve({ ok: false, reason: 'setCreateHostProtocol-hook-missing' })
        return
      }
      if (typeof window.__nodeAccessHostsPerf?.setStartupSnippetFormValue !== 'function') {
        resolve({ ok: false, reason: 'setStartupSnippetFormValue-hook-missing' })
        return
      }
      await setProtocol('ssh')
      await new Promise(afterFrame)
      const ssh = { state: state(), sectionVisible: hasStartupSection() }
      await setStartup(123, 'suggest')
      await setProtocol('rdp')
      await new Promise(afterFrame)
      const rdp = { state: state(), sectionVisible: hasStartupSection() }
      await setProtocol('vnc')
      await new Promise(afterFrame)
      const vnc = { state: state(), sectionVisible: hasStartupSection() }
      await setProtocol('telnet')
      await new Promise(afterFrame)
      const telnet = { state: state(), sectionVisible: hasStartupSection() }
      resolve({
        ok: ssh.sectionVisible
          && telnet.sectionVisible
          && !rdp.sectionVisible
          && !vnc.sectionVisible
          && rdp.state?.startupSnippetMode === 'disabled'
          && rdp.state?.startupSnippetId === null
          && vnc.state?.startupSnippetMode === 'disabled'
          && vnc.state?.startupSnippetId === null,
        ssh,
        rdp,
        vnc,
        telnet,
      })
    })().catch((error) => resolve({ ok: false, reason: String(error) }))
  })`)

  return {
    ok: opened.ok && expanded.ok && visual.ok && protocolRules.ok,
    opened,
    expanded,
    visual,
    protocolRules,
  }
}

async function runScenario(cdp, mode) {
  const query = new URLSearchParams({
    cdp_perf: String(Date.now()),
  })
  if (mode && mode !== 'normal') query.set('perfMode', mode)

  cdp.events.length = 0
  const navStart = Date.now()
  await cdp.send('Page.navigate', { url: `${FRONTEND}/hosts?${query.toString()}` })
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Hosts')`, 15000)
  await waitFor(cdp, `document.body.innerText.includes('Recentes') || document.body.innerText.includes('Recent')`, 15000)
  if (PERF_CARD_PAGE_SIZE === 12 || PERF_CARD_PAGE_SIZE === 24) {
    await waitFor(cdp, `window.__nodeAccessHostsPerf?.setCardPageSize`, 15000)
    await evaluate(cdp, `window.__nodeAccessHostsPerf.setCardPageSize(${PERF_CARD_PAGE_SIZE})`)
  }
  await evaluate(cdp, `(() => {
    if (!window.__hostsPerfMutationObserver && document.body) {
      window.__hostsPerfMutationObserver = new MutationObserver((mutations) => {
        window.__hostsPerf = window.__hostsPerf || {};
        window.__hostsPerf.mutationCount = (window.__hostsPerf.mutationCount || 0) + mutations.length;
      });
      window.__hostsPerfMutationObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: false,
      });
    }
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const navMs = Date.now() - navStart

  const initial = {
    ...(await collectSnapshot(cdp, `${mode}:initial`)),
    href: await evaluate(cdp, 'location.href'),
    recentStorage: await evaluate(cdp, "localStorage.getItem('na_hosts_recents')"),
  }

  const bodyText = initial.bodyStart
  const recentLabel = bodyText.includes('Recentes') ? 'Recentes' : 'Recent'
  const allLabel = bodyText.includes('Todos os hosts') ? 'Todos os hosts' : 'All hosts'
  const measures = [
    await measureClick(cdp, `${mode}:all-to-recent`, recentLabel),
    await measureClick(cdp, `${mode}:recent-to-all`, allLabel),
    await measureClick(cdp, `${mode}:all-to-recent-warm`, recentLabel),
    await measureClick(cdp, `${mode}:recent-to-all-warm`, allLabel),
  ]
  const actionChecks = [
    await measureHostActionMenu(cdp, `${mode}:host-action-menu`),
  ]

  const perf = await evaluate(cdp, `(() => {
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/api/'))
      .map((entry) => ({
        name: entry.name.replace(location.origin, ''),
        duration: Math.round(entry.duration),
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
      }))
      .slice(-40)
    return {
      resources,
      errors: window.__hostsPerfErrors || []
    }
  })()`)

  return {
    mode,
    navMs,
    initial,
    measures,
    actionChecks,
    cacheSummary: summarizeCacheSnapshot(initial.cacheSnapshot),
    apiSummary: summarizeApiCalls(measures),
    apiResources: perf.resources,
    browserErrors: perf.errors,
  }
}

function summarizeScenario(scenario) {
  const recentToAllWarm = scenario.measures.find((item) => item.label.endsWith(':recent-to-all-warm'))
  const allToRecentWarm = scenario.measures.find((item) => item.label.endsWith(':all-to-recent-warm'))
  return {
    mode: scenario.mode,
    navMs: scenario.navMs,
    initialNodeCount: scenario.initial.nodeCount,
    recentToAllWarmFrameSettleMs: recentToAllWarm?.frameSettleMs ?? null,
    recentToAllWarmLongTaskTotalMs: recentToAllWarm?.deltas?.longTaskTotalMs ?? null,
    recentToAllWarmNodeDelta: recentToAllWarm?.deltas?.nodeCount ?? null,
    recentToAllWarmNodeCount: recentToAllWarm?.snapshots?.afterWait?.nodeCount ?? null,
    allToRecentWarmLongTaskTotalMs: allToRecentWarm?.deltas?.longTaskTotalMs ?? null,
    allToRecentWarmNodeCount: allToRecentWarm?.snapshots?.afterWait?.nodeCount ?? null,
    hostActionMenuOk: scenario.actionChecks?.every((item) => item.ok) ?? null,
    warmCacheDeltas: recentToAllWarm?.deltas?.caches || [],
  }
}

async function main() {
  const targets = await getJson(`${CDP_BASE}/json/list`)
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP page target found at ${CDP_BASE}`)

  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const token = signJwt({
    sub: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: TENANT_ID,
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
  }, readJwtSecret())

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__hostsPerfErrors = [];
      window.__hostsPerf = {
        longTasks: [],
        layoutShifts: [],
        mutationCount: 0,
      };
      try {
        new PerformanceObserver((list) => {
          window.__hostsPerf.longTasks.push(...list.getEntries().map((entry) => ({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          })).slice(-100));
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      try {
        new PerformanceObserver((list) => {
          window.__hostsPerf.layoutShifts.push(...list.getEntries()
            .filter((entry) => !entry.hadRecentInput)
            .map((entry) => ({
              startTime: entry.startTime,
              value: entry.value,
            })).slice(-100));
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      window.addEventListener('error', (event) => {
        window.__hostsPerfErrors.push({ type: 'error', message: event.message, source: event.filename, line: event.lineno });
      });
      window.addEventListener('unhandledrejection', (event) => {
        window.__hostsPerfErrors.push({ type: 'unhandledrejection', reason: String(event.reason) });
      });
      localStorage.setItem('na_access_token', ${JSON.stringify(token)});
      localStorage.setItem('na_refresh_token', 'cdp-dev-refresh-placeholder');
      localStorage.setItem('na_hosts_recents', ${JSON.stringify(JSON.stringify(recentIds))});
      localStorage.setItem('na_hosts_favorites', ${JSON.stringify(JSON.stringify(recentIds.slice(0, 3)))});
      localStorage.setItem('na_hosts_display_mode', 'list');
      localStorage.setItem('na_hosts_default_view', 'all');
    `,
  })

  const scenarios = []
  for (const mode of PERF_MODES) {
    scenarios.push(await runScenario(cdp, mode))
  }
  let presenceResilience = null
  if (PRESENCE_RESILIENCE_CHECK) {
    try {
      presenceResilience = await runPresenceResilienceScenario(cdp)
    } catch (error) {
      presenceResilience = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  let startupSnippetForm = null
  if (STARTUP_SNIPPET_FORM_CHECK) {
    try {
      startupSnippetForm = await runStartupSnippetFormScenario(cdp)
    } catch (error) {
      startupSnippetForm = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .slice(-20)

  const report = {
    frontend: FRONTEND,
    cdpBase: CDP_BASE,
    modes: PERF_MODES,
    cacheDiagnostics: CACHE_DIAGNOSTICS,
    summary: scenarios.map(summarizeScenario),
    apiSummary: scenarios.flatMap((scenario) => scenario.apiSummary || []),
    presenceResilienceOk: presenceResilience?.ok ?? null,
    presenceResilience,
    startupSnippetFormOk: startupSnippetForm?.ok ?? null,
    startupSnippetForm,
    scenarios,
    consoleErrors,
  }
  const output = JSON.stringify(report, null, 2)
  if (process.env.REPORT_PATH) {
    fs.mkdirSync(path.dirname(process.env.REPORT_PATH), { recursive: true })
    fs.writeFileSync(process.env.REPORT_PATH, `${output}\n`)
  }
  console.log(output)
  cdp.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
