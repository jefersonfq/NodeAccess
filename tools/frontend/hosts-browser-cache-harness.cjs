#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const { assertLoopbackOrigin, comparePasses } = require('./hosts-browser-cache-lib.cjs')
const { parseEnv, signDevelopmentJwt } = require('./dev-warmup-lib.cjs')

const root = path.resolve(__dirname, '..', '..')
const frontend = assertLoopbackOrigin(process.env.FRONTEND_BASE || 'http://127.0.0.1:5173')
const envPath = process.env.BACKEND_ENV_PATH || path.join(root, 'apps/backend/.env')
const fileEnv = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {}
const secret = process.env.JWT_SECRET || fileEnv.JWT_SECRET
const reportPath = process.env.REPORT_PATH
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined)

async function waitForNetworkQuiet(pending, timeoutMs = 10000) {
  const started = Date.now()
  let quietSince = null
  while (Date.now() - started < timeoutMs) {
    if (pending.size === 0) {
      quietSince ||= Date.now()
      if (Date.now() - quietSince >= 300) return
    } else quietSince = null
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Rede não estabilizou; ${pending.size} requests pendentes`)
}

async function navigateToHosts(page, label, browserErrors, networkEvents, pending) {
  await waitForNetworkQuiet(pending)
  const browserErrorStart = browserErrors.length
  const networkStart = networkEvents.length
  await page.evaluate(() => {
    performance.clearResourceTimings()
    window.__naBrowserCache.longTasks = []
    window.__naBrowserCache.errors = []
  })
  const startedAt = Date.now()
  const hostsMenu = page.locator('.n-menu-item-content').filter({ hasText: /^Hosts$/ }).first()
  await hostsMenu.waitFor({ state: 'visible', timeout: 15000 })
  await hostsMenu.click()
  await page.waitForURL(url => url.pathname === '/hosts', { timeout: 15000 })
  await page.locator('.hosts-sidebar-panel').waitFor({ state: 'visible', timeout: 30000 })
  await page.getByText(/^(Todos os hosts|All hosts)$/, { exact: true }).first().click()
  await page.waitForFunction(() => {
    const items = document.querySelectorAll('[data-host-id]').length
    const spinVisible = Boolean(document.querySelector('.n-spin--show, .n-spin-container--loading'))
    return !spinVisible && items > 0
  }, null, { timeout: 30000 })
  await waitForNetworkQuiet(pending)
  await page.waitForTimeout(250)
  const snapshot = await page.evaluate(() => ({
    resources: performance.getEntriesByType('resource').map(entry => ({
      name: entry.name.replace(location.origin, ''),
      kind: entry.name.includes('/api/') ? 'api' : 'frontend',
      durationMs: Math.round(entry.duration),
      transferSize: entry.transferSize || 0,
      encodedBodySize: entry.encodedBodySize || 0,
    })),
    longTasks: window.__naBrowserCache.longTasks,
    errors: window.__naBrowserCache.errors,
    hostsShellVisible: Boolean(document.querySelector('.hosts-sidebar-panel')),
    hostCount: document.querySelectorAll('[data-host-id]').length,
    hostActionCount: document.querySelectorAll('[data-host-connect-button]').length,
  }))
  return {
    label, durationMs: Date.now() - startedAt, ...snapshot,
    errors: [...snapshot.errors, ...browserErrors.slice(browserErrorStart)],
    network: networkEvents.slice(networkStart),
  }
}

async function main() {
  const token = signDevelopmentJwt({
    sub: process.env.ADMIN_USER_ID || '1', email: process.env.ADMIN_EMAIL || 'admin@nodeaccess.local',
    role: 'admin', isPlatformAdmin: true, tenantId: Number(process.env.TENANT_ID || '1'),
    canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, stage: 'authenticated',
  }, secret)
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    const browserErrors = []
    const networkEvents = []
    const pending = new Set()
    const blockedMutations = []
    const interceptedRequests = new WeakSet()
    page.on('pageerror', error => browserErrors.push({ type: 'pageerror', message: error.message }))
    page.on('console', message => { if (message.type() === 'error') browserErrors.push({ type: 'console', message: message.text() }) })
    page.on('request', request => { if (request.url().startsWith(frontend)) pending.add(request) })
    page.on('requestfinished', request => pending.delete(request))
    page.on('requestfailed', request => pending.delete(request))
    page.on('response', response => {
      const request = response.request()
      if (request.url().startsWith(frontend)) networkEvents.push({ method: request.method(), status: response.status(), blocked: interceptedRequests.has(request), name: request.url().replace(frontend, '') })
    })
    await page.route(`${frontend}/api/v1/**`, async route => {
      const method = route.request().method()
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue()
      interceptedRequests.add(route.request())
      blockedMutations.push({ method, name: route.request().url().replace(frontend, '') })
      return route.fulfill({ status: 204, body: '' })
    })
    await page.addInitScript(({ accessToken }) => {
      localStorage.setItem('na_access_token', accessToken)
      localStorage.setItem('na_refresh_token', 'browser-cache-harness-placeholder')
      window.__naBrowserCache = { longTasks: [], errors: [] }
      try { new PerformanceObserver(list => window.__naBrowserCache.longTasks.push(...list.getEntries().map(item => ({ duration: item.duration })))).observe({ type: 'longtask', buffered: true }) } catch {}
      addEventListener('error', event => window.__naBrowserCache.errors.push({ type: 'error', message: event.message }))
      addEventListener('unhandledrejection', event => window.__naBrowserCache.errors.push({ type: 'unhandledrejection', message: String(event.reason) }))
    }, { accessToken: token })
    await page.goto(`${frontend}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(1000)
    const first = await navigateToHosts(page, 'first', browserErrors, networkEvents, pending)
    await page.goBack({ waitUntil: 'domcontentloaded' })
    await page.waitForURL(url => url.pathname === '/dashboard')
    const second = await navigateToHosts(page, 'second', browserErrors, networkEvents, pending)
    const report = { frontend, capturedAt: new Date().toISOString(), blockedMutations, comparison: comparePasses(first, second), passes: [first, second] }
    const output = JSON.stringify(report, null, 2)
    if (reportPath) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${output}\n`) }
    console.log(output)
    const unsafeRequests = [...first.network, ...second.network].filter(item => !['GET', 'HEAD', 'OPTIONS'].includes(item.method) && !item.blocked)
    if (first.errors.length || second.errors.length || unsafeRequests.length) process.exitCode = 1
  } finally { await browser.close() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
