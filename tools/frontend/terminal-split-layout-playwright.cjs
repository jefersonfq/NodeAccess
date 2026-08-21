#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-split-layout.json'
const PERFORMANCE_BUDGETS = {
  // Covers the complete split journey, including mode and auxiliary-panel transitions.
  taskDurationMs: 2_000,
  scriptDurationMs: 1_000,
  layoutDurationMs: 500,
  longestTaskMs: 250,
  cumulativeLayoutShift: 0.1,
  liveDomNodes: 15_000,
}

const hosts = Array.from({ length: 6 }, (_, index) => ({
  id: 9601 + index,
  tenantId: 1,
  name: `split-host-${index + 1}`,
  description: null,
  ip: `10.96.0.${index + 1}`,
  port: 22,
  authType: 'password',
  accessProtocol: 'ssh',
  operatingSystem: 'linux',
  sshUser: 'root',
  connectionMode: 'direct',
  scope: 'global',
  groupId: null,
  folderId: null,
  inventoryNodeId: null,
  inventoryParentId: null,
  inventoryParentName: null,
  bastionId: null,
  pemKeyId: null,
  effectiveBastionId: null,
  effectiveBastionName: null,
  effectiveBastionSource: 'none',
  onePasswordRef: null,
  startupSnippetId: null,
  startupSnippetMode: 'disabled',
  trustedHostKeyFingerprint: null,
  trustedHostKeyVerifiedAt: null,
  tags: [],
  associatedLinks: [],
  accessPermissions: { view: true, connect: true, edit: true, admin: true },
  createdAt: '2026-08-18T00:00:00Z',
}))

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', canManageHosts: true, stage: 'authenticated', iat: now, exp: now + 3600 })}.harness`
}

async function main() {
  const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL) : await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ token, pendingHost, allHosts }) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'split-layout-refresh')
    localStorage.setItem('na_ui_terminal_display_mode', 'workspace')
    sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(pendingHost))
    window.__splitHarness = { resizeMessages: [], errors: [], longTasks: [], layoutShifts: [] }
    try {
      new PerformanceObserver((list) => window.__splitHarness.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true })
      new PerformanceObserver((list) => window.__splitHarness.layoutShifts.push(...list.getEntries().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value))).observe({ type: 'layout-shift', buffered: true })
    } catch {}
    const encoder = new TextEncoder()
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
      constructor(url) {
        super(); this.url = String(url); this.readyState = 0; this.binaryType = 'arraybuffer'
        setTimeout(() => {
          this.readyState = 1; this.onopen?.(new Event('open'))
          if (!this.url.includes('/ws/ssh/')) return
          const hostId = Number(this.url.match(/\/ws\/ssh\/(\d+)/)?.[1])
          const host = allHosts.find((item) => item.id === hostId) || pendingHost
          this.emit({ type: 'connected', sessionId: 99600 + hostId, hostName: host.name, connectionMethod: 'direct', agentName: null })
          this.onmessage?.(new MessageEvent('message', { data: encoder.encode(`${host.name} pronto\r\n$ `).buffer }))
        }, 20)
      }
      send(value) {
        try {
          const message = JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value))
          if (message.type === 'resize') window.__splitHarness.resizeMessages.push(message)
          if (message.type === 'ping') this.emit({ type: 'pong' })
        } catch {}
      }
      close() { this.readyState = 3; this.onclose?.(new CloseEvent('close')) }
      emit(value) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })) }
    }
    window.WebSocket = FakeWebSocket
    addEventListener('error', (event) => window.__splitHarness.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__splitHarness.errors.push(String(event.reason)))
  }, { token: fakeJwt(), pendingHost: hosts[0], allHosts: hosts })

  await context.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let body = null
    if (path === '/api/v1/features') body = { multiConnect: true, snippetsLicensed: true, portForwardingLicensed: true, feedbackLicensed: true, terminalAutocompleteLicensed: true, terminalAiLicensed: false, localAiLicensed: false, integrationsLicensed: false, integrationProviders: {}, sharedSessions: null }
    else if (path === '/api/v1/hosts') body = { data: hosts, total: hosts.length, page: 1, limit: 200 }
    else if (path === '/api/v1/hosts/by-ids') {
      const ids = new Set((url.searchParams.get('ids') || '').split(',').map(Number))
      body = hosts.filter((host) => ids.has(host.id))
    }
    else if (/^\/api\/v1\/hosts\/\d+$/.test(path)) body = hosts.find((host) => host.id === Number(path.split('/').at(-1))) || hosts[0]
    else if (path === '/api/v1/sessions/access-map') body = { generatedAt: new Date().toISOString(), refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    else if (path.includes('/preferences')) body = null
    else if (path === '/api/v1/snippets' || path === '/api/v1/snippet-groups' || path === '/api/v1/secrets') body = []
    else if (path.includes('/forwardings') || path === '/api/v1/inventory') body = []
    else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: hosts.length, global: hosts.length, unfiled: hosts.length, maxHosts: null, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else body = {}
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.goto(`${FRONTEND}/terminal?splitLayoutHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-terminal-container="true"]').first().waitFor()

  for (const host of hosts.slice(1)) {
    await page.locator('[data-terminal-action="new-tab"]').click()
    await page.locator(`#terminal-host-switcher-option-${host.id}`).click()
    await page.waitForFunction((expected) => document.querySelectorAll('[data-terminal-container="true"]').length === expected, host.id - 9600)
  }

  const tabStripLayout = await page.locator('.terminal-tab-strip').evaluate((strip) => ({
    clientWidth: strip.clientWidth,
    scrollWidth: strip.scrollWidth,
    tabWidths: Array.from(strip.querySelectorAll('.terminal-tab'), (tab) => tab.getBoundingClientRect().width),
  }))
  if (tabStripLayout.scrollWidth > tabStripLayout.clientWidth + 2) throw new Error('A faixa de abas ainda depende de rolagem horizontal')
  if (tabStripLayout.tabWidths.length !== 6 || tabStripLayout.tabWidths.some((width) => width < 48)) throw new Error(`Compressão de abas ilegível: ${tabStripLayout.tabWidths.join(', ')}`)

  await page.locator('[data-terminal-action="split-pane"]').click()
  const splitComposer = page.locator('[data-terminal-split-composer="true"]')
  await splitComposer.waitFor()
  for (const host of hosts.filter((item) => item.id > 9604)) {
    const option = splitComposer.locator(`[data-terminal-split-option="${host.id}"]`)
    if ((await option.getAttribute('aria-pressed')) === 'true') await option.click()
  }
  for (const host of hosts.filter((item) => item.id <= 9604)) {
    const option = splitComposer.locator(`[data-terminal-split-option="${host.id}"]`)
    if ((await option.getAttribute('aria-pressed')) !== 'true') await option.click()
  }
  await splitComposer.getByPlaceholder(/Nome do grupo|Group name/).fill('Produção')
  await splitComposer.getByRole('button', { name: /Salvar grupo|Save group/ }).click()
  const savedGroups = await page.evaluate(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key) => key?.startsWith('na_terminal_split_groups:'))
    .flatMap((key) => JSON.parse(localStorage.getItem(key) || '[]')))
  if (!savedGroups.some((group) => group.name === 'Produção' && group.hostIds.length === 4)) throw new Error(`Grupo de split não foi persistido corretamente: ${JSON.stringify(savedGroups)}`)
  await splitComposer.locator('[data-terminal-action="apply-split"]').click()
  const panes = page.locator('[data-terminal-split-pane]')
  await panes.first().waitFor()
  if (await panes.count() !== 4) throw new Error(`Esperados 4 painéis, encontrados ${await panes.count()}`)

  // A visualização pode mudar sem perder a composição ou as proporções do split.
  const ratiosBeforeFocus = await panes.evaluateAll((items) => items.map((item) => {
    const rect = item.parentElement.getBoundingClientRect()
    const area = item.closest('.split-area').getBoundingClientRect()
    return { x: (rect.left - area.left) / area.width, y: (rect.top - area.top) / area.height, width: rect.width / area.width, height: rect.height / area.height }
  }))
  await page.locator('[data-terminal-display-mode="true"]').click()
  await page.locator('.n-dropdown-menu:visible').last().getByText(/Foco total|Focus only/, { exact: true }).click()
  await page.locator('[data-terminal-exit-focus="true"]').waitFor()
  if (await panes.count() !== 4) throw new Error('Foco total alterou a quantidade de painéis do split')
  const ratiosInFocus = await panes.evaluateAll((items) => items.map((item) => {
    const rect = item.parentElement.getBoundingClientRect()
    const area = item.closest('.split-area').getBoundingClientRect()
    return { x: (rect.left - area.left) / area.width, y: (rect.top - area.top) / area.height, width: rect.width / area.width, height: rect.height / area.height }
  }))
  for (let index = 0; index < ratiosBeforeFocus.length; index += 1) {
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Math.abs(ratiosBeforeFocus[index][key] - ratiosInFocus[index][key]) > 0.02) throw new Error(`Foco total alterou a proporção ${key} do painel ${index + 1}`)
    }
  }
  await page.locator('[data-terminal-exit-focus="true"]').click()
  await page.locator('[data-terminal-session-bar="true"]').waitFor()

  await page.locator('[data-terminal-display-mode="true"]').click()
  await page.locator('.n-dropdown-menu:visible').last().getByText(/Navegação de sessões|Session navigation/, { exact: true }).click()
  const splitSessionsNavigator = page.locator('[data-terminal-sessions-navigator="true"]')
  await splitSessionsNavigator.waitFor()
  if (await panes.count() !== 4) throw new Error('Abrir o navegador de Sessões alterou o split ativo')
  const splitRegions = await page.evaluate(() => {
    const navigator = document.querySelector('[data-terminal-sessions-navigator="true"]')?.getBoundingClientRect()
    const area = document.querySelector('.split-area')?.getBoundingClientRect()
    const rail = document.querySelector('[data-terminal-tool-rail="true"]')?.getBoundingClientRect()
    return navigator && area && rail ? { navigatorRight: navigator.right, areaLeft: area.left, areaRight: area.right, railLeft: rail.left } : null
  })
  if (!splitRegions || splitRegions.navigatorRight > splitRegions.areaLeft + 16 || splitRegions.railLeft < splitRegions.areaRight - 16) throw new Error(`Sessões + split reordenou incorretamente as regiões: ${JSON.stringify(splitRegions)}`)
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await page.getByText(/Snippets/, { exact: true }).last().waitFor()
  if (await panes.count() !== 4) throw new Error('Abrir painel auxiliar com Sessões alterou o split')
  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await page.locator('[data-terminal-display-mode="true"]').click()
  await page.locator('.n-dropdown-menu:visible').last().getByText(/Espaço de trabalho|Workspace/, { exact: true }).click()
  await splitSessionsNavigator.waitFor({ state: 'detached' })

  const secondPane = panes.nth(1)
  await secondPane.click()
  if (await secondPane.getAttribute('data-terminal-active') !== 'true') throw new Error('Foco visual não acompanhou o painel clicado')
  await page.waitForFunction((hostId) => {
    const pane = document.querySelector(`[data-terminal-host-id="${hostId}"]`)?.parentElement
    return pane?.querySelector('.xterm-helper-textarea') === document.activeElement
  }, await secondPane.getAttribute('data-terminal-host-id'))
  const focusedTerminalMatchesPane = await secondPane.locator('..').locator('.xterm-helper-textarea').evaluate((textarea) => document.activeElement === textarea)
  if (!focusedTerminalMatchesPane) throw new Error('Cursor de entrada não acompanhou o painel visualmente ativo')

  const connectedIndicators = await page.locator('.split-area .bg-green-400').count()
  if (connectedIndicators !== 4) throw new Error(`Status de conexão duplicado no modo compacto: esperados 4, encontrados ${connectedIndicators}`)
  if (await page.getByText(/Preset Windows|Windows preset/i).count()) throw new Error('Preset recomendado continua visível e poluindo o modo dividido')

  // Recolher a toolbar é uma preferência global, mas não deve duplicar o status em cada painel.
  const paneMetricsBeforeToolbarToggle = await panes.evaluateAll((items) => items.map((item) => {
    const terminal = item.parentElement?.querySelector('[data-terminal-container="true"]')
    return { hostId: item.getAttribute('data-terminal-host-id'), cols: Number(terminal?.getAttribute('data-terminal-cols')), rows: Number(terminal?.getAttribute('data-terminal-rows')) }
  }))
  await panes.first().locator('..').locator('[data-terminal-action="hide-toolbar"]').click()
  const floatingControls = page.locator('[data-terminal-floating-controls="true"]:visible')
  await floatingControls.first().waitFor()
  if (await floatingControls.count() !== 4) throw new Error(`Toolbar minimizada não foi aplicada aos 4 painéis: ${await floatingControls.count()}`)
  if (await floatingControls.locator('.bg-green-400, .bg-yellow-400, .bg-red-400, .bg-gray-500').count()) throw new Error('Controles minimizados ainda exibem um segundo indicador de status')
  if (await page.locator('.split-area .bg-green-400').count() !== 4) throw new Error('Minimizar toolbar removeu ou duplicou o status do cabeçalho')
  await floatingControls.first().locator('[data-terminal-action="show-toolbar"]').click()
  await floatingControls.first().waitFor({ state: 'detached' })
  await page.waitForFunction((before) => before.every((metric) => {
    const pane = document.querySelector(`[data-terminal-host-id="${metric.hostId}"]`)
    const terminal = pane?.parentElement?.querySelector('[data-terminal-container="true"]')
    return Number(terminal?.getAttribute('data-terminal-cols')) > 0 && Number(terminal?.getAttribute('data-terminal-rows')) > 0
  }), paneMetricsBeforeToolbarToggle)
  const paneMetricsAfterToolbarToggle = await panes.evaluateAll((items) => items.map((item) => {
    const terminal = item.parentElement?.querySelector('[data-terminal-container="true"]')
    return { hostId: item.getAttribute('data-terminal-host-id'), cols: Number(terminal?.getAttribute('data-terminal-cols')), rows: Number(terminal?.getAttribute('data-terminal-rows')) }
  }))
  for (const beforeMetric of paneMetricsBeforeToolbarToggle) {
    const afterMetric = paneMetricsAfterToolbarToggle.find((metric) => metric.hostId === beforeMetric.hostId)
    if (!afterMetric || Math.abs(afterMetric.cols - beforeMetric.cols) > 1 || Math.abs(afterMetric.rows - beforeMetric.rows) > 1) throw new Error(`Restaurar toolbar não recuperou as dimensões do terminal ${beforeMetric.hostId}: ${JSON.stringify({ beforeMetric, afterMetric })}`)
  }

  await panes.first().getByRole('button', { name: /Renomear aba|Rename tab/ }).click()
  const renameModal = page.locator('[data-terminal-rename-modal="true"]')
  await renameModal.locator('input').fill('Banco primário')
  await renameModal.getByRole('button', { name: /Salvar|Save/ }).click()
  await panes.first().getByText('Banco primário', { exact: true }).waitFor()
  if (!await page.getByText(/host continua registrado como split-host-1|host remains registered as split-host-1/).count()) {
    // The helper is intentionally visible only while editing; reopen to verify separation.
    await panes.first().getByRole('button', { name: /Renomear aba|Rename tab/ }).click()
    await renameModal.getByText(/host.*split-host-1/i).waitFor()
    await renameModal.getByRole('button', { name: /Cancelar|Cancel/ }).click()
  }

  const columnHandle = page.locator('[data-terminal-split-resizer="column"]')
  const splitArea = page.locator('.split-area')
  if (await columnHandle.getAttribute('role') !== 'separator' || await columnHandle.getAttribute('aria-orientation') !== 'vertical') throw new Error('Separador de colunas sem semântica acessível')
  const areaBox = await splitArea.boundingBox()
  const beforeWidth = (await panes.first().boundingBox()).width
  const columnBox = await columnHandle.boundingBox()
  await columnHandle.dispatchEvent('pointerdown', { pointerId: 1, clientX: columnBox.x + columnBox.width / 2, clientY: areaBox.y + areaBox.height * 0.25 })
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: y, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y, bubbles: true }))
  }, { x: areaBox.x + areaBox.width * 0.65, y: areaBox.y + areaBox.height / 2 })
  const afterWidth = (await panes.first().boundingBox()).width
  if (afterWidth <= beforeWidth + 80) throw new Error(`Resize horizontal não alterou a proporção: ${beforeWidth} -> ${afterWidth}`)

  const rowHandle = page.locator('[data-terminal-split-resizer="row"]')
  const firstPaneShell = panes.first().locator('..')
  const beforeHeight = (await firstPaneShell.boundingBox()).height
  const rowBox = await rowHandle.boundingBox()
  await rowHandle.dispatchEvent('pointerdown', { pointerId: 2, clientX: areaBox.x + areaBox.width * 0.8, clientY: rowBox.y + rowBox.height / 2 })
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: x, clientY: y, bubbles: true }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: x, clientY: y, bubbles: true }))
  }, { x: areaBox.x + areaBox.width / 2, y: areaBox.y + areaBox.height * 0.35 })
  const afterHeight = (await firstPaneShell.boundingBox()).height
  if (afterHeight >= beforeHeight - 60) throw new Error(`Resize vertical não alterou a proporção: ${beforeHeight} -> ${afterHeight}`)

  await columnHandle.focus()
  for (let index = 0; index < 20; index += 1) await columnHandle.press('ArrowLeft')
  if (await columnHandle.getAttribute('aria-valuenow') !== '20') throw new Error('Resize por teclado não respeitou o limite mínimo de 20%')
  for (let index = 0; index < 20; index += 1) await columnHandle.press('ArrowRight')
  if (await columnHandle.getAttribute('aria-valuenow') !== '80') throw new Error('Resize por teclado não respeitou o limite máximo de 80%')

  await page.evaluate(() => {
    window.__splitHarness.longTasks = []
    window.__splitHarness.layoutShifts = []
  })
  const metricsBefore = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  for (let index = 0; index < 24; index += 1) await columnHandle.press(index % 2 === 0 ? 'ArrowLeft' : 'ArrowRight')
  await page.waitForTimeout(250)
  const metricsAfter = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  const metricDeltaMs = (name) => Math.round(((metricsAfter[name] || 0) - (metricsBefore[name] || 0)) * 1000)
  const performance = {
    taskDurationMs: metricDeltaMs('TaskDuration'),
    scriptDurationMs: metricDeltaMs('ScriptDuration'),
    layoutDurationMs: metricDeltaMs('LayoutDuration'),
    layoutCount: Math.round((metricsAfter.LayoutCount || 0) - (metricsBefore.LayoutCount || 0)),
    recalcStyleCount: Math.round((metricsAfter.RecalcStyleCount || 0) - (metricsBefore.RecalcStyleCount || 0)),
  }

  const visualPaneOrder = () => panes.evaluateAll((items) => items
    .map((item) => {
      const rect = item.parentElement.getBoundingClientRect()
      return { hostId: item.dataset.terminalHostId, top: rect.top, left: rect.left }
    })
    .sort((a, b) => Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.left - b.left)
    .map((item) => item.hostId))
  const orderBefore = await visualPaneOrder()
  await page.locator('[data-terminal-split-pane] [aria-label="Move pane earlier"], [data-terminal-split-pane] [aria-label="Mover painel para antes"]').last().click()
  await page.waitForFunction((previousOrder) => {
    const currentOrder = Array.from(document.querySelectorAll('[data-terminal-split-pane]'), (item) => {
      const rect = item.parentElement.getBoundingClientRect()
      return { hostId: item.dataset.terminalHostId, top: rect.top, left: rect.left }
    })
      .sort((a, b) => Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.left - b.left)
      .map((item) => item.hostId)
    return currentOrder.join(',') !== previousOrder
  }, orderBefore.join(','))
  const orderAfter = await visualPaneOrder()
  if (orderBefore.join(',') === orderAfter.join(',')) throw new Error('Arrastar o cabeçalho não reordenou os painéis')

  const stablePositionsBeforeClose = await panes.evaluateAll((items) => Object.fromEntries(items
    .filter((item) => item.dataset.terminalHostId !== '9602')
    .map((item) => {
      const rect = item.parentElement.getBoundingClientRect()
      return [item.dataset.terminalHostId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }]
    })))
  await page.locator('[data-terminal-close-tab="9602"]').click()
  const emptySlot = page.locator('[data-terminal-split-empty="true"]')
  await emptySlot.waitFor()
  if (await panes.count() !== 3) throw new Error('Fechar uma sessão do split incluiu automaticamente outra aba')
  if (await page.locator('[data-terminal-split-pane][data-terminal-host-id="9605"], [data-terminal-split-pane][data-terminal-host-id="9606"]').count()) throw new Error('Uma sessão fora do grupo entrou no split sem confirmação')
  const stablePositionsAfterClose = await panes.evaluateAll((items) => Object.fromEntries(items.map((item) => {
    const rect = item.parentElement.getBoundingClientRect()
    return [item.dataset.terminalHostId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }]
  })))
  for (const [hostId, before] of Object.entries(stablePositionsBeforeClose)) {
    const after = stablePositionsAfterClose[hostId]
    if (!after || ['left', 'top', 'width', 'height'].some((key) => Math.abs(after[key] - before[key]) > 2)) throw new Error(`Painel ${hostId} mudou de posição após fechar outra sessão`)
  }
  await emptySlot.getByRole('button', { name: /Escolher sessão|Choose session/ }).click()
  await splitComposer.locator('[data-terminal-split-replacement="9605"]').click()
  await splitComposer.locator('[data-terminal-action="replace-split-slot"]').click()
  await page.locator('[data-terminal-split-pane][data-terminal-host-id="9605"]').waitFor()
  if (await panes.count() !== 4 || await emptySlot.count()) throw new Error('Substituição explícita do slot vazio falhou')

  await page.locator('[data-terminal-action="edit-split"]').click()
  await splitComposer.getByText('Produção', { exact: true }).click()
  const selectedFromGroup = await splitComposer.locator('[data-terminal-split-option][aria-pressed="true"]').count()
  if (selectedFromGroup !== 3) throw new Error(`Grupo deveria selecionar os hosts ainda abertos sem reconectar sessões: ${selectedFromGroup}`)
  await splitComposer.getByRole('button', { name: /Cancelar|Cancel/ }).click()

  await page.setViewportSize({ width: 820, height: 760 })
  await page.waitForTimeout(150)
  if (await page.locator('[data-terminal-split-resizer]').count()) throw new Error('Redimensionadores permaneceram expostos em viewport estreito')
  const narrowLayout = await page.locator('.split-area').evaluate((area) => ({
    clientWidth: area.clientWidth,
    scrollWidth: area.scrollWidth,
    paneWidths: Array.from(area.querySelectorAll('[data-terminal-split-pane]'), (pane) => pane.parentElement.getBoundingClientRect().width),
  }))
  if (narrowLayout.scrollWidth > narrowLayout.clientWidth + 2 || narrowLayout.paneWidths.some((width) => width < narrowLayout.clientWidth - 4)) throw new Error('Layout dividido criou overflow ou painéis estreitos demais em viewport reduzido')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(150)

  await page.getByRole('button', { name: /Sair da divisão|Exit split view/ }).click()
  await panes.first().waitFor({ state: 'detached' })
  if (await page.locator('[data-terminal-container="true"]').count() !== 5) throw new Error('Sair da divisão encerrou ou removeu sessões abertas')

  const runtime = await page.evaluate(() => ({
    longTasks: window.__splitHarness.longTasks,
    cumulativeLayoutShift: window.__splitHarness.layoutShifts.reduce((total, value) => total + value, 0),
    liveDomNodes: document.querySelectorAll('*').length,
    browserErrors: window.__splitHarness.errors,
  }))
  performance.longTaskCount = runtime.longTasks.length
  performance.longestTaskMs = Math.round(Math.max(0, ...runtime.longTasks))
  performance.cumulativeLayoutShift = Math.round(runtime.cumulativeLayoutShift * 10_000) / 10_000
  performance.liveDomNodes = runtime.liveDomNodes
  const exceededBudgets = Object.entries(PERFORMANCE_BUDGETS).filter(([metric, budget]) => performance[metric] > budget)
  if (exceededBudgets.length) throw new Error(`Orçamento de performance excedido: ${exceededBudgets.map(([metric, budget]) => `${metric}=${performance[metric]} > ${budget}`).join(', ')}`)
  if (runtime.browserErrors.length) throw new Error(`Erros no navegador: ${runtime.browserErrors.join(' | ')}`)

  const report = {
    ok: true,
    paneCount: 4,
    orderBefore,
    orderAfter,
    stablePositionsAfterClose,
    savedGroup: savedGroups.find((group) => group.name === 'Produção'),
    tabStripLayout,
    width: { before: beforeWidth, after: afterWidth },
    height: { before: beforeHeight, after: afterHeight },
    keyboardResize: { minPercent: 20, maxPercent: 80 },
    displayModes: { splitPreserved: true, sessionsWithSplitPreserved: true, auxiliaryPanelPreserved: true, splitRegions, ratiosBeforeFocus, ratiosInFocus },
    narrowLayout,
    performance,
    performanceBudgets: PERFORMANCE_BUDGETS,
    resizeMessages: await page.evaluate(() => window.__splitHarness.resizeMessages.length),
    browserErrors: runtime.browserErrors,
  }
  require('node:fs').writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
