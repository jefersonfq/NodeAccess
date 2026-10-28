#!/usr/bin/env node
// Isolated browser regression: all API/WS interactions are synthetic.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { chromium } = require('playwright')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5279'
const output = process.env.HOST_ACCESS_REPORT_DIR || '/tmp/nodeaccess-host-access-dashboard'
const jwt = role => `e30.${Buffer.from(JSON.stringify({ sub: '41', tenantId: 7, role, name: 'Fixture', stage: 'authenticated', exp: 4102444800 })).toString('base64url')}.fixture`
const blankStatus = { userAgent: null, tenantAgent: null, privateAccessConnector: null }
function host(id, mode, protocol = 'ssh') { return { id, name: `Host ${id}`, ip: `192.0.2.${id}`, port: 22, sshUser: 'fixture', accessProtocol: protocol, connectionMode: mode, authType: 'password', scope: 'global', tags: [], associatedLinks: [], privateAccessConnectorId: null, accessPermissions: { view: true, connect: true, edit: true, admin: true } } }
function dashboard(h, role) { return { host: { ...h, deleted: false, effectiveBastionSource: 'none', effectiveBastionName: null, trustedHostKeyVerifiedAt: null, associatedLinksCount: 0 }, periodDays: 30, viewer: { role, restrictedToOwnActivity: role !== 'admin' }, summary: { sessions: 10, activeSessions: 0, failedSessions: 2, uniqueUsers: 1, audits: 4, auditEvents: 0, bytesIn: 0, bytesOut: 0, sharedSessions: 0, activeSharedSessions: 0, forwardings: 0, webForwardings: 0 }, daily: [], routes: [], origins: [], auditPosture: { running: 0, completed: 2, failed: 1, purged: 0, riskHigh: 1, riskMedium: 0, riskLow: 1 }, health: { status: 'critical', score: 30, title: 'Crítico', reasons: ['2 falhas no período', '1 auditoria com risco alto'] }, recentSessions: [], timeline: [], cache: { enabled: false, hit: false, ttlSeconds: 0, generatedAt: new Date().toISOString() } } }
async function main() {
 await fs.mkdir(output, { recursive: true })
 const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
 const results = []
 try {
 for (const width of [390, 1440]) for (const mode of ['cards', 'list']) {
  const state = { detailFails: false, listFails: false, status: { ...blankStatus }, selected: host(20, 'direct'), role: 'admin', online: false }
  const hosts = [host(20, 'direct'), host(21, 'auto'), host(22, 'agent_user'), { ...host(23, 'private_access_connector'), privateAccessConnectorId: 9 }]
  const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' })
  await context.addInitScript(({ token, mode }) => { if (!localStorage.getItem('na_access_token')) localStorage.setItem('na_access_token', token); localStorage.setItem('nodeaccess_locale', 'pt-BR'); localStorage.setItem('na_hosts_default_view', 'all'); localStorage.setItem('na_hosts_display_mode', mode) }, { token: jwt('admin'), mode })
  await context.route('**/api/v1/**', async route => {
   const url = new URL(route.request().url()), p = url.pathname
   let body = [], status = 200
   if (p === '/api/v1/features') body = { multiConnect: true, agentsLicensed: true, integrationProviders: {}, localAiLicensed: false, aiSshActionsLicensed: false, mcpLicensed: false, sessionAuditLicensed: true }
   else if (p === '/api/v1/settings') body = { license: { sessionAuditAiAutoSummaryEnabled: false } }
   else if (p === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: hosts.length, global: hosts.length, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
   else if (p === '/api/v1/hosts') body = { data: hosts, total: hosts.length, page: 1, limit: 20, totalPages: 1 }
   else if (p === '/api/v1/hosts/by-ids') body = hosts
   else if (p === '/api/v1/agents/status') body = state.status
   else if (p === '/api/v1/agents' && state.listFails) { status = 503; body = { message: 'Fixture unavailable' } }
   else if (p === '/api/v1/agents') body = [{ id: 9, name: 'Pinned connector', online: state.online, active: true, revokedAt: null, maintenanceMode: false, agentType: 'PRIVATE_ACCESS_CONNECTOR', agentMode: 'SERVICE_BOUND' }]
   else if (p === '/api/v1/hosts/20/dashboard') body = dashboard(state.selected, state.role)
   else if (p === '/api/v1/hosts/20') { status = state.detailFails ? 503 : 200; body = state.detailFails ? { message: 'Fixture unavailable' } : state.selected }
   else if (p === '/api/v1/sessions/access-map') body = { totals: {}, hosts: [] }
   else if (p === '/api/v1/network-access/profiles') body = { defaultProfile: 'server_ssh' }
   else if (p === '/api/v1/session-supervision/permission') body = { enabled: false }
   else if (p === '/api/v1/session-audit') body = { data: [], total: 0, page: 1, limit: 20 }
   else if (p === '/api/v1/diagnostic-playbooks/hosts/20/history') body = null
   else if (p.includes('/reports/')) body = { data: [], total: 0 }
   await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.routeWebSocket(/.*/, () => {})
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(12000)
  await page.goto(`${base}/hosts`)
  await page.waitForFunction(() => document.querySelector('[data-host-id="20"] [data-host-connect-button]') || [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Ver todos os hosts →'))
  const allHosts = page.getByRole('button', { name: 'Ver todos os hosts →', exact: true })
  if (await allHosts.isVisible()) await allHosts.click()
  const row = id => page.locator(`[data-host-id="${id}"]`).filter({ has: page.locator('[data-host-connect-button]') }).last()
  const connect = id => row(id).locator('[data-host-connect-button]').last()
  await connect(20).waitFor().catch(async error => { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); console.error('Fixture errors', errors, (await page.locator('body').innerText()).slice(0, 900)); throw error })
  assert.equal(await connect(20).isDisabled(), false)
  assert.equal(await connect(21).isDisabled(), false)
  await page.waitForTimeout(650)
  assert.equal(await connect(22).isDisabled(), true)
  assert.equal(await connect(23).isDisabled(), true)
  assert.ok((await connect(22).getAttribute('title')).length > 0)
  assert.ok(await row(20).locator('[data-protocol-icon="ssh"]').count() > 0)
  const routeIndicator = row(22).getByRole('img').last()
  await routeIndicator.focus(); await page.keyboard.press('Enter'); assert.equal(new URL(page.url()).pathname, '/hosts'); await page.keyboard.press('Escape')
  // Real polling + reactive render invalidation, no direct imports or mutation of component state.
  state.status = { userAgent: { id: 1, name: 'User proxy' }, tenantAgent: null, privateAccessConnector: { id: 8, name: 'Different default' } }
  state.online = true
  await page.waitForFunction(() => { const row = [...document.querySelectorAll('[data-host-id="22"]')].find(el => el.querySelector('[data-host-connect-button]')); return row && !row.querySelector('[data-host-connect-button]').disabled }, null, { timeout: 25000 })
  assert.equal(await connect(23).isDisabled(), false)
  state.listFails = true
  state.status = { ...blankStatus }
  await page.waitForFunction(() => { const row = [...document.querySelectorAll('[data-host-id="23"]')].find(el => el.querySelector('[data-host-connect-button]')); return row && row.querySelector('[data-host-connect-button]').disabled }, null, { timeout: 25000 })
  assert.equal(await connect(20).isDisabled(), false)
  assert.equal(await connect(21).isDisabled(), false)
  state.listFails = false
  state.status = { userAgent: { id: 1, name: 'User proxy' }, tenantAgent: null, privateAccessConnector: null }
  await page.waitForFunction(() => { const row = [...document.querySelectorAll('[data-host-id="23"]')].find(el => el.querySelector('[data-host-connect-button]')); return row && !row.querySelector('[data-host-connect-button]').disabled }, null, { timeout: 25000 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: `${output}/hosts-${width}-${mode}.png`, fullPage: true })
  state.detailFails = true
  await page.goto(`${base}/hosts/20/dashboard`)
  await page.getByText('Não foi possível verificar a rota de conexão.', { exact: false }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Conectar', exact: true }).isDisabled(), true)
  state.detailFails = false
  await page.getByRole('button', { name: 'Verificar conexão novamente', exact: true }).click()
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Conectar'); return b && !b.disabled })
  await page.getByText('Como este indicador é calculado', { exact: true }).click()
  await page.getByText('Requer atenção: pontuação', { exact: false }).waitFor()
  await page.getByRole('button', { name: '2 sessão(ões) com falha', exact: true }).click()
  await page.waitForURL(u => u.searchParams.get('hostId') === '20' && u.searchParams.get('hasError') === 'true' && u.searchParams.get('periodDays') === '30')
  await page.goto(`${base}/hosts/20/dashboard`)
  await page.getByRole('button', { name: 'Auditoria', exact: true }).click()
  await page.waitForURL(u => u.pathname === '/admin/session-audit' && u.searchParams.get('hostId') === '20' && u.searchParams.get('periodDays') === '30')
  await page.goto(`${base}/hosts/20/dashboard`)
  await page.getByRole('button', { name: 'Conectar', exact: true }).waitFor()
  await page.waitForTimeout(250)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: `${output}/dashboard-${width}-${mode}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Conectar', exact: true }).click()
  await page.waitForURL(/\/terminal/)
  await page.locator('[data-terminal-tab-host="20"]').first().waitFor()
  for (const protocol of ['rdp', 'vnc']) {
   state.selected = host(20, 'direct', protocol)
   // A fresh navigation clears the host detail request cache and keeps the original endpoint contract.
   await page.goto(`${base}/hosts/20/dashboard`)
   await page.getByRole('button', { name: 'Conectar', exact: true }).click()
   await page.waitForURL(/\/graphical\/20/)
  }
  state.role = 'user'
  state.selected = { ...host(20, 'direct'), accessPermissions: { view: true, connect: false, edit: false, admin: false } }
  hosts[2].accessPermissions = { view: true, connect: false, edit: false, admin: false }
  await page.evaluate(token => localStorage.setItem('na_access_token', token), jwt('user'))
  await page.goto(`${base}/hosts/20/dashboard`)
  await page.getByRole('button', { name: 'Conectar', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Conectar', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Auditoria', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '2 sessão(ões) com falha', exact: true }).count(), 0)
  await page.goto(`${base}/hosts`)
  await page.waitForFunction(() => document.querySelector('[data-host-id="20"] [data-host-connect-button]') || [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Ver todos os hosts →'))
  if (await allHosts.isVisible()) await allHosts.click()
  await connect(22).waitFor()
  assert.equal(await connect(22).isDisabled(), true)
  assert.match(await connect(22).getAttribute('title'), /permiss|Permiss|acesso/i)
  assert.deepEqual(errors, [])
  results.push({ width, mode, routeAvailability: true, onlinePollUpdatesButtons: true, failedAgentListInvalidatesOnlineCache: true, protocolIcons: true, dashboardConnectSshRdpVnc: true, attentionHostPeriodFilter: true, auditTopHostPeriodFilter: true, detailFailureRetry: true, revokedAclStillBlocksOnlineAgent: true, userAuditAndAttentionRestricted: true })
  await context.close()
 }
 await fs.writeFile(`${output}/report.json`, JSON.stringify({ passed: true, api: 'synthetic; no actual SSH or production access', results }, null, 2)); console.log(JSON.stringify({ passed: true, cases: results.length }))
 } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
