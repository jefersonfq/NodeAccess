#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-experience.json'
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH || '/tmp/nodeaccess-terminal-htop.png'
const AUTOCOMPLETE_SCREENSHOT_PATH = process.env.AUTOCOMPLETE_SCREENSHOT_PATH || '/tmp/nodeaccess-terminal-autocomplete.png'
const AUTOCOMPLETE_MOBILE_SCREENSHOT_PATH = process.env.AUTOCOMPLETE_MOBILE_SCREENSHOT_PATH || '/tmp/nodeaccess-terminal-autocomplete-mobile.png'
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''
const UI_THEME = process.env.UI_THEME === 'light' ? 'light' : 'dark'
const THEME_SCREENSHOT_PATH = process.env.THEME_SCREENSHOT_PATH || `/tmp/nodeaccess-terminal-sessions-${UI_THEME}.png`
const host = {
  id: 9401, tenantId: 1, name: 'terminal-critical-host', description: null, ip: '10.40.0.1', port: 22,
  authType: 'password', accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'root', connectionMode: 'direct', scope: 'global',
  groupId: null, folderId: 710, inventoryNodeId: 811, inventoryParentId: 810, inventoryParentName: 'Produção',
  bastionId: null, pemKeyId: null, effectiveBastionId: null, effectiveBastionName: null, effectiveBastionSource: 'none',
  onePasswordRef: null, startupSnippetId: null, startupSnippetMode: 'disabled', trustedHostKeyFingerprint: null,
  trustedHostKeyVerifiedAt: null, tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: true, admin: true },
  createdAt: '2026-08-09T00:00:00Z',
}
const scaleHosts = Array.from({ length: 80 }, (_, index) => ({
  ...host,
  id: 9500 + index,
  name: `scale-host-${String(index + 1).padStart(3, '0')}`,
  ip: `10.50.${Math.floor(index / 250)}.${(index % 250) + 1}`,
  inventoryNodeId: 9600 + index,
  inventoryParentId: 820,
  inventoryParentName: 'Escala',
}))
const retryHost = { ...host, id: 9700, name: 'retry-host', ip: '10.70.0.1', inventoryNodeId: 9701, inventoryParentId: 830, inventoryParentName: 'Falhas' }
const blockedHost = { ...host, id: 9800, name: 'blocked-host', ip: '10.80.0.1', accessPermissions: { view: true, connect: false, edit: false, admin: false } }

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', canManageHosts: true, canViewLiveSessions: true, stage: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.harness`
}

async function main() {
  const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL) : await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ token, pendingHost, theme }) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'terminal-harness-refresh')
    localStorage.setItem('na_term_fontSize', '14')
    localStorage.setItem('na_ui_terminal_display_mode', 'workspace')
    localStorage.setItem('na_hosts_default_view', 'list')
    localStorage.setItem('na_ui_theme_mode', theme)
    sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(pendingHost))
    window.__terminalExperience = { sent: [], resizeMessages: [], sftpMessages: [], sockets: [], errors: [], sftpFaults: {}, forcedDrops: 0 }
    window.__terminalExperience.clipboardText = ''
    window.__terminalExperience.confirmCalls = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => window.__terminalExperience.clipboardText,
        writeText: async (text) => { window.__terminalExperience.clipboardText = String(text) },
      },
    })
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
      constructor(url) {
        super()
        this.url = String(url); this.readyState = 0; this.binaryType = 'arraybuffer'
        this.socketIndex = window.__terminalExperience.sockets.length
        window.__terminalExperience.sockets.push(this)
        setTimeout(() => {
          this.readyState = 1
          this.onopen?.(new Event('open'))
          if (!this.url.includes('/ws/ssh/')) return
          this.emitControl({ type: 'connected', sessionId: 99101 + this.socketIndex, hostName: pendingHost.name, connectionMethod: 'direct', agentName: null })
          this.emitControl({ type: 'info', message: '2 túnel(is) deste host já está(ão) ativo(s) em 2 outra(s) aba(s). Esta sessão reutilizará os mesmos túneis enquanto ao menos uma aba permanecer conectada.' })
          this.emitBytes('Terminal pronto\r\n$ ')
        }, 40)
      }
      send(value) {
        const decoded = typeof value === 'string' ? value : decoder.decode(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
        window.__terminalExperience.sent.push(decoded)
        try {
          const message = JSON.parse(decoded)
          if (message.type === 'resize') window.__terminalExperience.resizeMessages.push({ ...message, at: performance.now() })
          if (message.type === 'ping') this.emitControl({ type: 'pong' })
          if (message.type === 'sftp_home') this.emitControl({ type: 'sftp_result', requestId: message.requestId, ok: true, home: '/root' })
          if (message.type === 'sftp_list') {
            window.__terminalExperience.sftpMessages.push(message.path)
            window.__terminalExperience.sftpFaults[message.path] = (window.__terminalExperience.sftpFaults[message.path] || 0) + 1
            if (message.path === '/unavailable') { this.emitControl({ type: 'sftp_result', requestId: message.requestId, ok: false, code: 'SFTP_UNAVAILABLE' }); return }
            if (message.path === '/slow') { setTimeout(() => this.emitControl({ type: 'sftp_result', requestId: message.requestId, ok: true, path: message.path, entries: [] }), 3500); return }
            if (message.path === '/flaky' && window.__terminalExperience.sftpFaults[message.path] === 1) { this.emitControl({ type: 'sftp_result', requestId: message.requestId, ok: false, code: 'SFTP_BUSY' }); return }
            if (message.path === '/drop-pending') { setTimeout(() => this.forceDrop(), 10); return }
            let entries = message.path === '/'
              ? [{ name: 'var', type: 'directory', path: '/var', size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }]
              : message.path === '.'
                ? [{ name: '-rf', type: 'file', path: './-rf', size: 0, permissions: 'rw-r--r--', owner: 0, group: 0, modifiedAt: new Date().toISOString() }, { name: '.configuração', type: 'directory', path: './.configuração', size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }, { name: 'relatórios ção', type: 'directory', path: './relatórios ção', size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }]
              : message.path === '/var/log'
                ? [{ name: 'anaconda', type: 'directory', path: '/var/log/anaconda', size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }]
              : [{ name: 'application logs', type: 'directory', path: `${message.path}/application logs`, size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }, { name: 'local', type: 'directory', path: `${message.path}/local`, size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }, { name: 'log', type: 'directory', path: `${message.path}/log`, size: 0, permissions: 'rwxr-xr-x', owner: 0, group: 0, modifiedAt: new Date().toISOString() }]
            if (message.prefix) entries = entries.filter((entry) => entry.name.toLowerCase().startsWith(message.prefix.toLowerCase()))
            if (message.directoriesOnly) entries = entries.filter((entry) => entry.type === 'directory')
            if (message.limit) entries = entries.slice(0, message.limit)
            this.emitControl({ type: 'sftp_result', requestId: message.requestId, ok: true, path: message.path, entries })
          }
        } catch {}
      }
      close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(new CloseEvent('close')) }
      forceDrop() { window.__terminalExperience.forcedDrops += 1; this.close() }
      emitControl(value) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })) }
      emitBytes(value) { this.onmessage?.(new MessageEvent('message', { data: encoder.encode(value).buffer })) }
    }
    window.WebSocket = FakeWebSocket
    window.__dropLatestSsh = () => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/')).at(-1)?.forceDrop()
    window.__emitLatestSshBytes = (text) => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/') && socket.readyState === FakeWebSocket.OPEN).at(-1)?.emitBytes(text)
    window.__emitStaleSshOutput = (text) => window.__terminalExperience.sockets.find((socket) => socket.url.includes('/ws/ssh/'))?.emitBytes(text)
    window.__emitHtopFrame = (rows) => {
      const socket = window.__terminalExperience.sockets.filter((item) => item.url.includes('/ws/ssh/') && item.readyState === FakeWebSocket.OPEN).at(-1)
      const lines = ['NodeAccess HTOP  CPU  MEM', ...Array.from({ length: Math.max(2, rows - 2) }, (_, index) => `PID ${String(index + 1).padStart(4, '0')} process-${index + 1}`), 'F1Help F10Quit']
      lines.forEach((line, index) => socket?.emitBytes(`${index === 0 ? '\u001b[?1049h\u001b[2J\u001b[H' : ''}${line}${index < lines.length - 1 ? '\r\n' : ''}`))
    }
    window.__emitPresenceEnded = () => {
      const socket = window.__terminalExperience.sockets.find((item) => item.url.includes('/ws/events'))
      socket?.emitControl({ type: 'session_presence_changed', tenantId: 1, hostId: pendingHost.id, sessionId: 99101, userId: 1, action: 'ended', changedAt: new Date().toISOString() })
    }
    addEventListener('error', (event) => window.__terminalExperience.errors.push(String(event.error?.stack || event.message)))
    addEventListener('unhandledrejection', (event) => window.__terminalExperience.errors.push(String(event.reason)))
  }, { token: fakeJwt(), pendingHost: host, theme: UI_THEME })

  let accessMapActive = true
  let currentHost = structuredClone(host)
  const hostUpdates = []
  const autocompleteSftpRequests = []
  const hostListRequests = []
  let hostByIdsRequests = 0
  let failRetryFolderOnce = true
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/v1/sessions/access-map') body = {
      generatedAt: new Date().toISOString(), refreshAfterSeconds: 5,
      totals: { activeSessions: accessMapActive ? 1 : 0, activeHosts: accessMapActive ? 1 : 0, uniqueUsers: accessMapActive ? 1 : 0, concurrentHosts: 0 },
      hosts: accessMapActive ? [{ host: currentHost, activeSessions: 1, uniqueUsers: 1, oldestStartedAt: new Date().toISOString(), lastStartedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), sessions: [{ id: 99101, user: { id: 1, name: 'Admin', email: 'admin@test', avatarUrl: null, avatarVersion: null }, startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), durationSeconds: 1, connectionMethod: 'direct', accessType: 'authenticated', clientIp: null, agentRemoteIp: null, agentNameSnapshot: null }] }] : [],
    }
    else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 237, global: 237, unfiled: 0, maxHosts: null, folders: { 710: 1 }, groups: {}, tags: {} }, folders: [{ id: 710, name: 'Cliente pessoal', userId: 1, tenantId: 1, parentId: null, createdAt: new Date().toISOString() }], groups: [], tags: [] }
    else if (path === '/api/v1/hosts/sidebar-summary') body = { all: 1, global: 1, unfiled: 1, maxHosts: null, folders: {}, groups: {}, tags: {} }
    else if (path === '/api/v1/hosts/by-ids') {
      hostByIdsRequests += 1
      const ids = new Set((new URL(route.request().url()).searchParams.get('ids') || '').split(',').map(Number))
      if (ids.has(retryHost.id) && failRetryFolderOnce) {
        failRetryFolderOnce = false
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'temporary failure' }) })
        return
      }
      body = [currentHost, retryHost, ...scaleHosts].filter((item) => ids.has(item.id))
    }
    else if (path === `/api/v1/hosts/${host.id}` && route.request().method() === 'PATCH') {
      const update = route.request().postDataJSON()
      hostUpdates.push(update)
      currentHost = { ...currentHost, ...update }
      body = currentHost
    }
    else if (path === `/api/v1/hosts/${host.id}`) body = currentHost
    else if (path === '/api/v1/hosts') {
      const params = new URL(route.request().url()).searchParams
      const request = { page: Number(params.get('page') || 1), limit: Number(params.get('limit') || 20), search: params.get('search') || '', folderId: params.get('folderId'), unfiled: params.get('unfiled') }
      hostListRequests.push(request)
      const noResults = request.search.includes('sem resultado')
      const scoped = request.folderId !== null || request.unfiled === 'true'
      if (request.search === 'slow-old') {
        await new Promise((resolve) => setTimeout(resolve, 650))
        body = { data: [scaleHosts[0]], total: 1, page: request.page, limit: request.limit }
      } else if (request.search === 'blocked-host') body = { data: [blockedHost], total: 1, page: request.page, limit: request.limit }
      else body = { data: noResults ? [] : [currentHost], total: noResults ? 0 : scoped ? 1 : 237, page: request.page, limit: request.limit }
    }
    else if (path === '/api/v1/features') body = { multiConnect: true, sessionAuditLicensed: true, agentsLicensed: true, secretsLicensed: true, snippetsLicensed: true, portForwardingLicensed: true, feedbackLicensed: true, localAiLicensed: true, terminalAutocompleteLicensed: true, terminalAiLicensed: true, mcpLicensed: true, aiSshActionsLicensed: true, integrationsLicensed: true, integrationProviders: {}, sharedSessions: { expiryMinutes: [2, 5, 10, 30], maxExpiryMinutes: 30 } }
    else if (path === '/api/v1/local-ai/status') body = { available: true, enabled: true, mode: 'read_only', routingPolicy: 'local_only', localConfigured: true, networkConfigured: false, effectiveProvider: 'ollama', providerStates: [], routingExplanation: 'Provider local validado.', runtimeFailoverEnabled: false, actionExecutionEnabled: false, guardrailMessage: null, message: null }
    else if (path === `/api/v1/sftp/${host.id}/list`) {
      const requestedPath = new URL(route.request().url()).searchParams.get('path')
      autocompleteSftpRequests.push(requestedPath)
      const entries = requestedPath === '/'
        ? [{ name: 'var', type: 'directory', size: 0, modifiedAt: new Date().toISOString(), permissions: 'drwxr-xr-x' }]
        : [{ name: 'application logs', type: 'directory', size: 0, modifiedAt: new Date().toISOString(), permissions: 'drwxr-xr-x' }, { name: 'local', type: 'directory', size: 0, modifiedAt: new Date().toISOString(), permissions: 'drwxr-xr-x' }, { name: 'log', type: 'directory', size: 0, modifiedAt: new Date().toISOString(), permissions: 'drwxr-xr-x' }]
      body = { path: requestedPath, entries }
    }
    else if (path === '/api/v1/local-ai/terminal-assist' && route.request().method() === 'POST') body = { correlationId: '00000000-0000-4000-8000-000000000042', kind: 'command', title: 'Verificar espaço', explanation: 'Use uma consulta somente leitura.', content: 'df -h', provider: 'ollama', risk: 'safe', canInsert: true, requiresApproval: false, warnings: [] }
    else if (path.includes('/preferences')) body = null
    else if (path === '/api/v1/snippets' || path === '/api/v1/snippet-groups' || path === '/api/v1/secrets') body = []
    else if (path === '/api/v1/inventory') body = [
      { id: 800, parentId: null, type: 'ROOT', hostId: null, name: 'Raiz', path: '/Raiz', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 810, parentId: 800, type: 'FOLDER', hostId: null, name: 'Produção', path: '/Raiz/Produção', depth: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 811, parentId: 810, type: 'HOST', hostId: host.id, name: host.name, path: `/Raiz/Produção/${host.name}`, depth: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 820, parentId: 800, type: 'FOLDER', hostId: null, name: 'Escala', path: '/Raiz/Escala', depth: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ...scaleHosts.map((item, index) => ({ id: 9600 + index, parentId: 820, type: 'HOST', hostId: item.id, name: item.name, path: `/Raiz/Escala/${item.name}`, depth: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
      { id: 830, parentId: 800, type: 'FOLDER', hostId: null, name: 'Falhas', path: '/Raiz/Falhas', depth: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 9701, parentId: 830, type: 'HOST', hostId: retryHost.id, name: retryHost.name, path: `/Raiz/Falhas/${retryHost.name}`, depth: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    else if (path === '/api/v1/forwardings') body = []
    else if (path.includes('/port-forwardings')) body = []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Log.enable'), cdp.send('Network.enable'), cdp.send('Performance.enable')])
  const cdpAnomalies = []
  let expectedCdpHttpErrors = 0
  cdp.on('Runtime.exceptionThrown', (event) => {
    const detail = event.exceptionDetails
    const description = detail.exception?.description || detail.exception?.value || detail.text
    cdpAnomalies.push(`runtime:${description}@${detail.url || 'unknown'}:${detail.lineNumber ?? 0}`)
  })
  cdp.on('Log.entryAdded', (event) => {
    if (event.entry.level !== 'error') return
    if (expectedCdpHttpErrors > 0 && event.entry.text.includes('Failed to load resource')) {
      expectedCdpHttpErrors -= 1
      return
    }
    cdpAnomalies.push(`log:${event.entry.text}`)
  })
  cdp.on('Network.loadingFailed', (event) => {
    if (!event.canceled) cdpAnomalies.push(`network:${event.errorText}`)
  })
  const startedAt = Date.now()
  await page.goto(`${FRONTEND}/terminal?terminalExperience=${startedAt}`, { waitUntil: 'networkidle' })
  const container = page.locator('[data-terminal-container="true"]')
  await container.waitFor()
  await page.waitForFunction(() => Number(document.querySelector('[data-terminal-container="true"]')?.getAttribute('data-terminal-rows')) >= 10)
  await page.getByText(/túnel\(is\).*outra\(s\) aba\(s\)/).waitFor()

  // Botão do meio usa o mesmo pipeline seguro e cede o gesto a aplicativos TUI.
  if (await container.getAttribute('data-terminal-middle-click-paste') !== 'enabled') throw new Error('Colagem com botão do meio não iniciou habilitada')
  await page.evaluate(() => { window.__terminalExperience.clipboardText = 'middle-paste-token' })
  const middlePasteSentBefore = await page.evaluate(() => window.__terminalExperience.sent.join('').split('middle-paste-token').length - 1)
  await container.dispatchEvent('mousedown', { button: 1, buttons: 4, bubbles: true, cancelable: true })
  await page.waitForFunction((before) => window.__terminalExperience.sent.join('').split('middle-paste-token').length - 1 === before + 1, middlePasteSentBefore)

  await page.evaluate(() => window.__emitLatestSshBytes('\u001b[?1000h'))
  await page.waitForTimeout(50)
  const mouseTrackingSentBefore = await page.evaluate(() => window.__terminalExperience.sent.length)
  await container.dispatchEvent('mousedown', { button: 1, buttons: 4, bubbles: true, cancelable: true })
  await page.waitForTimeout(80)
  if (await page.evaluate((before) => window.__terminalExperience.sent.length !== before, mouseTrackingSentBefore)) throw new Error('Clique central foi capturado durante mouse tracking remoto')
  await page.evaluate(() => window.__emitLatestSshBytes('\u001b[?1000l'))

  await page.evaluate(() => {
    window.__terminalExperience.clipboardText = 'linha-1\nlinha-2'
    window.confirm = () => { window.__terminalExperience.confirmCalls += 1; return false }
  })
  const multilineSentBefore = await page.evaluate(() => window.__terminalExperience.sent.length)
  await container.dispatchEvent('mousedown', { button: 1, buttons: 4, bubbles: true, cancelable: true })
  await page.waitForTimeout(80)
  const middlePasteSafety = await page.evaluate((before) => ({
    confirmationShown: window.__terminalExperience.confirmCalls === 1,
    canceledPasteNotSent: window.__terminalExperience.sent.length === before,
  }), multilineSentBefore)
  if (!middlePasteSafety.confirmationShown || !middlePasteSafety.canceledPasteNotSent) throw new Error(`Proteção multilinha falhou no clique central: ${JSON.stringify(middlePasteSafety)}`)
  await page.locator('.xterm-helper-textarea').press('Control+U')
  await page.evaluate(() => { window.confirm = () => true })

  // Modos de exibição: o workspace é o padrão operacional e preserva as sessões.
  const sessionBar = page.locator('[data-terminal-session-bar="true"]')
  const displayModeButton = page.locator('[data-terminal-display-mode="true"]')
  await sessionBar.waitFor()
  await displayModeButton.waitFor()
  if (await page.locator('[data-app-sidebar="true"]').count()) throw new Error('Workspace manteve a navegação global visível')
  const initialSessionCount = await page.locator('[data-terminal-tab-host]').count()
  const initialSocketCount = await page.evaluate(() => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/') && socket.readyState === WebSocket.OPEN).length)
  const initialResizeCount = await page.evaluate(() => window.__terminalExperience.resizeMessages.length)

  async function selectDisplayMode(label) {
    await displayModeButton.click()
    await page.locator('.n-dropdown-menu:visible').last().getByText(label, { exact: false }).click()
  }

  await displayModeButton.click()
  const displayMenu = page.locator('.n-dropdown-menu:visible').last()
  await displayMenu.getByText(/Menu global e sessões visíveis|Global navigation and sessions visible/, { exact: false }).waitFor()
  await displayMenu.getByText(/Padrão|Standard/, { exact: false }).click()
  await page.locator('[data-app-sidebar="true"]').waitFor()
  await sessionBar.waitFor()
  if (await page.locator('[data-terminal-display-state="standard"]').count() !== 1) throw new Error('Modo padrão não foi aplicado')

  await selectDisplayMode(/Espaço de trabalho|Workspace/)
  await page.locator('[data-app-sidebar="true"]').waitFor({ state: 'detached' })
  await sessionBar.waitFor()
  if (await page.evaluate(() => localStorage.getItem('na_ui_terminal_display_mode')) !== 'workspace') throw new Error('Workspace não foi persistido localmente')

  await page.locator('[data-terminal-rail-action="snippets"]').click()
  await page.getByText(/Snippets/, { exact: true }).last().waitFor()
  await selectDisplayMode(/Navegação de sessões|Session navigation/)
  const sessionsNavigator = page.locator('[data-terminal-sessions-navigator="true"]')
  await sessionsNavigator.waitFor()
  await page.locator('[data-terminal-corporate-folder="810"]').waitFor()
  await page.locator('[data-terminal-personal-folder="710"]').waitFor()
  if (await sessionsNavigator.locator('[data-terminal-sessions-host]').count()) throw new Error('Árvore renderizou hosts antes da expansão lazy')
  if (await sessionsNavigator.locator('[data-terminal-all-hosts="true"] .sessions-sidebar-badge').textContent() !== '237') throw new Error('Todos os hosts não usou o total do resumo server-side')
  if (await page.locator('[data-app-sidebar="true"]').count()) throw new Error('Navegação de sessões exibiu o menu global')
  if (!await page.getByText(/Snippets/, { exact: true }).last().isVisible()) throw new Error('Troca para Sessões fechou o painel auxiliar ativo')
  await sessionBar.waitFor()
  const layoutRegions = await page.evaluate(() => {
    const navigator = document.querySelector('[data-terminal-sessions-navigator="true"]')?.getBoundingClientRect()
    const terminal = document.querySelector('[data-terminal-container="true"]')?.getBoundingClientRect()
    const rail = document.querySelector('[data-terminal-tool-rail="true"]')?.getBoundingClientRect()
    const workspace = document.querySelector('.terminal-workspace')
    return navigator && terminal && rail ? {
      navigatorRight: navigator.right, terminalLeft: terminal.left, terminalRight: terminal.right, railLeft: rail.left,
      navigatorOrder: getComputedStyle(document.querySelector('[data-terminal-sessions-navigator="true"]')).order,
      railOrder: getComputedStyle(document.querySelector('[data-terminal-tool-rail="true"]')).order,
      splitOrder: getComputedStyle(document.querySelector('.split-area')).order,
      direction: workspace ? getComputedStyle(workspace).flexDirection : null,
    } : null
  })
  if (!layoutRegions || layoutRegions.navigatorRight > layoutRegions.terminalLeft + 16 || layoutRegions.railLeft < layoutRegions.terminalRight - 16) {
    throw new Error(`Ordem das regiões do terminal incorreta: ${JSON.stringify(layoutRegions)}`)
  }
  if (await page.locator('[data-terminal-corporate-folder="810"] .sessions-sidebar-badge').textContent() !== '1') throw new Error('Contagem corporativa não inclui hosts descendentes')
  if (await page.locator('[data-terminal-corporate-folder="820"] .sessions-sidebar-badge').textContent() !== '80') throw new Error('Contagem da pasta de escala está incorreta')
  if (await page.locator('[data-terminal-personal-folder="710"] .sessions-sidebar-badge').textContent() !== '1') throw new Error('Contagem pessoal não corresponde aos hosts da pasta')
  await sessionsNavigator.getByRole('button', { name: /Pastas corporativas|Corporate folders/ }).click()
  await page.locator('[data-terminal-corporate-folder="810"]').waitFor({ state: 'hidden' })
  await sessionsNavigator.getByRole('button', { name: /Pastas corporativas|Corporate folders/ }).click()
  const keyboardFolder = page.locator('[data-terminal-corporate-folder="810"]')
  await keyboardFolder.focus()
  await keyboardFolder.press('Enter')
  if (await keyboardFolder.getAttribute('aria-expanded') !== 'true') throw new Error('Pasta não expandiu por teclado ou aria-expanded ficou dessincronizado')
  await keyboardFolder.press('Enter')
  if (await keyboardFolder.getAttribute('aria-expanded') !== 'false') throw new Error('Pasta não recolheu por teclado')
  await page.locator('[data-terminal-corporate-folder="820"]').click()
  await page.locator('[data-terminal-sessions-host="9500"]').waitFor()
  const scaledRows = await sessionsNavigator.locator('[data-terminal-sessions-host^="95"]').count()
  if (scaledRows !== 20) throw new Error(`Expansão lazy deveria renderizar 20 de 80 hosts, renderizou ${scaledRows}`)
  await page.locator('[data-terminal-corporate-folder="820"]').click()
  expectedCdpHttpErrors += 1
  await page.locator('[data-terminal-corporate-folder="830"]').click()
  const retryAction = sessionsNavigator.locator('[data-terminal-folder-retry="true"]')
  await retryAction.waitFor()
  await retryAction.click()
  await page.locator(`[data-terminal-sessions-host="${retryHost.id}"]`).waitFor()
  await page.locator('[data-terminal-corporate-folder="810"]').click()
  await page.locator(`[data-terminal-sessions-host="${host.id}"]`).waitFor()
  const corporateRequestCount = hostByIdsRequests
  await page.locator('[data-terminal-corporate-folder="810"]').click()
  await page.locator('[data-terminal-corporate-folder="810"]').click()
  if (hostByIdsRequests !== corporateRequestCount) throw new Error('Reexpansão da pasta corporativa ignorou o cache lazy')
  await page.locator('[data-terminal-personal-folder="710"]').click()
  await page.locator(`[data-terminal-sessions-host="${host.id}"]`).last().waitFor()
  const sessionsSearch = page.locator('[data-terminal-sessions-search="true"] input')
  await sessionsSearch.fill('sem resultado')
  await page.getByText(/Nenhum host encontrado|No hosts found/, { exact: true }).waitFor()
  await sessionsSearch.fill('terminal-critical')
  if (await page.locator(`[data-terminal-sessions-host="${host.id}"]`).isDisabled()) throw new Error('Host permitido ficou indisponível no navegador de sessões')
  await page.locator(`[data-terminal-sessions-host="${host.id}"]`).getByText(/SSH.*Diret|SSH.*Direct/).waitFor()
  const activeSessionRow = page.locator(`[data-terminal-sessions-host="${host.id}"][aria-current="true"]`).first()
  await activeSessionRow.waitFor()
  const themeSelection = await page.evaluate(({ rowSelector, tabSelector }) => {
    const luminance = (value) => {
      const values = (value.match(/[\d.]+/g) || []).map(Number)
      const srgbSyntax = value.startsWith('color(srgb')
      const alpha = values[3] ?? 1
      const rgb = values.slice(0, 3).map((channel) => srgbSyntax ? channel * 255 : channel).map((channel) => channel * alpha + 255 * (1 - alpha)).map((channel) => {
        channel /= 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    }
    const row = document.querySelector(rowSelector)
    const tab = document.querySelector(tabSelector)
    const navigator = document.querySelector('[data-terminal-sessions-navigator="true"]')
    const onboarding = document.querySelector('[data-terminal-onboarding="true"]')
    const toolRail = document.querySelector('[data-terminal-tool-rail="true"]')
    const sidebarHeader = document.querySelector('[data-terminal-sidebar-header="true"]')
    return {
      bodyTheme: document.body.dataset.theme,
      rowBackgroundLuminance: row ? luminance(getComputedStyle(row).backgroundColor) : null,
      tabBackgroundLuminance: tab ? luminance(getComputedStyle(tab).backgroundColor) : null,
      navigatorBackgroundLuminance: navigator ? luminance(getComputedStyle(navigator).backgroundColor) : null,
      onboardingBackgroundLuminance: onboarding ? luminance(getComputedStyle(onboarding).backgroundColor) : null,
      toolRailBackgroundLuminance: toolRail ? luminance(getComputedStyle(toolRail).backgroundColor) : null,
      sidebarHeaderBackgroundLuminance: sidebarHeader ? luminance(getComputedStyle(sidebarHeader).backgroundColor) : null,
    }
  }, { rowSelector: `[data-terminal-sessions-host="${host.id}"][aria-current="true"]`, tabSelector: `[data-terminal-tab-host="${host.id}"]` })
  if (UI_THEME === 'light' && (themeSelection.bodyTheme !== 'light' || themeSelection.rowBackgroundLuminance < 0.75 || themeSelection.tabBackgroundLuminance < 0.75 || themeSelection.navigatorBackgroundLuminance < 0.75 || themeSelection.onboardingBackgroundLuminance < 0.75 || themeSelection.toolRailBackgroundLuminance < 0.75 || themeSelection.sidebarHeaderBackgroundLuminance < 0.75)) {
    throw new Error(`Seleção de sessões permaneceu escura no tema claro: ${JSON.stringify(themeSelection)}`)
  }
  await page.screenshot({ path: THEME_SCREENSHOT_PATH, fullPage: false })
  const tabsBeforeDoubleClick = await page.locator('[data-terminal-tab-host]').count()
  await page.locator(`[data-terminal-sessions-host="${host.id}"]`).dblclick()
  await page.waitForTimeout(150)
  const tabsAfterDoubleClick = await page.locator('[data-terminal-tab-host]').count()
  if (tabsAfterDoubleClick !== tabsBeforeDoubleClick + 1) throw new Error(`Clique duplo deve abrir somente uma nova sessão: ${tabsBeforeDoubleClick} -> ${tabsAfterDoubleClick}`)
  await page.locator(`[data-terminal-close-tab="${host.id}"]`).last().click()
  await page.waitForFunction((expected) => document.querySelectorAll('[data-terminal-tab-host]').length === expected, tabsBeforeDoubleClick)
  await sessionsSearch.fill('slow-old')
  await page.waitForTimeout(280)
  await sessionsSearch.fill('terminal-critical')
  await page.locator(`[data-terminal-sessions-host="${host.id}"]`).waitFor()
  await page.waitForTimeout(450)
  if (await sessionsNavigator.getByText('scale-host-001', { exact: true }).count()) throw new Error('Resposta antiga de busca sobrescreveu o resultado mais recente')
  await sessionsSearch.fill('blocked-host')
  const blockedResult = page.locator(`[data-terminal-sessions-host="${blockedHost.id}"]`)
  await blockedResult.waitFor()
  if (!await blockedResult.isDisabled()) throw new Error('Host sem permissão de conexão permaneceu acionável')
  await sessionsSearch.fill('')
  await sessionsNavigator.locator('[data-terminal-all-hosts="true"]').click()
  const allHostsDialog = page.locator('[data-terminal-all-hosts-dialog="true"]')
  await allHostsDialog.waitFor()
  await allHostsDialog.getByText(/237 host/).waitFor()
  const allRequest = hostListRequests.find((request) => request.limit === 25 && request.page === 1 && !request.folderId)
  if (!allRequest) throw new Error('Todos os hosts não utilizou paginação server-side com 25 itens')
  await allHostsDialog.locator('.n-pagination').getByText('2', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-terminal-all-hosts-dialog="true"]'))
  if (!hostListRequests.some((request) => request.limit === 25 && request.page === 2)) throw new Error('Mudança de página não consultou a segunda página server-side')
  await page.keyboard.press('Escape')
  await allHostsDialog.waitFor({ state: 'hidden' })
  if (!await sessionsNavigator.locator('[data-terminal-all-hosts="true"]').evaluate((element) => document.activeElement === element)) throw new Error('Fechar Todos os hosts não devolveu o foco ao acionador')
  if (hostListRequests.some((request) => request.limit === 200)) throw new Error('Navegador de sessões voltou a carregar 200 hosts antecipadamente')

  const desktopTerminalWidth = (await container.boundingBox()).width
  await page.setViewportSize({ width: 820, height: 760 })
  await page.waitForTimeout(250)
  const mobileSessionsGeometry = await sessionsNavigator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: innerWidth }
  })
  if (mobileSessionsGeometry.left < -1 || mobileSessionsGeometry.right > mobileSessionsGeometry.viewportWidth + 1 || mobileSessionsGeometry.width > mobileSessionsGeometry.viewportWidth * 0.89) throw new Error(`Navegador de sessões extrapolou o viewport estreito: ${JSON.stringify(mobileSessionsGeometry)}`)
  const sessionsMobileTerminalWidth = (await container.boundingBox()).width
  await selectDisplayMode(/Espaço de trabalho|Workspace/)
  await sessionsNavigator.waitFor({ state: 'detached' })
  const workspaceMobileTerminalWidth = (await container.boundingBox()).width
  if (Math.abs(sessionsMobileTerminalWidth - workspaceMobileTerminalWidth) > 4) throw new Error(`Overlay de Sessões comprimiu o terminal no viewport estreito: ${sessionsMobileTerminalWidth} vs ${workspaceMobileTerminalWidth}`)
  await selectDisplayMode(/Navegação de sessões|Session navigation/)
  await sessionsNavigator.waitFor()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(250)
  if (Math.abs((await container.boundingBox()).width - desktopTerminalWidth) > 4) throw new Error('Terminal não recuperou a largura após restaurar o viewport')

  await page.locator('[data-terminal-rail-action="snippets"]').click()
  const modeCycleMetricsBefore = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  const modeCycleNodesBefore = await page.evaluate(() => document.querySelectorAll('*').length)
  const modeCycleResizeBefore = await page.evaluate(() => window.__terminalExperience.resizeMessages.length)
  for (let index = 0; index < 12; index += 1) {
    await selectDisplayMode(index % 2 === 0 ? /Espaço de trabalho|Workspace/ : /Navegação de sessões|Session navigation/)
  }
  if (await page.locator('[data-terminal-display-state="sessions"]').count() !== 1) await selectDisplayMode(/Navegação de sessões|Session navigation/)
  await page.waitForTimeout(300)
  const modeCycleMetricsAfter = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  const modeCycleNodesAfter = await page.evaluate(() => document.querySelectorAll('*').length)
  const modeCycleResizeAfter = await page.evaluate(() => window.__terminalExperience.resizeMessages.length)
  const modeCycleStats = {
    cycles: 12,
    nodeDelta: modeCycleNodesAfter - modeCycleNodesBefore,
    heapDelta: (modeCycleMetricsAfter.JSHeapUsedSize || 0) - (modeCycleMetricsBefore.JSHeapUsedSize || 0),
    resizeDelta: modeCycleResizeAfter - modeCycleResizeBefore,
  }
  if (modeCycleStats.nodeDelta > 250) throw new Error(`Ciclos de modo acumularam nós DOM: ${JSON.stringify(modeCycleStats)}`)
  if (modeCycleStats.resizeDelta > 30) throw new Error(`Ciclos de modo geraram resize excessivo: ${JSON.stringify(modeCycleStats)}`)
  const modeResizeMessages = await page.evaluate((before) => window.__terminalExperience.resizeMessages.slice(before), initialResizeCount)
  if (modeResizeMessages.length > 60) throw new Error(`Jornada completa de modos gerou tempestade de resize: ${modeResizeMessages.length}`)
  await page.mouse.move(900, 700)
  await page.waitForTimeout(500)

  await selectDisplayMode(/Foco total|Focus only/)
  const exitFocus = page.locator('[data-terminal-exit-focus="true"]')
  await exitFocus.waitFor()
  await sessionBar.waitFor({ state: 'hidden' })
  if (await page.locator('[data-terminal-tool-rail="true"]:visible').count()) throw new Error('Foco total manteve o rail lateral visível')
  if (await page.locator('[data-terminal-pane-toolbar="true"]').count()) throw new Error('Foco total manteve a toolbar interna')
  if (await page.locator('[data-terminal-tab-host]:visible').count()) throw new Error('Foco total manteve abas visíveis')
  const focusSocketCount = await page.evaluate(() => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/') && socket.readyState === WebSocket.OPEN).length)
  if (focusSocketCount !== initialSocketCount) throw new Error('Troca de modo recriou ou encerrou o socket SSH')
  if (await page.locator('[data-terminal-container="true"]').count() !== initialSessionCount) throw new Error('Troca de modo removeu o terminal ativo')

  await exitFocus.click()
  await sessionBar.waitFor()
  await displayModeButton.waitFor()
  await page.waitForFunction((before) => window.__terminalExperience.resizeMessages.length > before, initialResizeCount)
  const terminalInputAfterMode = page.locator('.xterm-helper-textarea').first()
  await terminalInputAfterMode.waitFor()
  await page.waitForFunction(() => document.activeElement?.classList.contains('xterm-helper-textarea'))

  // O controle de saída permanece acessível por teclado sem roubar Escape do xterm.
  await selectDisplayMode(/Foco total|Focus only/)
  await exitFocus.waitFor()
  await exitFocus.focus()
  await exitFocus.press('Enter')
  await sessionBar.waitFor()
  if (await page.locator('[data-terminal-display-state="workspace"]').count() !== 1) throw new Error('Botão de saída não retornou ao workspace')

  const terminalInput = page.locator('.xterm-helper-textarea').first()
  await terminalInput.focus()
  await terminalInput.pressSequentially('pw', { delay: 15 })
  const inlineAutocomplete = page.getByTestId('terminal-inline-autocomplete')
  await inlineAutocomplete.waitFor()
  await inlineAutocomplete.getByText('pwd', { exact: true }).waitFor()
  const activeDescendant = await inlineAutocomplete.getAttribute('aria-activedescendant')
  if (!activeDescendant || await page.locator(`#${activeDescendant}`).getAttribute('aria-selected') !== 'true') throw new Error('Autocomplete não expôs a opção ativa para tecnologia assistiva')
  const autocompleteGeometry = await inlineAutocomplete.evaluate((popup) => {
    const container = popup.closest('[data-terminal-container="true"]')
    const pr = popup.getBoundingClientRect(); const cr = container.getBoundingClientRect()
    const anchorTop = Number(popup.dataset.anchorTop)
    const cursorRowTop = cr.top + anchorTop - Number(popup.dataset.anchorCellHeight)
    const cursorRowBottom = cr.top + anchorTop
    const gap = popup.dataset.placement === 'above' ? cursorRowTop - pr.bottom : pr.top - cursorRowBottom
    return { placement: popup.dataset.placement, gap, cursorUnobstructed: pr.bottom <= cursorRowTop || pr.top >= cursorRowBottom, inside: pr.left >= cr.left && pr.right <= cr.right && pr.top >= cr.top && pr.bottom <= cr.bottom }
  })
  if (autocompleteGeometry.gap < 2 || autocompleteGeometry.gap > 12 || !autocompleteGeometry.cursorUnobstructed || !autocompleteGeometry.inside) throw new Error(`Autocomplete distante, sobre o comando ou fora do terminal: ${JSON.stringify(autocompleteGeometry)}`)
  await page.screenshot({ path: AUTOCOMPLETE_SCREENSHOT_PATH, fullPage: false })
  await terminalInput.press('Escape')
  await inlineAutocomplete.waitFor({ state: 'detached' })
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('sy', { delay: 15 })
  await inlineAutocomplete.waitFor()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="terminal-inline-autocomplete"] [role="option"]').length >= 2)
  await inlineAutocomplete.getByText(/Comando|Command/, { exact: true }).waitFor()
  await terminalInput.press('ArrowDown')
  if (await inlineAutocomplete.getByRole('option').nth(1).getAttribute('aria-selected') !== 'true') throw new Error('Seta para baixo não alterou a sugestão selecionada')
  await terminalInput.press('ArrowUp')
  if (await inlineAutocomplete.getByRole('option').first().getAttribute('aria-selected') !== 'true') throw new Error('Seta para cima não retornou à primeira sugestão')
  await terminalInput.press('Escape')
  await inlineAutocomplete.waitFor({ state: 'detached' })
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('pw', { delay: 15 })
  await inlineAutocomplete.waitFor()
  await terminalInput.press('Tab')
  await inlineAutocomplete.waitFor({ state: 'detached' })
  const sentAfterCommandCompletion = await page.evaluate(() => window.__terminalExperience.sent.join(''))
  if (!sentAfterCommandCompletion.includes('pwd')) throw new Error('Autocomplete inline não inseriu apenas o sufixo esperado')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /var', { delay: 8 })
  await inlineAutocomplete.getByText('cd /var/local/', { exact: true }).waitFor()
  if (!await inlineAutocomplete.getByText('Pasta', { exact: true }).first().isVisible()) throw new Error('Autocomplete não identificou visualmente o tipo de recurso')
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /var/lo', { delay: 8 })
  await inlineAutocomplete.getByText('cd /var/local/', { exact: true }).waitFor()
  await terminalInput.press('Tab')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /var/app', { delay: 8 })
  await inlineAutocomplete.getByText('cd /var/application\\ logs/', { exact: true }).waitFor()
  await terminalInput.press('Tab')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /var/log/ana', { delay: 8 })
  await inlineAutocomplete.getByText('cd /var/log/anaconda/', { exact: true }).waitFor()
  // Simula um byte que chegou ao readline remoto enquanto o modelo local ainda
  // exibia a sugestão, reproduzindo o caso observado como /var/r/log/....
  await page.evaluate(() => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/') && socket.readyState === WebSocket.OPEN).at(-1).send('r'))
  const sentBeforeOrphanRecovery = await page.evaluate(() => window.__terminalExperience.sent.join('').length)
  await terminalInput.press('Tab')
  const orphanRecoveryBytes = await page.evaluate((offset) => window.__terminalExperience.sent.join('').slice(offset), sentBeforeOrphanRecovery)
  if (orphanRecoveryBytes !== '\u0015cd /var/log/anaconda/') throw new Error(`Autocomplete preservou byte órfão no caminho: ${JSON.stringify(orphanRecoveryBytes)}`)
  const sessionSftpRequests = await page.evaluate(() => window.__terminalExperience.sftpMessages)
  if (sessionSftpRequests.length < 2 || sessionSftpRequests[0] !== '/' || sessionSftpRequests[1] !== '/var' || autocompleteSftpRequests.length !== 0) throw new Error(`Autocomplete não reutilizou exclusivamente o SFTP da sessão: ${JSON.stringify({ sessionSftpRequests, autocompleteSftpRequests })}`)
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('mkdir /var/new-directory', { delay: 4 })
  await terminalInput.press('Enter')
  await terminalInput.pressSequentially('cd /var/lo', { delay: 8 })
  await inlineAutocomplete.getByText('cd /var/local/', { exact: true }).waitFor()
  const sessionSftpAfterMutation = await page.evaluate(() => window.__terminalExperience.sftpMessages)
  if (sessionSftpAfterMutation.length !== sessionSftpRequests.length + 1) throw new Error(`Comando mutável não invalidou o cache SFTP da sessão: ${JSON.stringify(sessionSftpAfterMutation)}`)
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('disco', { delay: 8 })
  if (await inlineAutocomplete.isVisible()) throw new Error('Alias abriu sugestão automaticamente e pode distrair a digitação normal')
  await terminalInput.press('Control+Space')
  await inlineAutocomplete.getByText('du -xh --max-depth=1 | sort -h', { exact: true }).waitFor()
  const sentBeforeAlias = await page.evaluate(() => window.__terminalExperience.sent.join(''))
  await terminalInput.press('Enter')
  const sentAfterAlias = await page.evaluate(() => window.__terminalExperience.sent.join(''))
  const aliasBytes = sentAfterAlias.slice(sentBeforeAlias.length)
  if (!aliasBytes.includes('\u0015du -xh --max-depth=1 | sort -h') || aliasBytes.includes('\r') || aliasBytes.includes('\n')) throw new Error(`Alias não substituiu a linha com segurança: ${JSON.stringify(aliasBytes)}`)
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('systemctl ', { delay: 8 })
  await inlineAutocomplete.getByText('systemctl status ', { exact: true }).waitFor()
  await terminalInput.pressSequentially('sta', { delay: 8 })
  await page.waitForTimeout(50)
  await inlineAutocomplete.getByText('systemctl status ', { exact: true }).click()
  const contextualBytes = await page.evaluate(() => window.__terminalExperience.sent.join(''))
  if (!contextualBytes.includes('systemctl status ')) throw new Error(`Autocomplete contextual não aceitou a sugestão: ${JSON.stringify(contextualBytes.slice(-120))}`)
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('systemctl --failed', { delay: 5 })
  if (await inlineAutocomplete.isVisible()) await terminalInput.press('Escape')
  await terminalInput.press('Enter')
  await page.evaluate(() => window.__emitLatestSshBytes('nodeaccess-agent.service loaded active running\r\nssh.service loaded active running\r\n$ '))
  await page.waitForTimeout(50)
  await terminalInput.pressSequentially('systemctl restart node', { delay: 5 })
  await inlineAutocomplete.getByText('systemctl restart nodeaccess-agent.service', { exact: true }).waitFor()
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('upt', { delay: 5 })
  await inlineAutocomplete.getByText('uptime', { exact: true }).waitFor()
  await terminalInput.press('Tab')
  await terminalInput.press('Enter')
  await page.evaluate(() => window.__emitLatestSshBytes('\u001b]133;D;0\u0007$ '))
  await page.waitForTimeout(50)
  const learnedHistory = await page.evaluate(() => JSON.parse(localStorage.getItem('na:terminal-autocomplete-history:1:1:9401') || '[]'))
  if (!learnedHistory.some((entry) => entry.value === 'uptime' && entry.count === 1)) throw new Error(`Comando bem-sucedido não entrou no ranking local: ${JSON.stringify(learnedHistory)}`)
  await terminalInput.pressSequentially('df', { delay: 5 })
  await inlineAutocomplete.getByText('df -h', { exact: true }).waitFor()
  await terminalInput.press('Tab')
  await terminalInput.press('Enter')
  await page.evaluate(() => window.__emitLatestSshBytes('\u001b]133;D;1\u0007$ '))
  await page.waitForTimeout(50)
  const historyAfterFailure = await page.evaluate(() => JSON.parse(localStorage.getItem('na:terminal-autocomplete-history:1:1:9401') || '[]'))
  if (historyAfterFailure.some((entry) => entry.value === 'df -h')) throw new Error('Comando com exit code diferente de zero contaminou o ranking')
  await terminalInput.pressSequentially('ls ', { delay: 8 })
  await inlineAutocomplete.getByText('ls ./-rf', { exact: true }).waitFor()
  await inlineAutocomplete.getByText('ls relatórios\\ ção/', { exact: true }).waitFor()
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /unavailable/a', { delay: 5 })
  await page.waitForTimeout(400)
  if (await inlineAutocomplete.isVisible()) throw new Error(`Falha SFTP abriu estado bloqueante sem sugestões úteis: ${JSON.stringify(await inlineAutocomplete.innerText())}`)
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /slow/a', { delay: 5 })
  await page.waitForTimeout(2800)
  if (await inlineAutocomplete.isVisible()) throw new Error('Timeout SFTP deixou loading bloqueante no terminal')
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /flaky/lo', { delay: 5 })
  await inlineAutocomplete.getByText('cd /flaky/local/', { exact: true }).waitFor()
  const flakyAttempts = await page.evaluate(() => window.__terminalExperience.sftpFaults['/flaky'])
  if (flakyAttempts !== 2) throw new Error(`Falha SFTP transitória não se recuperou em uma única repetição: ${flakyAttempts}`)
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(100)
  await terminalInput.pressSequentially('sy', { delay: 15 })
  await inlineAutocomplete.waitFor()
  const mobileAutocompleteGeometry = await inlineAutocomplete.evaluate((popup) => {
    const container = popup.closest('[data-terminal-container="true"]')
    const pr = popup.getBoundingClientRect(); const cr = container.getBoundingClientRect()
    const anchorTop = Number(popup.dataset.anchorTop)
    const cursorRowTop = cr.top + anchorTop - Number(popup.dataset.anchorCellHeight)
    const cursorRowBottom = cr.top + anchorTop
    const gap = popup.dataset.placement === 'above' ? cursorRowTop - pr.bottom : pr.top - cursorRowBottom
    return { placement: popup.dataset.placement, gap, cursorUnobstructed: pr.bottom <= cursorRowTop || pr.top >= cursorRowBottom, inside: pr.left >= cr.left && pr.right <= cr.right && pr.top >= cr.top && pr.bottom <= cr.bottom, width: pr.width, containerWidth: cr.width }
  })
  if (mobileAutocompleteGeometry.gap < 2 || mobileAutocompleteGeometry.gap > 12 || !mobileAutocompleteGeometry.cursorUnobstructed || !mobileAutocompleteGeometry.inside) throw new Error(`Autocomplete mobile sobre o comando ou fora do terminal: ${JSON.stringify(mobileAutocompleteGeometry)}`)
  await page.screenshot({ path: AUTOCOMPLETE_MOBILE_SCREENSHOT_PATH, fullPage: false })
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(100)
  const sftpRequestsBeforeStress = (await page.evaluate(() => window.__terminalExperience.sftpMessages)).length
  const stressStartedAt = Date.now()
  await page.evaluate(() => {
  for (let index = 0; index < 1000; index += 1) {
      window.dispatchEvent(new CustomEvent('nodeaccess:terminal-send-input', { detail: { text: 'sy' } }))
      window.dispatchEvent(new CustomEvent('nodeaccess:terminal-send-input', { detail: { text: '\u0015' } }))
    }
  })
  await page.waitForTimeout(150)
  const autocompleteStressMs = Date.now() - stressStartedAt
  if ((await page.evaluate(() => window.__terminalExperience.sftpMessages)).length !== sftpRequestsBeforeStress) throw new Error('Carga de autocomplete local consultou SFTP sem contexto de caminho')
  if (await page.locator('[data-testid="terminal-inline-autocomplete"] [role="option"]').count() > 8) throw new Error('Autocomplete ultrapassou o limite visual sob carga')
  if (autocompleteStressMs > 4000) throw new Error(`Autocomplete local lento sob 1000 ciclos: ${autocompleteStressMs}ms`)
  const socketsBeforeForcedDrop = await page.evaluate(() => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/')).length)
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /drop-pending/a', { delay: 5 })
  await page.waitForFunction(() => window.__terminalExperience.forcedDrops === 1)
  const reconnectButton = page.getByRole('button', { name: /Reconectar/ }).first()
  await reconnectButton.waitFor()
  if (await inlineAutocomplete.isVisible()) throw new Error('Queda do socket deixou autocomplete pendente sobre o terminal')
  await reconnectButton.click()
  await page.waitForFunction((count) => window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/')).length === count + 1, socketsBeforeForcedDrop)
  await page.waitForTimeout(100)
  await page.evaluate(() => window.__emitStaleSshOutput('STALE_SOCKET_OUTPUT_SHOULD_BE_IGNORED'))
  await page.waitForTimeout(50)
  if ((await page.locator('.xterm-rows').textContent()).includes('STALE_SOCKET_OUTPUT_SHOULD_BE_IGNORED')) throw new Error('Output tardio do socket antigo contaminou a sessão reconectada')
  await terminalInput.focus()
  await terminalInput.press('Control+U')
  await terminalInput.pressSequentially('cd /var/lo', { delay: 5 })
  await inlineAutocomplete.getByText('cd /var/local/', { exact: true }).waitFor()
  await terminalInput.press('Escape')
  await terminalInput.press('Control+U')
  const resilienceSnapshot = await page.evaluate(() => ({
    forcedDisconnectRecovered: window.__terminalExperience.forcedDrops === 1,
    staleSocketOutputIgnored: !document.querySelector('.xterm-rows')?.textContent?.includes('STALE_SOCKET_OUTPUT_SHOULD_BE_IGNORED'),
    pendingSftpCleared: true,
    sshSocketsCreated: window.__terminalExperience.sockets.filter((socket) => socket.url.includes('/ws/ssh/')).length,
  }))
  const sentBeforeAi = await page.evaluate(() => window.__terminalExperience.sent.join(''))
  await terminalInput.pressSequentially('@ai ', { delay: 12 })
  const inlineAi = page.getByTestId('terminal-inline-ai')
  await inlineAi.waitFor().catch(async (error) => {
    const debug = await page.evaluate(() => ({ terminal: window.__NODEACCESS_TERMINAL_HARNESS__, sent: window.__terminalExperience.sent, capabilities: { ...document.querySelector('[data-terminal-container="true"]')?.dataset }, body: document.body.innerText.slice(-2000) }))
    throw new Error(`Copiloto inline não abriu: ${JSON.stringify(debug)}`, { cause: error })
  })
  if ((await page.evaluate(() => window.__terminalExperience.sent.join(''))).includes('@ai ')) throw new Error('Prefixo @ai vazou para o shell remoto')
  await inlineAi.getByTestId('terminal-ai-prompt').locator('textarea').fill('Como verificar o espaço em disco?')
  await inlineAi.getByTestId('terminal-ai-send').click()
  await inlineAi.getByText('df -h', { exact: true }).waitFor()
  if (!sentBeforeAi) throw new Error('Harness não observou o fluxo de entrada anterior ao copiloto')
  await inlineAi.getByRole('button', { name: 'Fechar assistente' }).click()
  await inlineAi.waitFor({ state: 'detached' })

  const before = await container.evaluate((element) => ({ rows: Number(element.dataset.terminalRows), cols: Number(element.dataset.terminalCols), rect: element.getBoundingClientRect().toJSON() }))
  const initialFont = await page.evaluate(() => Number(localStorage.getItem('na_term_fontSize') || 14))
  const box = await container.boundingBox()
  await page.keyboard.down('Control')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await page.getByText(`Zoom do terminal: ${initialFont + 1}px`, { exact: true }).waitFor()
  await page.waitForFunction((font) => Number(localStorage.getItem('na_term_fontSize')) === font, initialFont + 1)
  await page.waitForFunction(() => window.__terminalExperience.resizeMessages.length >= 2)

  const zoomedRows = await container.evaluate((element) => Number(element.dataset.terminalRows))
  const htopStartedAt = Date.now()
  await page.evaluate((rows) => window.__emitHtopFrame(rows), zoomedRows)
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('F10Quit'))
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('NodeAccess HTOP'))
  const htopRenderMs = Date.now() - htopStartedAt
  const layout = await page.evaluate(() => {
    const container = document.querySelector('[data-terminal-container="true"]')
    const screen = document.querySelector('.xterm-screen')
    const viewport = document.querySelector('.xterm-viewport')
    const cr = container.getBoundingClientRect(); const sr = screen.getBoundingClientRect(); const vr = viewport.getBoundingClientRect()
    const lastResize = window.__terminalExperience.resizeMessages.at(-1)
    return {
      rows: Number(container.dataset.terminalRows), cols: Number(container.dataset.terminalCols),
      container: { width: cr.width, height: cr.height }, screen: { width: sr.width, height: sr.height }, viewport: { width: vr.width, height: vr.height },
      bottomGap: Math.max(0, cr.bottom - sr.bottom), lastResize, errors: window.__terminalExperience.errors,
    }
  })
  if (layout.bottomGap > 28) throw new Error(`Tela ANSI cortada: gap inferior ${layout.bottomGap}px`)
  if (layout.lastResize?.rows !== layout.rows || layout.lastResize?.cols !== layout.cols) throw new Error('PTY e xterm estão com dimensões divergentes')
  if (htopRenderMs > 1000) throw new Error(`Primeiro frame interativo lento: ${htopRenderMs}ms`)
  if (layout.errors.length) throw new Error(`Erros no browser: ${layout.errors.join('; ')} | CDP: ${cdpAnomalies.join('; ')}`)
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

  const socketsBeforeNameEdit = await page.evaluate(() => window.__terminalExperience.sockets.length)
  await page.getByRole('button', { name: /Editar host|Edit host/ }).click()
  await page.getByLabel(/Nome do host|Host name/).fill('terminal-critical-host-renamed')
  await page.getByRole('button', { name: /Salvar alterações|Save changes/ }).click()
  await page.getByText(/Host atualizado|Host updated/, { exact: true }).waitFor()
  if (hostUpdates.at(-1)?.name !== 'terminal-critical-host-renamed') throw new Error('Edição de nome não enviou PATCH esperado')
  if (await page.evaluate(() => window.__terminalExperience.sockets.length) !== socketsBeforeNameEdit) throw new Error('Alterar apenas o nome reconectou a sessão')

  await page.getByRole('button', { name: /Editar host|Edit host/ }).click()
  const portInput = page.getByRole('dialog').locator('input').nth(2)
  await portInput.fill('2222')
  await portInput.press('Tab')
  await page.getByText(/sessão atual será reconectada|current session will reconnect/i).waitFor()
  await page.getByRole('button', { name: /Salvar e reconectar|Save and reconnect/ }).click()
  await page.waitForFunction((count) => window.__terminalExperience.sockets.length > count, socketsBeforeNameEdit)
  if (hostUpdates.at(-1)?.port !== 2222) throw new Error('Edição de porta não enviou PATCH esperado')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Editar host|Edit host/ }).click()
  const modalBox = await page.getByRole('dialog').boundingBox()
  if (!modalBox || modalBox.x < 0 || modalBox.x + modalBox.width > 390) throw new Error('Modal de edição extrapola viewport mobile')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })

  await container.dispatchEvent('wheel', { deltaY: -100, ctrlKey: false })
  if (await page.evaluate(() => Number(localStorage.getItem('na_term_fontSize'))) !== initialFont + 1) throw new Error('Scroll sem Ctrl alterou o zoom')
  await page.evaluate(() => {
    const target = document.querySelector('[data-terminal-container="true"]')
    for (let index = 0; index < 20; index += 1) target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => Number(localStorage.getItem('na_term_fontSize')) === 24)
  await page.evaluate(() => {
    const target = document.querySelector('[data-terminal-container="true"]')
    for (let index = 0; index < 30; index += 1) target.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }))
  })
  await page.waitForFunction(() => Number(localStorage.getItem('na_term_fontSize')) === 10)

  await page.goto(`${FRONTEND}/hosts?presenceExperience=${Date.now()}`, { waitUntil: 'networkidle' })
  const presencePill = page.locator('[data-host-presence-pill="true"]')
  await presencePill.waitFor({ timeout: 10_000 }).catch(async () => {
    throw new Error(`Presença não renderizada em /hosts: ${(await page.locator('body').innerText()).slice(0, 1200)}`)
  })
  accessMapActive = false
  await page.evaluate(() => window.__emitPresenceEnded())
  await presencePill.waitFor({ state: 'detached' })

  const performanceMetrics = await cdp.send('Performance.getMetrics')
  if (expectedCdpHttpErrors !== 0) throw new Error(`Falha HTTP esperada não foi observada pelo CDP: ${expectedCdpHttpErrors}`)
  if (cdpAnomalies.length) throw new Error(`Anomalias CDP: ${cdpAnomalies.join('; ')}`)
  const report = { changeId: 'NA-0014', frontend: FRONTEND, result: 'passed', sessionsNavigator: { lazyScaleRows: 20, totalHosts: 237, retryRecovered: true, staleSearchIgnored: true, deniedHostDisabled: true, doubleClickDeduplicated: true, focusReturnedFromPagination: true, mobileGeometry: mobileSessionsGeometry, modeCycles: modeCycleStats }, autocomplete: { literalPrefix: true, remotePath: true, escapedRemotePath: true, optionLikePathNeutralized: true, unicodePathSupported: true, orphanPathByteRecovered: orphanRecoveryBytes === '\u0015cd /var/log/anaconda/', cursorAwareEditing: true, sessionEntitiesLearned: true, successfulCommandLearning: true, failedCommandIgnored: true, contextualProviders: true, safeHistory: true, nonBlockingFailure: true, transientRetryRecovered: flakyAttempts === 2, sessionSftpReuse: true, restSftpRequestCount: autocompleteSftpRequests.length, intentionalAliasDiscovery: true, insertionWithoutExecution: true, keyboardNavigation: true, accessibleActiveOption: true, remoteRequestCount: sessionSftpAfterMutation.length, stressCycles: 1000, stressMs: autocompleteStressMs, geometry: autocompleteGeometry, mobileGeometry: mobileAutocompleteGeometry, screenshot: AUTOCOMPLETE_SCREENSHOT_PATH, mobileScreenshot: AUTOCOMPLETE_MOBILE_SCREENSHOT_PATH }, resilience: resilienceSnapshot, initialFont, zoomedFont: initialFont + 1, zoomBounds: { min: 10, max: 24 }, before, layout, htopRenderMs, hostEdit: { updates: hostUpdates, nameOnlyKeptSession: true, connectionChangeReconnected: true, mobileModalFits: true }, cdp: { anomalies: cdpAnomalies, metrics: Object.fromEntries(performanceMetrics.metrics.filter((metric) => ['JSHeapUsedSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount'].includes(metric.name)).map((metric) => [metric.name, metric.value])) }, presenceEndedImmediately: true, screenshot: SCREENSHOT_PATH }
  report.theme = UI_THEME
  report.themeSelection = { ...themeSelection, screenshot: THEME_SCREENSHOT_PATH }
  report.middleClickPaste = { singlePaste: true, remoteMouseTrackingPreserved: true, ...middlePasteSafety }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
