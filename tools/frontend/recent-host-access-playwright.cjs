#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { chromium } = require('playwright')

const base = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const screenshotDir = process.env.RECENT_HOST_SCREENSHOT_DIR || '/tmp/nodeaccess-recent-host-access'

const hosts = [
  { id: 21, name: 'Servidor de aplicacao com nome extenso', ip: '172.20.10.21', port: 22, sshUser: 'ops', accessProtocol: 'ssh', authType: 'password', connectionMode: 'direct', scope: 'global', folderId: null, inventoryParentName: 'Produção / Aplicações com nome longo', tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: true } },
  { id: 22, name: 'Banco Cliente Sercomtel', ip: '172.20.10.22', port: 22, sshUser: 'dba', accessProtocol: 'ssh', authType: 'password', connectionMode: 'direct', scope: 'global', folderId: 11, tags: [], associatedLinks: [], accessPermissions: { view: true, connect: false, edit: true } },
]

function token(role = 'admin') {
  const payload = { sub: '41', userId: 41, tenantId: 7, role, name: 'Lucien', avatarUrl: '/api/v1/users/41/avatar', canManageHosts: true, stage: 'authenticated', exp: 4102444800 }
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.mock`
}

function dashboardSummary() {
  return { activeSessions: 1, totalSessionsLast30Days: 12, uniqueHostsLast30Days: 2, totalSnippetExecutionsLast30Days: 3, totalSshTunnelsLast30Days: 0, sharedSessionsOwnedLast30Days: 0, sharedSessionsParticipatedLast30Days: 0, topHostsLast30Days: [], topSnippetsLast30Days: [], topSshTunnelsLast30Days: [], weeklyActivityLast4Weeks: [] }
}

async function createContext(browser, viewport, state) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  await context.addInitScript(({ access }) => {
    localStorage.setItem('na_access_token', access)
    localStorage.setItem('na_refresh_token', 'visual-harness')
    localStorage.setItem('nodeaccess_locale', 'pt-BR')
    localStorage.setItem('na_ui_theme_mode', 'dark')
    localStorage.setItem('na_hosts_recents', '[21,22]')
    localStorage.setItem('na_hosts_favorites', '[21,22]')
    localStorage.setItem('na_hosts_quick_access_collapsed', '0')
    localStorage.setItem('na_hosts_display_mode', 'cards')
  }, { access: token(state.role) })
  await context.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let status = 200
    let body = []
    if (path === '/api/v1/users/41/avatar') { status = 404; body = { message: 'Avatar ausente' }; state.avatar404 = (state.avatar404 || 0) + 1 }
    else if (path === '/api/v1/inventory') { if (state.inventoryFail) { status = 404; body = {} } else body = [] }
    else if (path === '/api/v1/user-dashboard/summary') body = dashboardSummary()
    else if (path === '/api/v1/hosts/quick-access') {
      state.quickAccessCalls++
      if (state.failMetadata) { status = 503; body = { message: 'Falha simulada no metadado' } }
      else body = [
        { host: hosts[0], lastAccessedAt: new Date(Date.now() - (state.ageMs || 2 * 60_000)).toISOString(), active: false },
        { host: hosts[1], lastAccessedAt: new Date(Date.now() - 60 * 60_000).toISOString(), active: true },
      ]
    } else if (path === '/api/v1/hosts/by-ids') body = hosts
    else if (path === '/api/v1/hosts/sidebar-bootstrap') {
      if (state.sidebarFail) { status = state.sidebarFail; body = { message: 'Falha simulada nas pastas' } }
      else body = { summary: { all: 2, global: 2, unfiled: 0, maxHosts: 50, folders: { 10: 2, 11: 2 }, groups: {}, tags: {} }, folders: [{ id: 10, name: 'Cliente teste', parentId: null, userId: 41, tenantId: 7 }, { id: 11, name: 'Servidores', parentId: 10, userId: 41, tenantId: 7 }], groups: [], tags: [] }
    }
    else if (path === '/api/v1/hosts') body = { data: hosts, total: 2, page: 1, limit: 20, totalPages: 1 }
    else if (path === '/api/v1/users/me/preferences') body = null
    else if (path === '/api/v1/features') body = { integrationProviders: {}, integrationsLicensed: false, sessionAuditAiLicensed: false, localAiLicensed: false }
    else if (path === '/api/v1/sessions/access-map') body = { totals: {}, hosts: [] }
    else if (path === '/api/v1/hosts/inventory-tree') body = []
    else if (path === '/api/v1/agents/status') body = { status: 'offline' }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.routeWebSocket('**/ws/events*', () => {})
  return context
}

async function assertNoOverflow(page, name) {
  const geometry = await page.locator('body').evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `overflow horizontal em ${name}: ${JSON.stringify(geometry)}`)
  return geometry
}

async function validate(browser, viewport, name) {
  const state = { role: 'user', failMetadata: false, quickAccessCalls: 0, ageMs: (name === 'desktop' ? 11 : 72) * 60 * 60_000 + 5 * 60_000 }
  const context = await createContext(browser, viewport, state)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15_000)

  await page.goto(`${base}/dashboard?recentAccessHarness=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const dashboardAccess = page.getByTestId('dashboard-recent-access')
  await dashboardAccess.first().waitFor()
  assert.equal(await dashboardAccess.count(), 2)
  assert.match(await dashboardAccess.first().textContent(), /Último acesso há (11 h|3 dias)/)
  assert.equal(await dashboardAccess.nth(1).textContent(), 'Sessão ativa')
  const exact = await dashboardAccess.first().getAttribute('title')
  assert.match(exact, /\d{4}.*\d{2}:\d{2}/)
  await dashboardAccess.first().hover()
  await page.getByTestId('dashboard-recent-exact').waitFor()
  assert.equal(await page.getByTestId('dashboard-recent-exact').textContent(), exact)
  await page.mouse.move(0, 0)
  const dashboardGeometry = await assertNoOverflow(page, `${name}/dashboard`)
  await page.screenshot({ path: `${screenshotDir}/dashboard-${name}.png`, fullPage: true })

  await page.goto(`${base}/hosts?view=recent&recentAccessHarness=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const quickAccess = page.getByTestId('hosts-quick-recent-access')
  const cardAccess = page.getByTestId('hosts-card-recent-access')
  await quickAccess.first().waitFor({ state: viewport.width >= 1024 ? 'visible' : 'attached' })
  await cardAccess.first().waitFor()
  assert.equal(await quickAccess.count(), 2)
  assert.equal(await cardAccess.count(), 2)
  assert.equal(await cardAccess.nth(1).textContent(), 'Sessão ativa')

  if (viewport.width >= 1024) {
    await page.locator('.n-select').filter({ hasText: /Cards|Lista/ }).last().click()
    await page.getByText('Lista', { exact: true }).last().click()
    const listAccess = page.getByTestId('hosts-list-recent-access')
    await listAccess.first().waitFor()
    assert.equal(await listAccess.count(), 2)
  }
  const favorite = page.locator('[data-quick-access-favorite="true"][data-host-id="21"]')
  const recent = page.locator('[data-quick-access-recent="true"][data-host-id="21"]')
  await favorite.waitFor(); await recent.waitFor()
  const normalize = text => text.replace('★', '').replace(/\s+/g, ' ').trim()
  assert.equal(normalize(await favorite.innerText()), normalize(await recent.innerText()), 'Favorite and recent must expose the same information')
  assert.equal(await favorite.getByTestId('quick-access-favorite-icon').count(), 1)
  assert.equal(await recent.getByTestId('quick-access-favorite-icon').count(), 0)
  await favorite.focus()
  assert.equal(await favorite.evaluate(el => el === document.activeElement), true)
  for (const kind of ['favorite', 'recent']) {
    const blocked = page.locator(`[data-quick-access-${kind}="true"][data-host-id="22"]`)
    assert.equal(await blocked.isDisabled(), true, 'Standardized cards must preserve host connection ACL')
    assert.ok(await blocked.getAttribute('title'), 'Blocked connection needs an explanation')
  }
  assert.equal(await favorite.getByTestId('quick-access-folder').textContent(), await recent.getByTestId('quick-access-folder').textContent())
  assert.equal(await favorite.getAttribute('data-host-folder'), 'Produção / Aplicações com nome longo')
  await page.locator('[data-quick-access-recent="true"][data-host-id="22"]').getByTestId('quick-access-folder').getByText('Servidores', { exact: true }).waitFor()
  const appearance = el => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderColor, s.borderRadius, s.padding, s.fontSize] }
  await page.mouse.move(0, 0)
  assert.deepEqual(await favorite.evaluate(appearance), await recent.evaluate(appearance))
  await favorite.click({ button: 'right' })
  await page.locator('.n-dropdown-menu:visible').last().waitFor()
  await page.keyboard.press('Escape')
  await recent.click({ button: 'right' })
  await page.locator('.n-dropdown-menu:visible').last().waitFor()
  await page.keyboard.press('Escape')
  const hostsGeometry = await assertNoOverflow(page, `${name}/hosts`)
  await page.screenshot({ path: `${screenshotDir}/hosts-${name}.png`, fullPage: true })

  await page.goto(`${base}/hosts?view=home`)
  await page.locator('[data-quick-access-favorite="true"][data-host-id="21"]').waitFor()
  assert.equal(normalize(await favorite.innerText()), normalize(await recent.innerText()))
  await page.mouse.move(0, 0)
  assert.deepEqual(await favorite.evaluate(appearance), await recent.evaluate(appearance))
  await page.screenshot({ path: `${screenshotDir}/hosts-home-${name}.png`, fullPage: true })
  await page.goto(`${base}/hosts?view=recent`)
  await cardAccess.first().waitFor()
  state.quickAccessCalls = 0
  state.failMetadata = true
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('nodeaccess:session-presence-changed', { detail: { tenantId: 7, hostId: 21, sessionId: 999, action: 'ended' } }))
  })
  await page.getByText('Horário indisponível', { exact: true }).filter({ visible: true }).first().waitFor()
  await page.screenshot({ path: `${screenshotDir}/metadata-failure-${name}.png`, fullPage: true })
  await page.getByText(hosts[0].name, { exact: true }).filter({ visible: true }).first().waitFor()
  assert.ok(state.quickAccessCalls <= 4, `chamadas excessivas ao metadado: ${state.quickAccessCalls}`)
  assert.deepEqual(errors, [], `erros no browser em ${name}`)

  await context.close()
  return { viewport, dashboardGeometry, hostsGeometry, quickAccessCalls: state.quickAccessCalls }
}

async function validateFolders(browser) {
  const state = { quickAccessCalls: 0 }
  const context = await createContext(browser, { width: 1440, height: 960 }, state)
  const page = await context.newPage(), errors = []
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${base}/hosts?view=all`)
  const parent = page.locator('[data-personal-folder-node-id="10"]')
  const folderSection = page.locator('[data-personal-folders-root="true"] .sidebar-panel-toggle')
  await folderSection.waitFor()
  if (await folderSection.getAttribute('aria-expanded') === 'false') await folderSection.click()
  await parent.waitFor()
  await page.locator('.user-avatar__fallback').first().waitFor()
  assert.ok(state.avatar404 > 0, 'Avatar 404 must really be exercised')
  await parent.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' n-tree-node ')][1]").locator('.n-tree-node-switcher').click()
  const child = page.locator('[data-personal-folder-node-id="11"]')
  await child.waitFor(); await child.click()
  await page.getByText(hosts[0].name, { exact: true }).last().waitFor()
  // Use the actual translated label from the sidebar if wording changes.
  await page.evaluate(() => { window.__folderDocument = true })
  const refresh = async () => page.evaluate(async () => {
    const { hostService } = await import('/src/services/host.service.ts')
    const { inventoryService } = await import('/src/services/inventory.service.ts')
    hostService.clearSidebarCaches('test'); inventoryService.clear('test')
    window.dispatchEvent(new CustomEvent('nodeaccess:inventory-acl-changed'))
  })
  for (const failure of [404, 503]) {
    state.sidebarFail = failure
    await refresh()
    await page.getByTestId('sidebar-load-error').waitFor()
    assert.equal(await child.isVisible(), true, 'Failed refresh must preserve the expanded tree')
    assert.equal(await page.evaluate(() => window.__folderDocument), true)
    state.sidebarFail = false
    await page.getByTestId('sidebar-load-error').getByRole('button').click()
    await page.getByTestId('sidebar-load-error').waitFor({ state: 'hidden' })
  }
  state.inventoryFail = true; await refresh()
  await page.getByTestId('sidebar-load-error').waitFor()
  assert.equal(await child.isVisible(), true)
  state.inventoryFail = false
  await page.getByTestId('sidebar-load-error').getByRole('button').click()
  await page.getByTestId('sidebar-load-error').waitFor({ state: 'hidden' })
  // The screenshot's "vpn" text filters folder names, independently of avatar failures.
  const field = page.getByRole('textbox', { name: 'Buscar pasta pessoal, pasta corporativa, global legado, grupo legado ou tag...', exact: true })
  await field.fill('vpn')
  await page.getByTestId('sidebar-search-active').waitFor()
  await parent.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Limpar filtro', exact: true }).click()
  await parent.waitFor()
  if (!await child.isVisible()) await parent.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' n-tree-node ')][1]").locator('.n-tree-node-switcher').click()
  await child.waitFor()
  await child.click()
  await page.getByText(hosts[0].name, { exact: true }).last().waitFor()
  state.sidebarFail = 403; await refresh()
  await page.getByTestId('sidebar-load-error').waitFor()
  await parent.waitFor({ state: 'hidden' })
  state.sidebarFail = false
  await page.getByTestId('sidebar-load-error').getByRole('button').click()
  await parent.waitFor()
  state.sidebarFail = 404
  await page.reload()
  await page.getByTestId('sidebar-load-error').waitFor()
  assert.equal(await parent.count(), 0, 'Initial failure must not pretend folders were loaded')
  state.sidebarFail = false
  await page.getByTestId('sidebar-load-error').getByRole('button').click()
  await parent.waitFor()
  await page.getByTestId('sidebar-load-error').waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  await page.screenshot({ path: `${screenshotDir}/folders-recovered.png`, fullPage: true })
  await context.close()
  return { avatar404: state.avatar404, bootstrapFailures: [404, 503], inventory404Recovered: true, permissionDeniedClearsFolders: true, initial404Recovered: true, searchCleared: true, runtimeErrors: errors }
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(), args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const desktop = await validate(browser, { width: 1440, height: 960 }, 'desktop')
    const folders = await validateFolders(browser)
    const mobile = await validate(browser, { width: 390, height: 844 }, 'mobile')
    const report = { ok: true, desktop, mobile, folders, screenshots: screenshotDir }
    await fs.writeFile(`${screenshotDir}/report.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
