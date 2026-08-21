#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-snippets-page.json'
const BUDGETS = { taskDurationMs: 2500, scriptDurationMs: 700, layoutDurationMs: 350, longestTaskMs: 200, cumulativeLayoutShift: 0.1, liveDomNodes: 12000 }

const groups = [{ id: 10, name: 'Operação', description: null, scope: 'TEAM', createdById: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z' }]
const snippets = [
  { id: 1, name: 'Status nginx', command: 'systemctl status nginx', description: null, scope: 'TEAM', groupId: 10, group: { id: 10, name: 'Operação', scope: 'TEAM' }, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', createdBy: { id: 1, name: 'Admin' } },
  { id: 2, name: 'Grupo legado visível', command: 'uptime', description: null, scope: 'TEAM', groupId: 99, group: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', createdBy: { id: 1, name: 'Admin' } },
  { id: 3, name: 'Sem agrupamento', command: 'hostname', description: null, scope: 'PERSONAL', groupId: null, group: null, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z', createdBy: { id: 1, name: 'Admin' } },
]

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', stage: 'authenticated', iat: now, exp: now + 3600 })}.harness`
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'snippets-harness-refresh')
    localStorage.removeItem('nodeaccess:snippets-view-mode')
    window.__snippetsHarness = { errors: [], longTasks: [], layoutShifts: [] }
    addEventListener('error', (event) => window.__snippetsHarness.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__snippetsHarness.errors.push(String(event.reason)))
    try {
      new PerformanceObserver((list) => window.__snippetsHarness.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true })
      new PerformanceObserver((list) => window.__snippetsHarness.layoutShifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value))).observe({ type: 'layout-shift', buffered: true })
    } catch {}
  }, fakeJwt())

  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/v1/features') body = { snippetsLicensed: true }
    else if (path === '/api/v1/snippets') body = snippets
    else if (path === '/api/v1/snippet-groups') body = groups
    else if (path === '/api/v1/secrets') body = []
    else if (path.includes('/preferences')) body = null
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${FRONTEND}/snippets?snippetsHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: /Snippets/ }).waitFor()
  await page.getByText('Status nginx', { exact: true }).waitFor()

  const newGroupButton = page.getByRole('button', { name: /Novo grupo|New group/ })
  const newGroupText = (await newGroupButton.textContent()).replace(/\s+/g, ' ').trim()
  if (!/^\+ (Novo grupo|New group)$/.test(newGroupText)) throw new Error(`Microcopy duplicada no botão de grupo: ${newGroupText}`)

  const flatButton = page.locator('[data-snippet-view="flat"]')
  const groupedButton = page.locator('[data-snippet-view="grouped"]')
  if (await flatButton.getAttribute('title') || await groupedButton.getAttribute('title')) throw new Error('Toggle ainda usa title nativo junto com NTooltip')
  if (await flatButton.getAttribute('aria-pressed') !== 'true' || await groupedButton.getAttribute('aria-pressed') !== 'false') throw new Error('Estado inicial do toggle não está acessível')

  await flatButton.hover()
  await page.waitForTimeout(500)
  let visibleTooltips = page.locator('.n-popover:not([style*="display: none"])').filter({ hasText: /Lista|List/ })
  if (await visibleTooltips.count() !== 1) throw new Error('Tooltip de lista não apareceu isoladamente')
  await groupedButton.hover()
  await page.waitForTimeout(500)
  visibleTooltips = page.locator('.n-popover:not([style*="display: none"])').filter({ hasText: /Grupos|Groups/ })
  if (await visibleTooltips.count() !== 1) throw new Error('Tooltip de grupos apresentou exibição duplicada')

  await groupedButton.focus()
  await groupedButton.press('Enter')
  if (await groupedButton.getAttribute('aria-pressed') !== 'true') throw new Error('Alternância para grupos falhou por teclado')
  for (const bucket of ['10', 'unavailable-99', 'ungrouped']) await page.locator(`[data-snippet-bucket="${bucket}"]`).waitFor()
  for (const name of snippets.map((item) => item.name)) await page.getByText(name, { exact: true }).waitFor()
  await page.getByText(/Grupo não disponível|Unavailable group/).waitFor()
  await page.getByText(/Sem acesso ou removido|No access or removed/).waitFor()

  await page.evaluate(() => { window.__snippetsHarness.longTasks = []; window.__snippetsHarness.layoutShifts = [] })
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  for (let index = 0; index < 30; index += 1) await (index % 2 === 0 ? flatButton : groupedButton).click()
  await groupedButton.click()
  await page.waitForTimeout(250)
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  const deltaMs = (name) => Math.round(((after[name] || 0) - (before[name] || 0)) * 1000)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(150)
  const responsive = await page.locator('.snippet-filter-panel').evaluate((panel) => ({ clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth, viewportWidth: innerWidth }))
  if (responsive.scrollWidth > responsive.clientWidth + 2) throw new Error(`Filtros criaram overflow horizontal no mobile: ${JSON.stringify(responsive)}`)

  const runtime = await page.evaluate(() => ({
    errors: window.__snippetsHarness.errors,
    longTasks: window.__snippetsHarness.longTasks,
    cumulativeLayoutShift: window.__snippetsHarness.layoutShifts.reduce((total, value) => total + value, 0),
    liveDomNodes: document.querySelectorAll('*').length,
  }))
  const performance = {
    taskDurationMs: deltaMs('TaskDuration'),
    scriptDurationMs: deltaMs('ScriptDuration'),
    layoutDurationMs: deltaMs('LayoutDuration'),
    layoutCount: Math.round((after.LayoutCount || 0) - (before.LayoutCount || 0)),
    recalcStyleCount: Math.round((after.RecalcStyleCount || 0) - (before.RecalcStyleCount || 0)),
    longestTaskMs: Math.round(Math.max(0, ...runtime.longTasks)),
    cumulativeLayoutShift: Math.round(runtime.cumulativeLayoutShift * 10_000) / 10_000,
    liveDomNodes: runtime.liveDomNodes,
  }
  const exceeded = Object.entries(BUDGETS).filter(([metric, budget]) => performance[metric] > budget)
  if (exceeded.length) throw new Error(`Budget de performance excedido: ${exceeded.map(([metric, budget]) => `${metric}=${performance[metric]} > ${budget}`).join(', ')}`)
  if (runtime.errors.length) throw new Error(`Erros no navegador: ${runtime.errors.join(' | ')}`)

  const report = { ok: true, snippets: snippets.length, buckets: 3, newGroupText, responsive, performance, budgets: BUDGETS, browserErrors: runtime.errors }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
