#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || null
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-session-playback-playwright.json'
const SESSION_ID = 4177

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', userId: 1, tenantId: 1, role: 'admin', isPlatformAdmin: true, email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const startedAt = '2026-08-13T12:00:00.000Z'
const detail = {
  sessionId: SESSION_ID, userId: 1, userNameSnapshot: 'Audit Admin', userEmailSnapshot: 'admin@example.test',
  hostId: 9, hostNameSnapshot: 'server-prod-01', hostIpSnapshot: '10.0.0.9', hostDeleted: false,
  status: 'COMPLETED', startedAt, endedAt: '2026-08-13T12:00:08.000Z', chunkCount: 1,
  bytesIn: 24, bytesOut: 180, connectionMethod: 'direct', clientIp: '127.0.0.1', agentRemoteIp: null,
  userAgent: 'playwright', aiSummaryStatus: 'NOT_REQUESTED', aiRiskLevel: null, criticalEvents: [],
  sharedSessionContext: null, routeSnapshot: null, ticketKey: null, ticketProvider: null, ticketUrl: null,
}
const events = [
  { seq: 1, type: 'session_started', timestamp: startedAt, bytes: null, text: '' },
  { seq: 2, type: 'stdout', timestamp: '2026-08-13T12:00:00.100Z', bytes: 18, text: '[admin@host ~]$ ' },
  { seq: 3, type: 'stdin', timestamp: '2026-08-13T12:00:01.000Z', bytes: 7, text: 'whoami\r' },
  { seq: 4, type: 'stdout', timestamp: '2026-08-13T12:00:01.100Z', bytes: 20, text: 'whoami\r\nadmin\r\n' },
  { seq: 5, type: 'stdin', timestamp: '2026-08-13T12:00:03.000Z', bytes: 12, text: 'systemctl status sshd\r' },
  { seq: 6, type: 'stdout', timestamp: '2026-08-13T12:00:03.300Z', bytes: 32, text: 'sshd.service - OpenSSH server\r\nActive: active\r\n' },
  { seq: 7, type: 'session_ended', timestamp: '2026-08-13T12:00:08.000Z', bytes: null, text: '' },
]
const commands = [
  { index: 1, command: 'whoami', output: 'admin', submittedAt: '2026-08-13T12:00:01.000Z', outputEndedAt: '2026-08-13T12:00:01.100Z', confidence: 'high', actorUserId: 1 },
  { index: 2, command: 'systemctl status sshd', output: 'sshd.service - OpenSSH server\nActive: active', submittedAt: '2026-08-13T12:00:03.000Z', outputEndedAt: '2026-08-13T12:00:03.300Z', confidence: 'high', actorUserId: 1 },
  { index: 3, command: 'vim notes.txt', output: '[interactive terminal output]', submittedAt: '2026-08-13T12:00:05.000Z', outputEndedAt: '2026-08-13T12:00:06.000Z', confidence: 'low', actorUserId: 1 },
]

async function installRoutes(context, options = {}) {
  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    if (options.detailFailure && pathname === `/api/v1/session-audit/${SESSION_ID}`) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fixture failure"}' })
    }
    let body = []
    if (pathname === `/api/v1/session-audit/${SESSION_ID}`) body = detail
    else if (pathname.endsWith('/preview')) body = options.events ?? events
    else if (pathname.endsWith('/commands')) body = options.commands ?? commands
    else if (pathname.endsWith('/command-stats')) body = { total: (options.commands ?? commands).length, participants: [] }
    else if (pathname === '/api/v1/settings') body = { license: { sessionAuditAiEnabled: false } }
    else if (pathname === '/api/v1/integrations/jira') body = { enabled: false, hasApiToken: false, healthStatus: 'unknown' }
    else if (pathname === '/api/v1/features') body = {}
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function authenticate(page) {
  await page.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'playwright-placeholder')
  }, fakeJwt())
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport })
  await installRoutes(context)
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await authenticate(page)
  console.log(`[playback] opening ${viewport.width}x${viewport.height}`)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('session-playback-panel')
  await panel.waitFor()
  console.log(`[playback] panel ready ${viewport.width}x${viewport.height}`)
  const terminal = page.locator('[data-playback-terminal="true"]')
  if (await terminal.getAttribute('data-playback-mode') !== 'clean') throw new Error('Playback did not start in clean mode')
  const timelineMarkers = page.locator('[data-playback-marker]')
  if (await timelineMarkers.count() < commands.length + 1) throw new Error('Playback timeline is missing audit markers')
  await timelineMarkers.nth(1).click()
  if (Number(await terminal.getAttribute('data-playback-cursor-index')) < 1) throw new Error('Timeline marker did not move playback cursor')
  await page.getByRole('checkbox', { name: /Mostrar horarios|Show timestamps/ }).click()
  await page.locator('[data-playback-action="load-end"]').click()
  if (!/#\d+\]/.test(await terminal.textContent())) throw new Error('Timestamp mode did not expose event correlation')
  await page.getByRole('checkbox', { name: /Mostrar bruto|Show raw/ }).click()
  if (await terminal.getAttribute('data-playback-mode') !== 'raw') throw new Error('Raw stream mode did not activate')
  await page.getByRole('checkbox', { name: /Mostrar bruto|Show raw/ }).click()
  if (await terminal.getAttribute('data-playback-mode') !== 'clean') throw new Error('Clean stream mode did not restore')
  await page.getByTestId('playback-speed').click()
  await page.getByText('4x', { exact: true }).last().click()
  if (!(await page.getByTestId('playback-speed').textContent()).includes('4x')) throw new Error('Playback speed did not change to 4x')
  if (await terminal.getAttribute('contenteditable')) throw new Error('Playback terminal became editable')
  await terminal.focus()
  await page.keyboard.type('must-not-enter')
  if ((await terminal.textContent()).includes('must-not-enter')) throw new Error('Playback accepted keyboard input')

  await page.locator('[data-playback-action="play"]').click()
  await page.waitForFunction(() => Number(document.querySelector('[data-playback-terminal]')?.getAttribute('data-playback-cursor-index')) > 0)
  const playedCursor = Number(await terminal.getAttribute('data-playback-cursor-index'))
  await page.locator('[data-playback-action="play"]').click()
  const pausedCursor = Number(await terminal.getAttribute('data-playback-cursor-index'))
  await page.waitForTimeout(250)
  if (Number(await terminal.getAttribute('data-playback-cursor-index')) !== pausedCursor) throw new Error('Pause did not freeze cursor')

  await page.locator('[data-playback-action="load-end"]').click()
  if ((await page.getByTestId('playback-progress').textContent()).trim() !== '100%') throw new Error('Load end did not reach 100%')
  const finalText = await terminal.textContent()
  if (!finalText.includes('whoami') || !finalText.includes('Active: active')) throw new Error('Final playback is inconsistent with command fixture')
  await page.locator('[data-playback-action="restart"]').click()
  if ((await page.getByTestId('playback-progress').textContent()).trim() !== '0%') throw new Error('Restart did not return to 0%')

  await page.locator('.n-tabs-tab').filter({ hasText: /Comandos|Commands/ }).click()
  const rows = page.locator('[data-audit-command-row="true"]')
  if (await rows.count() !== commands.length) throw new Error('Command list row count mismatch')
  if (await page.locator('[data-audit-command-row="true"][data-command-confidence="low"]').count() !== 1) throw new Error('Low-confidence command metadata is missing')
  const confidenceFilter = page.getByTestId('command-confidence-filter')
  await confidenceFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').last().click()
  if (await rows.count() !== 1 || await rows.first().getAttribute('data-command-confidence') !== 'low') throw new Error('Confidence filter did not isolate low-confidence commands')
  await confidenceFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').first().click()
  const categoryFilter = page.getByTestId('command-category-filter')
  await categoryFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').filter({ hasText: /Serviço|service/i }).click({ force: true })
  if (await rows.count() !== 1 || !(await rows.first().textContent()).includes('systemctl status sshd')) throw new Error('Category filter did not isolate service commands')
  await categoryFilter.click()
  await page.locator('.n-base-select-menu:visible .n-base-select-option').filter({ hasText: /Todas categorias|allCategories/i }).click({ force: true })
  const commandSearch = page.getByPlaceholder(/Filtrar por comando ou saída|Filter by command or output/)
  await commandSearch.fill('systemctl')
  if (await rows.count() !== 1) throw new Error('Command search did not narrow results')
  await page.evaluate(() => {
    window.__playbackExport = { blob: null, filename: null }
    const createObjectURL = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      window.__playbackExport.blob = blob
      return createObjectURL(blob)
    }
    document.addEventListener('click', (event) => {
      const anchor = event.target.closest?.('a[download]')
      if (anchor) window.__playbackExport.filename = anchor.download
    }, true)
  })
  await page.getByRole('button', { name: /Exportar CSV|Export CSV/ }).click()
  const exported = await page.evaluate(async () => ({
    filename: window.__playbackExport.filename,
    csv: await window.__playbackExport.blob?.text(),
  }))
  if (exported.filename !== `session-audit-${SESSION_ID}-commands.csv`) throw new Error('CSV export filename is inconsistent')
  const csv = exported.csv || ''
  if (!csv.includes('systemctl status sshd') || csv.includes('vim notes.txt')) throw new Error('Filtered CSV export does not match visible commands')
  await commandSearch.fill('')
  if (await rows.count() !== commands.length) throw new Error('Clearing command search did not restore results')
  await rows.nth(1).getByRole('button', { name: /Ver no playback|View in playback/ }).click()
  await panel.waitFor()
  if (!(await terminal.textContent()).includes('systemctl status sshd')) throw new Error('Command jump did not correlate playback')

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  if (dimensions.document > dimensions.viewport + 2) throw new Error(`Horizontal overflow: ${dimensions.document} > ${dimensions.viewport}`)
  if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
  const markerCount = await timelineMarkers.count()
  await context.close()
  return { name: `${viewport.width}x${viewport.height}`, playedCursor, commandRows: commands.length, timelineMarkers: markerCount, modes: ['clean', 'raw'], csvExport: true, horizontalOverflow: false }
}

async function runErrorState(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await installRoutes(context, { detailFailure: true })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('alert').waitFor()
  const exposed = (await page.locator('body').textContent()).includes('fixture failure')
  await context.close()
  if (exposed) throw new Error('Internal API detail leaked into public error state')
  return { publicError: true, internalDetailExposed: false }
}

async function runEmptyState(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await installRoutes(context, { events: [], commands: [] })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('session-playback-panel').waitFor()
  for (const action of ['play', 'restart', 'load-end']) {
    if (!(await page.locator(`[data-playback-action="${action}"]`).isDisabled())) throw new Error(`Empty playback action remained enabled: ${action}`)
  }
  await page.locator('.n-tabs-tab').filter({ hasText: /Comandos|Commands/ }).click()
  if (await page.locator('[data-audit-command-row="true"]').count()) throw new Error('Empty command list rendered rows')
  await context.close()
  return { playbackActionsDisabled: true, commandRows: 0 }
}

async function runTruncatedState(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const truncatedEvents = Array.from({ length: 5000 }, (_, index) => ({
    seq: index + 1,
    type: index === 0 ? 'session_started' : 'stdout',
    timestamp: new Date(Date.parse(startedAt) + index).toISOString(),
    bytes: 0,
    text: '',
  }))
  await installRoutes(context, { events: truncatedEvents, commands: [] })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  await authenticate(page)
  await page.goto(`${FRONTEND}/admin/session-audit/${SESSION_ID}?tab=playback`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('playback-truncated-warning').waitFor()
  const warning = (await page.getByTestId('playback-truncated-warning').textContent()).trim()
  if (!warning.includes('5000') && !warning.includes('5,000')) throw new Error('Truncation warning does not expose the event limit')
  await context.close()
  return { warningVisible: true, eventLimit: truncatedEvents.length }
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(EXECUTABLE_PATH ? { executablePath: EXECUTABLE_PATH } : {}) })
  const started = Date.now()
  try {
    const viewports = []
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) viewports.push(await runViewport(browser, viewport))
    const errorState = await runErrorState(browser)
    const emptyState = await runEmptyState(browser)
    const truncatedState = await runTruncatedState(browser)
    const report = { ok: true, runner: 'playwright', durationMs: Date.now() - started, fixtures: { events: events.length, commands: commands.length }, viewports, errorState, emptyState, truncatedState }
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, durationMs: report.durationMs, viewports: report.viewports }))
  } finally { await browser.close() }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1 })
