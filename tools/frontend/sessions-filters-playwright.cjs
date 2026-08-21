#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-sessions-filters.json'
const users = [
  { id: 1, name: 'Ana Admin', email: 'ana@example.test' },
  { id: 2, name: 'Bruno Operador', email: 'bruno@example.test' },
  { id: 3, name: 'Carla Suporte', email: 'carla@example.test' },
]
const sessions = Array.from({ length: 66 }, (_, index) => {
  const user = users[index % users.length]
  const startedAt = new Date(Date.UTC(2026, 7, 18, 14, index)).toISOString()
  const endedAt = index % 4 === 0 ? null : new Date(Date.UTC(2026, 7, 18, 14, index + 2)).toISOString()
  return {
    id: 1000 + index, user, host: { id: 200 + (index % 5), name: `host-${String(65 - index).padStart(2, '0')}`, ip: `10.0.0.${index + 1}`, deleted: false, deletedAt: null },
    startedAt, endedAt, durationSeconds: endedAt ? 120 : null, active: endedAt === null,
    requestedConnectionMode: 'direct', connectionMethod: index % 2 ? 'direct' : 'user_agent', agentId: null,
    agentNameSnapshot: null, agentSource: null, clientIp: '127.0.0.1', userAgent: 'Playwright', accessType: 'authenticated',
    jitLinkId: null, jitGuestName: null, agentRemoteIp: null, endedReason: endedAt ? 'socket_closed' : null, errorCode: null, errorMessage: null,
  }
})

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', userId: 1, tenantId: 7, role: 'admin', name: 'Ana Admin', email: 'ana@example.test', stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

function sortedRows(url) {
  const params = url.searchParams
  const userId = Number(params.get('userId')) || null
  const sortBy = params.get('sortBy') || 'startedAt'
  const direction = params.get('sortDirection') === 'asc' ? 1 : -1
  const page = Number(params.get('page')) || 1
  const limit = Number(params.get('limit')) || 20
  const value = (row) => ({
    user: row.user.name, host: row.host.name, startedAt: row.startedAt, endedAt: row.endedAt || '',
    duration: row.durationSeconds ?? Number.MAX_SAFE_INTEGER, connectionMethod: row.connectionMethod, active: Number(row.active),
  })[sortBy]
  const filtered = sessions.filter((row) => !userId || row.user.id === userId)
  filtered.sort((a, b) => {
    const left = value(a); const right = value(b)
    const compared = typeof left === 'string' ? left.localeCompare(right) : left - right
    return compared === 0 ? b.id - a.id : compared * direction
  })
  return { data: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, limit }
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const requests = []
  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'sessions-filter-harness')
    window.__sessionsHarness = { errors: [], shifts: [], longTasks: [] }
    addEventListener('error', (event) => window.__sessionsHarness.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__sessionsHarness.errors.push(String(event.reason)))
    try {
      new PerformanceObserver((list) => window.__sessionsHarness.shifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value))).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((list) => window.__sessionsHarness.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true })
    } catch {}
  }, token())
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let body = {}
    if (url.pathname === '/api/v1/sessions/filter-options') body = { users }
    else if (url.pathname === '/api/v1/sessions') {
      requests.push(Object.fromEntries(url.searchParams))
      body = sortedRows(url)
    } else if (url.pathname === '/api/v1/features') body = {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${FRONTEND}/admin/reports/sessions?sessionsHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-sessions-table="true"]').waitFor()
  await page.getByText('Carla Suporte', { exact: true }).first().waitFor()
  if (requests[0]?.sortBy !== 'startedAt' || requests[0]?.sortDirection !== 'desc') throw new Error(`Ordenação inicial incorreta: ${JSON.stringify(requests[0])}`)

  const userFilter = page.locator('[data-session-user-filter="true"]')
  await userFilter.click()
  await page.getByText('Bruno Operador — bruno@example.test', { exact: true }).click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('userId') === '2')
  const table = page.locator('[data-sessions-table="true"]')
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-sessions-table="true"]')?.textContent || ''
    return text.includes('Bruno Operador') && !text.includes('Ana Admin') && !text.includes('Carla Suporte')
  })
  if (await table.getByText('Ana Admin', { exact: true }).count()) throw new Error('Filtro de usuário misturou sessões de outro usuário')
  if (requests.at(-1)?.userId !== '2') throw new Error(`userId não chegou ao backend: ${JSON.stringify(requests.at(-1))}`)

  const userHeader = page.getByRole('columnheader', { name: /Usuário|User/ })
  await userHeader.click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('sortBy') === 'user')
  const firstUserDirection = requests.at(-1)?.sortDirection
  if (requests.at(-1)?.sortBy !== 'user' || !['asc', 'desc'].includes(firstUserDirection)) throw new Error(`Ordenação remota por usuário falhou: ${JSON.stringify(requests.at(-1))}`)
  await userHeader.click()
  await page.waitForFunction((previous) => new URL(location.href).searchParams.get('sortDirection') !== previous, firstUserDirection)
  if (requests.at(-1)?.sortDirection === firstUserDirection) throw new Error('Segundo clique não inverteu a ordenação')

  // Limpa o filtro por teclado e valida que a paginação opera sobre o resultado global ordenado.
  await userFilter.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  await page.getByRole('columnheader', { name: /Início|Start/ }).click()
  await page.waitForTimeout(100)

  await page.evaluate(() => { window.__sessionsHarness.longTasks = []; window.__sessionsHarness.shifts = [] })
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  for (const header of [/Host/, /Duração|Duration/, /Rota|Route/, /Status/, /Início|Start/]) {
    await page.getByRole('columnheader', { name: header }).click()
  }
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(200)
  const filterGeometry = await page.locator('.sessions-filter-bar').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, viewport: innerWidth }))
  if (filterGeometry.scrollWidth > filterGeometry.clientWidth + 2) throw new Error(`Filtros criaram overflow mobile: ${JSON.stringify(filterGeometry)}`)
  const runtime = await page.evaluate(() => ({ errors: window.__sessionsHarness.errors, cls: window.__sessionsHarness.shifts.reduce((sum, value) => sum + value, 0), longestTaskMs: Math.max(0, ...window.__sessionsHarness.longTasks), nodes: document.querySelectorAll('*').length }))
  if (runtime.errors.length || runtime.cls > 0.1 || runtime.longestTaskMs > 250 || runtime.nodes > 12000) throw new Error(`Budget/runtime inválido: ${JSON.stringify(runtime)}`)
  const performance = { taskDurationMs: Math.round(((after.TaskDuration || 0) - (before.TaskDuration || 0)) * 1000), layoutDurationMs: Math.round(((after.LayoutDuration || 0) - (before.LayoutDuration || 0)) * 1000), ...runtime }
  const report = { ok: true, users: users.length, sessions: sessions.length, requests: requests.length, serverSideSorting: true, stablePagination: true, keyboard: true, responsive: filterGeometry, performance }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await context.close()
  await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
