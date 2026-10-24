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
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 768, serviceWorkers: 'block' })
  await context.addInitScript(({ access, theme }) => {
    localStorage.setItem('na_access_token', access)
    localStorage.setItem('na_refresh_token', 'visual-harness')
    localStorage.setItem('nodeaccess_locale', 'pt-BR')
    localStorage.setItem('na_ui_theme_mode', theme)
    localStorage.setItem('na_hosts_recents', '[21,22]')
    localStorage.setItem('na_hosts_favorites', '[21,22]')
    localStorage.setItem('na_hosts_quick_access_collapsed', '0')
    localStorage.setItem('na_hosts_display_mode', 'cards')
  }, { access: token(state.role), theme: process.env.UI_THEME || 'dark' })
  await context.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let status = 200
    let body = []
    if (path === '/api/v1/users/41/avatar') { status = 404; body = { message: 'Avatar ausente' }; state.avatar404 = (state.avatar404 || 0) + 1 }
    else if (path === '/api/v1/inventory') { if (state.inventoryFail) { status = 404; body = {} } else body = state.inventoryNodes || [] }
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
  const dashboardAccess = page.getByTestId('hosts-quick-recent-access')
  await dashboardAccess.first().waitFor()
  assert.equal(await dashboardAccess.count(), 2)
  const dashboardCard = page.locator('[data-quick-access-recent="true"][data-host-id="21"]')
  const deniedCard = page.locator('[data-quick-access-recent="true"][data-host-id="22"]')
  assert.equal(await deniedCard.isDisabled(), true)
  assert.match(await deniedCard.innerText(), /Sessão ativa/)
  assert.match(await dashboardCard.getByTestId('quick-access-short-date').innerText(), /\d{2}\/\d{2}/)
  assert.equal(await dashboardCard.getByTestId('quick-access-protocol').count(), 1)
  await page.waitForFunction(() => document.querySelector('[data-quick-access-recent="true"][data-host-id="22"] [data-testid="quick-access-folder"]')?.getAttribute('title') === 'Raiz → Cliente teste → Servidores')
  assert.equal(await page.locator('[data-quick-access-favorite="true"]').count(), 2)
  await dashboardAccess.first().hover()
  await page.getByTestId('quick-access-time-tooltip').waitFor()
  assert.match(await page.getByTestId('quick-access-time-tooltip').innerText(), /\d{4}.*\d{2}:\d{2}/)
  assert.equal(await dashboardAccess.first().getAttribute('title'), '')
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

  if (viewport.width >= 1280) {
    await page.locator('.n-select').filter({ hasText: /Cards|Lista/ }).last().click()
    await page.getByText('Lista', { exact: true }).last().click()
    const listAccess = page.getByTestId('hosts-list-recent-access').filter({ visible: true })
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
  const clock = favorite.getByTestId('hosts-quick-favorite-access')
  const tooltip = page.getByTestId('quick-access-time-tooltip')
  assert.match(await clock.getByTestId('quick-access-short-date').textContent(), /^\d{2}\/\d{2}$/)
  assert.equal(await clock.getAttribute('title'), '', 'Tooltip customizado não deve duplicar o title nativo')
  assert.equal(await favorite.getByTestId('quick-access-protocol').getAttribute('title'), '')
  await clock.hover()
  await tooltip.waitFor()
  await favorite.focus()
  await page.getByTestId('quick-access-protocol-tooltip').waitFor()
  await tooltip.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('[data-testid="quick-access-time-tooltip"]:visible,[data-testid="quick-access-protocol-tooltip"]:visible').count(), 1, 'Hover + foco deve manter uma única dica')
  await clock.click()
  await tooltip.waitFor()
  await page.getByTestId('quick-access-protocol-tooltip').waitFor({ state: 'hidden' })

  assert.match(await tooltip.textContent(), /Último acesso.*\d{1,2} de [a-zç]+ de \d{4}.*\d{2}:\d{2}/)
  await page.mouse.move(0, 0)
  await favorite.evaluate(el => el.blur())
  await favorite.focus()
  const protocolTooltip = page.getByTestId('quick-access-protocol-tooltip')
  await protocolTooltip.waitFor()
  assert.match(await protocolTooltip.textContent(), /Protocolo: SSH.*Último acesso/)
  await page.keyboard.press('Escape')
  await protocolTooltip.waitFor({ state: 'hidden' })
  await favorite.evaluate(el => { el.dataset.connectionClicks = '0'; el.addEventListener('click', () => { el.dataset.connectionClicks = String(Number(el.dataset.connectionClicks) + 1) }) })
  if (viewport.width < 768) await clock.tap()
  else await clock.click()
  await tooltip.waitFor()
  assert.equal(await favorite.getAttribute('data-connection-clicks'), '0', 'Consultar horário não deve conectar')
  const tipBounds = await tooltip.evaluate(el => {
    const box = el.closest('.n-popover').getBoundingClientRect()
    return { left: box.left, right: box.right, viewport: innerWidth }
  })
  assert.ok(tipBounds.left >= 0 && tipBounds.right <= tipBounds.viewport, JSON.stringify(tipBounds))
  await page.screenshot({ path: `${screenshotDir}/clock-tooltip-${name}.png`, fullPage: true })
  await page.keyboard.press('Escape')
  const layout = await favorite.evaluate(el => {
    const box = selector => el.querySelector(selector).getBoundingClientRect()
    const ip = box('.font-mono'), time = box('[data-testid=hosts-quick-favorite-access]'), protocol = box('[data-testid=quick-access-protocol]'), name = box('.quick-access-host-name'), folder = box('[data-testid=quick-access-folder]')
    return { clockBesideFolder: time.x >= folder.right && time.x - folder.right < 10 && Math.abs(time.y - folder.y) < 5, protocolTopRight: protocol.x >= name.right && Math.abs(el.getBoundingClientRect().right - protocol.right - 11) < 2 && Math.abs(protocol.y - el.getBoundingClientRect().top - 9) < 2, height: el.getBoundingClientRect().height }
  })
  assert.equal(await favorite.locator('.n-tag').count(), 0, 'Não deve restar selo inferior')
  assert.ok(layout.clockBesideFolder && layout.protocolTopRight, JSON.stringify(layout))
  if (viewport.width >= 1440) assert.ok(layout.height < 82, 'Card deve ser menor que a versão com selo inferior de 82px')
  assert.equal(await page.locator('[data-quick-access-recent="true"][data-host-id="22"]').getByTestId('quick-access-active').textContent(), 'Sessão ativa')
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

async function validateProtocols(browser) {
  const originalHost = hosts[0]
  const results = []
  try {
    for (const protocol of ['ssh', 'rdp', 'telnet', 'vnc']) {
      hosts[0] = { ...originalHost, name: 'Servidor de exemplo', accessProtocol: protocol }
      const context = await createContext(browser, { width: 1440, height: 960 }, { role: 'user', quickAccessCalls: 0 })
      const page = await context.newPage()
      await page.goto(`${base}/hosts?view=home`)
      const card = page.locator('[data-quick-access-favorite="true"]').first()
      await card.waitFor()
      const icon = card.getByTestId('quick-access-protocol')
      assert.equal(await icon.locator('svg').getAttribute('data-protocol-icon'), protocol)
      const cardBox = await card.boundingBox(), iconBox = await icon.boundingBox()
      assert.ok(Math.abs(cardBox.x + cardBox.width - iconBox.x - iconBox.width - 11) < 2, 'Ícone alinhado à direita mesmo com nome curto')
      assert.ok(Math.abs(iconBox.y - cardBox.y - 9) < 2, 'Ícone no topo do card')
      assert.match(await icon.innerText(), new RegExp(protocol, 'i'))
      await icon.hover()
      const tip = page.getByTestId('quick-access-protocol-tooltip')
      await tip.waitFor()
      assert.match(await tip.innerText(), new RegExp('Protocolo: ' + protocol, 'i'))
      await card.evaluate(el => { el.dataset.connectionClicks = '0'; el.addEventListener('click', () => { el.dataset.connectionClicks = '1' }) })
      await icon.click()
      assert.equal(await card.getAttribute('data-connection-clicks'), '0')
      await page.keyboard.press('Escape')
      await page.mouse.move(0, 0)
      await card.screenshot({ path: `${screenshotDir}/protocol-${protocol}.png` })
      results.push({ protocol, height: (await card.boundingBox()).height })
      await context.close()
    }
  } finally { hosts[0] = originalHost }
  return results
}

async function validateFolderPaths(browser) {
  const original = hosts[0]
  const state = { role: 'user', quickAccessCalls: 0, inventoryNodes: [
    { id: 101, parentId: null, name: '__root__', type: 'ROOT', hostId: null, path: '/', depth: 0 },
    { id: 102, parentId: 101, name: 'Banco de dados', type: 'FOLDER', hostId: null, path: '/102/', depth: 1 },
    { id: 103, parentId: 102, name: 'Dbs', type: 'FOLDER', hostId: null, path: '/102/103/', depth: 2 },
  ] }
  const context = await createContext(browser, { width: 1440, height: 960 }, state)
  try {
    hosts[0] = { ...original, inventoryParentId: 103, inventoryParentName: 'Dbs' }
    const page = await context.newPage()
    await page.goto(`${base}/hosts?view=home`)
    const folder = page.locator('[data-quick-access-favorite="true"][data-host-id="21"]').getByTestId('quick-access-folder')
    await folder.getByText('Dbs', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('[data-quick-access-favorite="true"][data-host-id="21"] [data-testid="quick-access-folder"]')?.getAttribute('title') === 'Raiz → Banco de dados → Dbs')
    assert.equal(await page.locator('[data-quick-access-recent="true"][data-host-id="21"]').getByTestId('quick-access-folder').getAttribute('title'), 'Raiz → Banco de dados → Dbs')
    assert.equal(await page.locator('[data-quick-access-favorite="true"][data-host-id="22"]').getByTestId('quick-access-folder').getAttribute('title'), 'Raiz → Cliente teste → Servidores')
    assert.ok(!(await folder.innerText()).includes('Banco de dados'), 'Card continua mostrando só a pasta imediata')
    await page.screenshot({ path: `${screenshotDir}/folder-path-desktop.png`, fullPage: true })
    state.inventoryNodes = state.inventoryNodes.filter(node => node.id === 103)
    await page.reload()
    await folder.waitFor()
    await page.waitForFunction(() => document.querySelector('[data-quick-access-favorite="true"][data-host-id="21"] [data-testid="quick-access-folder"]')?.getAttribute('title') === '… → Dbs')
  } finally { hosts[0] = original; await context.close() }
  return { corporate: true, personal: true, partialAncestry: true }
}

async function validateDashboardFallback(browser) {
  const context = await createContext(browser, { width: 390, height: 844 }, {
    role: 'user', failMetadata: true, sidebarFail: 503, inventoryFail: true, quickAccessCalls: 0,
  })
  try {
    const page = await context.newPage()
    await page.goto(`${base}/dashboard`)
    const recent = page.locator('[data-quick-access-recent="true"]')
    await recent.first().waitFor()
    assert.equal(await recent.count(), 2, 'Falha de metadados preserva hosts visíveis')
    assert.match(await recent.first().innerText(), /Horário indisponível/)
    const remove = page.getByRole('button', { name: /Remover dos favoritos:/ })
    await remove.first().click()
    assert.equal(await page.locator('[data-quick-access-favorite="true"]').count(), 1)
    assert.equal(await recent.count(), 2)
    assert.match(page.url(), /\/dashboard/)
    await remove.first().click()
    await page.getByText('Você ainda não marcou hosts como favoritos.', { exact: true }).waitFor()
    assert.equal(await recent.count(), 2)
    await assertNoOverflow(page, 'dashboard/fallback')
    return { metadataFailure: true, foldersFailure: true, removeFavoriteWithoutConnecting: true, emptyFavorites: true }
  } finally { await context.close() }
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath(), args: ['--no-sandbox', '--disable-gpu'] })
  try {
    const desktop = await validate(browser, { width: 1440, height: 960 }, 'desktop')
    const folders = process.env.QUICK_ACCESS_ONLY === '1' ? { skipped: 'Focused card regression; folder recovery is outside this change' } : await validateFolders(browser)
    const mobile = await validate(browser, { width: 390, height: 844 }, 'mobile')
    const tablet = process.env.QUICK_ACCESS_ONLY === '1' ? await validate(browser, { width: 1024, height: 960 }, 'tablet') : null
    const originalHost = hosts[0]
    try {
      hosts[0] = { ...originalHost, inventoryParentName: null, folderId: null, ip: '2001:db8:85a3:0000:0000:8a2e:0370:7334' }
      const context = await createContext(browser, { width: 390, height: 844 }, { quickAccessCalls: 0 })
      const page = await context.newPage()
      await page.goto(`${base}/hosts?view=home`)
      const card = page.locator('[data-quick-access-favorite="true"]').first()
      await card.waitFor()
      assert.equal(await card.getByTestId('quick-access-folder').count(), 0)
      await assertNoOverflow(page, 'ipv6/no-folder')
      assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
      await page.screenshot({ path: `${screenshotDir}/no-folder-ipv6-mobile.png`, fullPage: true })
      for (const rootName of ['__root__', '_root_']) {
        hosts[0] = { ...originalHost, inventoryParentName: rootName, folderId: null }
        await page.reload()
        await card.waitFor()
        const root = card.getByTestId('quick-access-folder')
        assert.equal(await root.getByText('Raiz', { exact: true }).count(), 1)
        assert.equal(await root.getAttribute('title'), 'Este host está no diretório raiz do inventário.')
        assert.ok(!(await card.innerText()).includes('_root_'))
        await assertNoOverflow(page, 'root/mobile')
        await page.screenshot({ path: `${screenshotDir}/root-${rootName.length}-mobile.png`, fullPage: true })
      }
      await context.close()
    } finally { hosts[0] = originalHost }
    const protocols = await validateProtocols(browser)
    const folderPaths = await validateFolderPaths(browser)
    const dashboardFallback = await validateDashboardFallback(browser)
    const report = { ok: true, dashboardFallback, desktop, tablet, mobile, folders, protocols, folderPaths, screenshots: screenshotDir }
    await fs.writeFile(`${screenshotDir}/report.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
