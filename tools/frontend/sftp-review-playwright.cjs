#!/usr/bin/env node
// Fault-oriented user simulations; API mocks are explicit, not a real SFTP certification.
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5179'
const out = process.env.REPORT_DIR || '/tmp/nodeaccess-sftp-review-playwright'
const results = []
const settings = {
  tenant: { id: 1, name: 'Review', slug: 'review' },
  license: { maxUsers: 25, maxHosts: 20, activeUsers: 1, registeredHosts: 1, hasKey: true, multiConnect: false, sessionAuditEnabled: true, sessionAuditAiEnabled: false, sessionAuditAiProvider: 'automatic', featureEntitlements: {}, integrationEntitlements: {} },
  sessionLimits: { activeSessions: 0, maxPerUser: 3, maxPerTenant: 30 },
  passwordPolicy: { minLength: 12, regex: '.{12,}', description: 'Review' },
  tenantSettings: { totpIssuer: 'Review', hostsDefaultView: 'home' },
  jitAccess: { enabled: false, expiryMinutes: [5, 10], maxExpiryMinutes: 30, pinRequired: false },
  sharedSessions: { expiryMinutes: [5, 10], maxExpiryMinutes: 30 },
  sftpPolicy: { blockOnModePreservationFailure: false, blockOnOwnershipPreservationFailure: false, blockOnTimestampPreservationFailure: false, diffMaxBytes: 1048576, diffMaxLines: 400 },
}
const entry = (name, type = 'file', parent = '/') => ({ name, path: parent + name, type, size: 10, permissions: 'rw-r--r--', owner: 1000, group: 1000, modifiedAt: '2026-10-03T00:00:00Z' })

async function main() {
  fs.mkdirSync(out, { recursive: true })
  const browser = process.env.CHROMIUM_CDP_URL
    ? await chromium.connectOverCDP(process.env.CHROMIUM_CDP_URL)
    : await chromium.launch({ executablePath: '/usr/bin/chromium-browser', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const token = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '20', tenantId: 1, role: 'admin', stage: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.review`
  await context.addInitScript(token => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'disposable-review')
    localStorage.setItem('nodeaccess_locale', 'pt-BR')
  }, token)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const calls = []
  let scenario = 'normal'
  let releaseSlow
  let slowRequested
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname.replace('/api/v1', '')
    let body
    try { body = req.postDataJSON() } catch { body = null }
    calls.push({ scenario, method: req.method(), path: p, query: Object.fromEntries(url.searchParams), body: body?.content ? { ...body, content: '[redacted]' } : body })
    let status = 200, data = {}
    if (p === '/features') data = { agentsLicensed: true, secretsLicensed: true, snippetsLicensed: true, integrationsLicensed: true, integrationProviders: {} }
    else if (p === '/users/me/preferences') data = null
    else if (p === '/auth/refresh') data = { accessToken: token }
    else if (p === '/sessions/access-map') data = { hosts: [], totals: {}, refreshAfterSeconds: 30 }
    else if (p === '/hosts/sidebar-bootstrap') data = { summary: { all: 1, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else if (p === '/hosts' || p === '/groups' || p === '/inventory') data = []
    else if (p === '/users') data = { data: [], total: 0, page: 1, limit: 200 }
    else if (p === '/settings') data = settings
    else if (p === '/session-audit/policy') data = null
    else if (p === '/settings/sftp-policy') {
      if (scenario === 'settings-error') { status = 500; data = { message: 'Review simulated save failure' } }
      else { settings.sftpPolicy = body; data = settings }
    }
    else if (p.endsWith('/ping')) data = { ok: true, home: '/home/review' }
    else if (p.endsWith('/list')) {
      const dir = url.searchParams.get('path')
      if (dir === '/') data = { path: '/', entries: [entry('slow', 'directory'), entry('denied', 'directory'), entry('root.txt')] }
      else if (dir === '/slow') {
        slowRequested?.()
        await new Promise(resolve => { releaseSlow = resolve })
        data = { path: dir, entries: [entry('slow-only.txt', 'file', '/slow/')] }
      } else if (dir === '/denied') { status = 403; data = { code: 'SFTP_PERMISSION_DENIED', message: 'Permissão negada pelo servidor SFTP.' } }
      else data = { path: dir, entries: [] }
    } else if (p.endsWith('/mkdir')) {
      // Same required-body rule as Fastify; proves the browser/backend mismatch.
      if (!body?.path) { status = 400; data = { code: 'FST_ERR_VALIDATION', message: "body must have required property 'path'" } }
      else { status = 204; data = null }
    } else if (p.endsWith('/touch') || p.endsWith('/rename') || p.endsWith('/upload') || p.endsWith('/file')) { status = 204; data = null }
    else if (p.endsWith('/download')) {
      if (scenario === 'download-error') { status = 403; data = { code: 'SFTP_PERMISSION_DENIED', message: 'CANARY download permission denied' } }
      else return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'download-review' })
    }
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(data) })
  })
  async function fresh(name) {
    scenario = name
    await page.goto(`${base}/files/10`)
    await page.getByText('SFTP conectado', { exact: true }).waitFor()
    await page.locator('tbody tr').filter({ hasText: 'root.txt' }).waitFor()
  }
  async function record(id, defect, evidence) {
    await page.screenshot({ path: path.join(out, `${id}.png`), fullPage: true })
    results.push({ id, defectReproduced: defect, evidence })
  }
  try {
    await fresh('mkdir')
    await page.getByRole('button', { name: /Nova pasta/i }).click()
    await page.getByLabel('Nome da pasta', { exact: true }).fill('review-folder')
    await page.getByRole('button', { name: 'Criar', exact: true }).click()
    await page.getByText('Pasta criada', { exact: true }).waitFor()
    const mkdirCall = calls.filter(c => c.path.endsWith('/mkdir')).at(-1)
    if (mkdirCall.body?.path !== '/review-folder' || mkdirCall.query.path) throw new Error('mkdir contract regression')
    await record('SFTP-01-mkdir', false, mkdirCall)

    await fresh('failed-navigation')
    await page.locator('tbody tr').filter({ hasText: 'denied' }).dblclick()
    await page.getByText('Permissão negada pelo servidor SFTP.', { exact: true }).waitFor()
    const staleVisible = await page.locator('tbody tr').filter({ hasText: 'root.txt' }).count()
    if (staleVisible) throw new Error('Stale files remained after denied navigation')
    await record('SFTP-04-stale-path', false, { staleRootFileUnderDeniedBreadcrumb: staleVisible > 0 })

    await fresh('navigation-race')
    const requested = new Promise(resolve => { slowRequested = resolve })
    await page.locator('tbody tr').filter({ hasText: 'slow' }).dblclick()
    await requested
    const returnedToRoot = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/list') && new URL(r.url()).searchParams.get('path') === '/')
    await page.getByRole('button', { name: '/', exact: true }).click()
    await returnedToRoot
    releaseSlow()
    await page.waitForTimeout(250)
    if (await page.locator('tbody tr').filter({ hasText: 'slow-only.txt' }).count()) throw new Error('Late listing replaced current directory')
    await page.locator('tbody tr').filter({ hasText: 'root.txt' }).waitFor()
    await record('SFTP-05-navigation-race', false, { slowFileVisibleAfterReturningToRoot: false })

    await fresh('download-error')
    await page.locator('tbody tr').filter({ hasText: 'root.txt' }).click({ button: 'right' })
    await page.getByText('Download', { exact: true }).click()
    await page.waitForTimeout(250)
    const text = await page.locator('body').innerText()
    if (!text.includes('CANARY download permission denied')) throw new Error('Download error message was lost')
    await record('SFTP-06-blob-error', false, { specificServerMessageShown: text.includes('CANARY download permission denied') })

    await fresh('mobile')
    await page.setViewportSize({ width: 390, height: 844 })
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, table: document.querySelector('table').getBoundingClientRect().toJSON(), keyboardReachableRows: [...document.querySelectorAll('tbody tr')].filter(e => e.tabIndex >= 0).length }))
    if (geometry.scrollWidth > geometry.viewport || geometry.keyboardReachableRows === 0 || geometry.table.x > 100) throw new Error('Mobile/keyboard regression')
    await page.getByRole('button', { name: 'Ações de root.txt', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByText('Download', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await record('SFTP-07-mobile-keyboard', false, geometry)

    scenario = 'settings-success'
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${base}/admin/settings`)
    const panel = page.locator('.na-panel').filter({ has: page.getByText('Política SFTP', { exact: true }) })
    await panel.getByText('Política SFTP', { exact: true }).waitFor()
    await panel.getByText('Bloquear se permissões não forem preservadas', { exact: true }).click()
    await panel.getByRole('button', { name: 'Salvar política SFTP', exact: true }).click()
    await page.getByText('Política SFTP salva com sucesso', { exact: true }).waitFor()
    const saved = calls.filter(c => c.path === '/settings/sftp-policy').at(-1)
    if (saved?.body?.blockOnModePreservationFailure !== true) throw new Error('SFTP policy toggle was not submitted')
    await record('settings-success', false, { submitted: saved.body })
    scenario = 'settings-error'
    await panel.getByRole('button', { name: 'Salvar política SFTP', exact: true }).click()
    await page.getByText('Erro ao salvar política SFTP', { exact: true }).waitFor()
    await record('settings-error', false, { failureFeedbackShown: true })
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ kind: 'mocked-api-user-simulation', results, errors, calls }, null, 2))
    console.log(JSON.stringify({ results, errors, report: path.join(out, 'report.json') }, null, 2))
  } finally { releaseSlow?.(); await context.close(); await browser.close() }
}
main().catch(error => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ error: error.stack, results }, null, 2)); console.error(error); process.exitCode = 1 })
