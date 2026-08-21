#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-hosts-personal-folders.json'
const UI_THEME = process.env.UI_THEME === 'light' ? 'light' : 'dark'
const THEME_SCREENSHOT_PATH = process.env.THEME_SCREENSHOT_PATH || `/tmp/nodeaccess-hosts-sessions-${UI_THEME}.png`
const SIDEBAR_THEME_SCREENSHOT_PATH = process.env.SIDEBAR_THEME_SCREENSHOT_PATH || `/tmp/nodeaccess-hosts-sidebar-${UI_THEME}.png`

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '41', userId: 41, tenantId: 7, name: 'Operador', role: 'user', email: 'operator@example.test', stage: 'authenticated', canManageHosts: false, iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const folders = [
  { id: 10, name: 'Cliente X', userId: 41, tenantId: 7, parentId: null, createdAt: new Date().toISOString() },
  { id: 11, name: 'Máquinas de banco', userId: 41, tenantId: 7, parentId: 10, createdAt: new Date().toISOString() },
  { id: 12, name: 'Servidores', userId: 41, tenantId: 7, parentId: 11, createdAt: new Date().toISOString() },
  { id: 13, name: 'Proxy principal', userId: 41, tenantId: 7, parentId: 10, createdAt: new Date().toISOString() },
]
const host = {
  id: 21, tenantId: 7, name: 'DB Cliente X', description: null, ip: '10.0.0.21', port: 22,
  accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'ops', authType: 'password', connectionMode: 'direct',
  scope: 'global', ownerId: null, groupId: 31, folderId: 12, bastionId: null, pemKeyId: null,
  tags: [{ id: 51, name: 'Produção', color: '#2563eb' }], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: false, admin: false },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}
const inventory = [
  { id: 800, parentId: null, type: 'ROOT', hostId: null, name: 'Raiz corporativa', path: '/Raiz corporativa', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 810, parentId: 800, type: 'FOLDER', hostId: null, name: 'Produção corporativa', path: '/Raiz corporativa/Produção corporativa', depth: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 811, parentId: 810, type: 'HOST', hostId: host.id, name: host.name, path: '/Raiz corporativa/Produção corporativa/DB Cliente X', depth: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

async function main() {
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const payloads = []
  const personalFolderMoves = []
  let failNextMove = false
  await context.addInitScript(({ authToken, theme }) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'personal-folders-harness')
    localStorage.setItem('na_hosts_default_view', 'all')
    localStorage.setItem('na_ui_theme_mode', theme)
    window.__folderHarness = { errors: [], shifts: [] }
    addEventListener('error', (event) => window.__folderHarness.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__folderHarness.errors.push(String(event.reason)))
    try { new PerformanceObserver((list) => window.__folderHarness.shifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value))).observe({ type: 'layout-shift', buffered: true }) } catch {}
  }, { authToken: token(), theme: UI_THEME })
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = []
    let status = 200
    if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 1, global: 1, unfiled: 0, maxHosts: 50, folders: { [host.folderId]: 1 }, groups: { 31: 1 }, tags: { 51: 1 } }, folders, groups: [{ id: 31, tenantId: 7, name: 'Operações', description: null, bastionId: null, createdAt: new Date().toISOString() }], tags: host.tags }
    else if (path === '/api/v1/tags') body = host.tags
    else if (path === '/api/v1/groups') body = [{ id: 31, tenantId: 7, name: 'Operações', description: null, bastionId: null, createdAt: new Date().toISOString() }]
    else if (path === '/api/v1/hosts') body = { data: [host], total: 1, page: 1, limit: 20, totalPages: 1 }
    else if (path === `/api/v1/hosts/${host.id}` && request.method() === 'GET') body = host
    else if (path === `/api/v1/hosts/${host.id}/personal-folder` && request.method() === 'PATCH') {
      const payload = request.postDataJSON()
      personalFolderMoves.push(payload)
      if (failNextMove) {
        failNextMove = false
        status = 500
        body = { message: 'Falha simulada ao organizar host' }
      } else {
        host.folderId = payload.folderId
        body = host
      }
    }
    else if (path === '/api/v1/inventory') body = inventory
    else if (path === '/api/v1/sessions/access-map') body = { generatedAt: new Date().toISOString(), refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    else if (path === '/api/v1/features') body = {}
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: 1, hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
    else if (path === '/api/v1/folders' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      payloads.push(payload)
      body = { id: 14, name: payload.name, parentId: payload.parentId, userId: 41, tenantId: 7, createdAt: new Date().toISOString() }
      folders.push(body)
      status = 201
    }
    else if (path === '/api/v1/folders/10' && request.method() === 'DELETE') {
      status = 409
      body = { message: 'Exclua ou mova as subpastas antes de excluir esta pasta' }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${FRONTEND}/hosts?cdp_perf=1&folderHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.hosts-sidebar-panel').waitFor()
  await page.locator('[data-personal-folder-create="true"]').waitFor()
  async function assertLightControl(locator, label, minimumContrast = 4.5) {
    if (UI_THEME !== 'light') return
    await page.waitForTimeout(180)
    const result = await locator.evaluate((element) => {
      const parse = (value) => {
        const values = (value.match(/[\d.]+/g) || []).map(Number)
        const srgb = value.startsWith('color(srgb')
        const alpha = values[3] ?? 1
        return { rgb: values.slice(0, 3).map((channel) => srgb ? channel * 255 : channel), alpha }
      }
      const composite = ({ rgb, alpha }, base = [255, 255, 255]) => rgb.map((channel, index) => channel * alpha + base[index] * (1 - alpha))
      const luminance = (rgb) => {
        const linear = rgb.map((channel) => { channel /= 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
      }
      const style = getComputedStyle(element)
      const pseudoStyle = getComputedStyle(element, '::before')
      const ownBackground = parse(style.backgroundColor)
      const effectiveBackground = ownBackground.alpha > 0.01 ? ownBackground : parse(pseudoStyle.backgroundColor)
      const backgroundRgb = composite(effectiveBackground)
      const textRgb = composite(parse(style.color), backgroundRgb)
      const backgroundLuminance = luminance(backgroundRgb)
      const textLuminance = luminance(textRgb)
      return {
        background: ownBackground.alpha > 0.01 ? style.backgroundColor : pseudoStyle.backgroundColor,
        color: style.color,
        backgroundLuminance,
        contrast: (Math.max(backgroundLuminance, textLuminance) + 0.05) / (Math.min(backgroundLuminance, textLuminance) + 0.05),
      }
    })
    if (result.backgroundLuminance < 0.75 || result.contrast < minimumContrast) {
      throw new Error(`${label} fora do tema claro: ${JSON.stringify(result)}`)
    }
  }
  const selectedSidebarItem = page.locator('[data-hosts-sidebar-key="all"]')
  await selectedSidebarItem.waitFor()
  await selectedSidebarItem.click()
  await page.waitForFunction(() => document.querySelector('[data-hosts-sidebar-key="all"]')?.classList.contains('sidebar-item--active'))
  await assertLightControl(selectedSidebarItem, 'Seleção Todos os hosts')
  const corporateToggle = page.getByRole('button', { name: /Pastas corporativas|Corporate folders/ })
  if (await corporateToggle.getAttribute('aria-expanded') === 'false') await corporateToggle.click()
  const corporateFolder = page.locator('[data-corporate-folder-node-id="810"]')
  await corporateFolder.waitFor()
  const corporateCount = corporateFolder.locator('.inventory-folder-node-count')
  await corporateCount.waitFor()
  if (await corporateCount.textContent() !== '1') throw new Error('Contador da pasta corporativa não refletiu o host descendente')
  await assertLightControl(corporateCount, 'Contador de hosts da pasta corporativa')
  await corporateFolder.click()
  const selectedCorporateNode = page.locator('.inventory-sidebar-tree .n-tree-node--selected').first()
  await selectedCorporateNode.waitFor()
  await assertLightControl(selectedCorporateNode, 'Seleção em Pastas corporativas')
  if (!await page.getByText('Cliente X', { exact: true }).count()) {
    await page.getByRole('button', { name: /Minhas pastas|My folders/ }).click()
  }
  await page.getByText('Cliente X', { exact: true }).waitFor()
  const sidebarSearch = page.locator('.hosts-sidebar-panel input').first()
  await sidebarSearch.fill('Servidores')
  await page.getByText('Máquinas de banco', { exact: true }).waitFor()
  await page.getByText('Servidores', { exact: true }).waitFor()
  await sidebarSearch.fill('')

  // Seleções reais de pasta, grupo e tag compartilham a mesma linguagem visual.
  const clienteSelection = page.locator('.personal-folder-node-label').filter({ hasText: 'Cliente X' }).first()
  await clienteSelection.click()
  const selectedTreeNode = page.locator('.personal-folder-tree .n-tree-node--selected').first()
  await selectedTreeNode.waitFor()
  await assertLightControl(selectedTreeNode, 'Seleção em Minhas pastas')

  const legacyToggle = page.locator('[data-hosts-sidebar-panel="legacy"]')
  if (await legacyToggle.getAttribute('aria-expanded') === 'false') await legacyToggle.click()
  const groupSelection = page.locator('[data-hosts-sidebar-key="group-31"]')
  await groupSelection.click()
  await page.waitForFunction(() => document.querySelector('[data-hosts-sidebar-key="group-31"]')?.classList.contains('sidebar-item--active'))
  await assertLightControl(groupSelection, 'Seleção de grupo')

  const tagsToggle = page.locator('[data-hosts-sidebar-panel="tags"]')
  if (await tagsToggle.getAttribute('aria-expanded') === 'false') await tagsToggle.click()
  const tagSelection = page.locator('[data-hosts-sidebar-key="tag-51"]')
  await tagSelection.focus()
  await tagSelection.press('Enter')
  await page.waitForFunction(() => document.querySelector('[data-hosts-sidebar-key="tag-51"]')?.classList.contains('sidebar-item--active'))
  await assertLightControl(tagSelection, 'Seleção de tag')
  const tagFocus = await tagSelection.evaluate((element) => ({ outlineColor: getComputedStyle(element).outlineColor, outlineWidth: getComputedStyle(element).outlineWidth }))
  if (tagFocus.outlineColor !== 'rgb(37, 99, 235)' || Number.parseFloat(tagFocus.outlineWidth) < 2) throw new Error(`Foco da tag fora do padrão: ${JSON.stringify(tagFocus)}`)

  const visibleBadges = page.locator('.hosts-sidebar-panel .sidebar-badge:visible')
  for (let index = 0; index < await visibleBadges.count(); index += 1) {
    await assertLightControl(visibleBadges.nth(index), `Contador lateral ${index + 1}`)
  }
  await page.screenshot({ path: SIDEBAR_THEME_SCREENSHOT_PATH, fullPage: false })
  await selectedSidebarItem.click()

  if (await page.locator('[data-open-sessions-sidebar="true"]').count()) throw new Error('Controle de sessões deve ficar oculto quando não há sessões abertas')
  if (await page.getByRole('button', { name: /Importar Hosts|Import Hosts/ }).count()) throw new Error('Usuário comum recebeu ação corporativa de importar hosts')
  const clienteRow = page.locator('.personal-folder-node-label').filter({ hasText: 'Cliente X' }).first()

  // Botão direito na pasta cria a subpasta no pai correto.
  await clienteRow.click({ button: 'right' })
  await page.locator('.n-dropdown-menu:visible').last().getByText(/Criar subpasta|Create subfolder/, { exact: true }).click()
  const modal = page.locator('.n-modal').last()
  await modal.getByText(/Local: Cliente X|Location: Cliente X/).waitFor()
  await modal.getByRole('textbox').fill('Proxy secundários')
  await modal.getByRole('button', { name: /Salvar|Save/ }).click()
  if (payloads.length !== 1 || payloads[0].parentId !== 10) throw new Error(`Subpasta enviada sem parentId correto: ${JSON.stringify(payloads)}`)

  // O mesmo menu também é alcançável sem mouse.
  await clienteRow.focus()
  await clienteRow.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
  })
  const keyboardMenu = page.locator('.n-dropdown-menu:visible').last()
  await keyboardMenu.getByText(/Criar subpasta|Create subfolder/, { exact: true }).waitFor()
  await keyboardMenu.getByText(/Renomear|Rename/, { exact: true }).waitFor()
  await keyboardMenu.getByText(/Excluir|Delete/, { exact: true }).waitFor()
  await sidebarSearch.click()

  // Botão direito na raiz oferece somente a criação de pasta raiz.
  await page.locator('[data-personal-folders-root="true"]').click({ button: 'right' })
  const rootMenu = page.locator('.n-dropdown-menu:visible').last()
  await rootMenu.getByText(/Criar pasta pessoal|Create personal folder/, { exact: true }).click()
  await page.locator('.n-modal').last().getByRole('textbox').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.n-modal').last().waitFor({ state: 'hidden' })

  // O atalho visível continua acionável por teclado.
  const rootCreate = page.locator('[data-personal-folder-create="true"]')
  await rootCreate.focus()
  await rootCreate.press('Enter')
  await page.locator('.n-modal').last().getByRole('textbox').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.n-modal').last().waitFor({ state: 'hidden' })

  // Organização pessoal funciona para viewer e não expõe drop corporativo.
  await page.getByText(/Todos os hosts|All hosts/, { exact: true }).first().click()
  const hostCard = page.getByText(host.name, { exact: true }).first()
  await hostCard.waitFor()
  await sidebarSearch.fill('Proxy principal')
  const proxyTarget = page.locator('.personal-folder-node-label').filter({ hasText: 'Proxy principal' }).first()
  await hostCard.dragTo(proxyTarget)
  await page.waitForFunction(() => document.body.innerText.includes('Proxy principal'))
  if (personalFolderMoves.at(-1)?.folderId !== 13) throw new Error(`Drop pessoal não usou endpoint dedicado: ${JSON.stringify(personalFolderMoves)}`)

  // Uma falha de rede não aplica estado otimista nem encerra sessões existentes.
  failNextMove = true
  await sidebarSearch.fill('Servidores')
  await page.getByText(host.name, { exact: true }).first().dragTo(page.locator('.personal-folder-node-label').filter({ hasText: 'Servidores' }).first())
  await page.getByText(/Erro ao mover host|Error moving host/, { exact: true }).waitFor()
  if (host.folderId !== 13) throw new Error('Falha de move alterou a pasta confirmada do host')

  // Busca por folha mantém ancestrais e expande o caminho automaticamente.
  await sidebarSearch.fill('Servidores')
  await page.getByText('Cliente X', { exact: true }).waitFor()
  await page.getByText('Máquinas de banco', { exact: true }).waitFor()
  await page.getByText('Servidores', { exact: true }).waitFor()
  await sidebarSearch.fill('')

  // Integração Hosts -> Terminal -> Hosts preserva a sessão e não duplica o controle.
  const session = await page.evaluate(() => window.__nodeAccessHostsPerf.addOpenSession(21))
  if (!session) throw new Error('Hook CDP não criou sessão local')
  const sessionControl = page.locator('[data-open-sessions-sidebar="true"]')
  await sessionControl.waitFor()
  if (await sessionControl.count() !== 1) throw new Error('Controle de sessões foi duplicado')
  if (!/1/.test(await sessionControl.innerText())) throw new Error('Contador de sessões incorreto')
  const activeSessionCard = page.locator('[data-open-session-host-id="21"][aria-current="true"]')
  await activeSessionCard.waitFor()
  const hostsThemeSelection = await page.evaluate(() => {
    const luminance = (value) => {
      const values = (value.match(/[\d.]+/g) || []).map(Number)
      const srgbSyntax = value.startsWith('color(srgb')
      const alpha = srgbSyntax ? (values[3] ?? 1) : (values[3] ?? 1)
      const rgb = values.slice(0, 3).map((channel) => srgbSyntax ? channel * 255 : channel).map((channel) => channel * alpha + 255 * (1 - alpha)).map((channel) => {
        channel /= 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    }
    const panel = document.querySelector('[data-open-sessions-panel="true"]')
    const selected = document.querySelector('[data-open-session-host-id][aria-current="true"]')
    return {
      bodyTheme: document.body.dataset.theme,
      panelBackground: panel ? getComputedStyle(panel).backgroundColor : null,
      selectedBackground: selected ? getComputedStyle(selected).backgroundColor : null,
      surfaceVariable: getComputedStyle(document.body).getPropertyValue('--na-surface').trim(),
      panelBackgroundLuminance: panel ? luminance(getComputedStyle(panel).backgroundColor) : null,
      selectedBackgroundLuminance: selected ? luminance(getComputedStyle(selected).backgroundColor) : null,
    }
  })
  if (UI_THEME === 'light' && (hostsThemeSelection.bodyTheme !== 'light' || hostsThemeSelection.panelBackgroundLuminance < 0.75 || hostsThemeSelection.selectedBackgroundLuminance < 0.75)) {
    throw new Error(`Painel de sessões permaneceu escuro em Hosts: ${JSON.stringify(hostsThemeSelection)}`)
  }
  await page.screenshot({ path: THEME_SCREENSHOT_PATH, fullPage: false })
  await sessionControl.click()
  await page.waitForURL(/\/terminal/)
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-open-sessions-sidebar="true"]').waitFor()

  // Uma segunda aba compartilha apenas o backend: preferências pessoais continuam obtidas pela API.
  const secondPage = await context.newPage()
  await secondPage.goto(`${FRONTEND}/hosts?cdp_perf=1&secondTab=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await secondPage.locator('[data-personal-folder-create="true"]').waitFor()
  await secondPage.locator('.hosts-sidebar-panel input').first().fill('Proxy secundários')
  await secondPage.getByText('Proxy secundários', { exact: true }).waitFor()
  await secondPage.close()

  // Exclusão destrutiva de um nó com filhos é recusada e explicada pela UI.
  const deleteCliente = page.locator('.personal-folder-node-label').filter({ hasText: 'Cliente X' }).first()
  await deleteCliente.click({ button: 'right' })
  await page.locator('.n-dropdown-menu:visible').last().getByText(/Excluir|Delete/, { exact: true }).click()
  const confirmDialog = page.locator('.n-dialog').last()
  await confirmDialog.getByRole('button', { name: /Excluir|Delete/ }).click()
  await page.getByText('Exclua ou mova as subpastas antes de excluir esta pasta', { exact: true }).waitFor()
  await page.getByText('Cliente X', { exact: true }).waitFor()

  // Escala: 500 pastas adicionais, busca e renderização dentro de budgets explícitos.
  folders.push(...Array.from({ length: 500 }, (_, index) => ({
    id: 1000 + index, name: `Pasta de escala ${String(index).padStart(3, '0')}`,
    userId: 41, tenantId: 7, parentId: null, createdAt: new Date().toISOString(),
  })))
  const scaleStartedAt = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-personal-folder-create="true"]').waitFor()
  if (!await page.getByText('Pasta de escala 499', { exact: true }).count()) {
    const section = page.getByRole('button', { name: /Minhas pastas|My folders/ })
    if (await section.getAttribute('aria-expanded') === 'false') await section.click()
  }
  await page.locator('.hosts-sidebar-panel input').first().fill('Pasta de escala 499')
  await page.getByText('Pasta de escala 499', { exact: true }).waitFor()
  const scaleMs = Date.now() - scaleStartedAt
  if (scaleMs > 4000) throw new Error(`Busca/render com 500 pastas excedeu budget: ${scaleMs}ms`)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  const sidebarBox = await page.locator('.hosts-sidebar-panel').boundingBox()
  if (!sidebarBox || sidebarBox.x < 0 || sidebarBox.width > 390) throw new Error(`Sidebar inválida em viewport estreito: ${JSON.stringify(sidebarBox)}`)
  const runtime = await page.evaluate(() => ({ errors: window.__folderHarness.errors, cls: window.__folderHarness.shifts.reduce((sum, value) => sum + value, 0), nodes: document.querySelectorAll('*').length }))
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  if (runtime.errors.length) throw new Error(`Erros no browser: ${runtime.errors.join(' | ')}`)
  if (runtime.cls > 0.1) throw new Error(`Layout shift acima do budget: ${runtime.cls}`)
  if (runtime.nodes > 12000) throw new Error(`DOM acima do budget: ${runtime.nodes}`)

  const report = { ok: true, theme: UI_THEME, hostsThemeSelection, screenshot: THEME_SCREENSHOT_PATH, sidebarScreenshot: SIDEBAR_THEME_SCREENSHOT_PATH, cdp: true, hierarchyDepth: 3, personalActionsForRegularUser: true, aclUnchanged: true, keyboard: true, dragAndDrop: true, rollbackOnError: true, protectedDelete: true, sessionRoundTrip: true, multiTabApiConsistency: true, scaleFolders: 500, scaleMs, payloads, personalFolderMoves, responsive: sidebarBox, performance: { cumulativeLayoutShift: runtime.cls, liveDomNodes: runtime.nodes, taskDurationMs: Math.round((metrics.TaskDuration || 0) * 1000) } }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await context.close()
  await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
