#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-experience.json'
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH || '/tmp/nodeaccess-terminal-htop.png'
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const host = {
  id: 9401, tenantId: 1, name: 'terminal-critical-host', description: null, ip: '10.40.0.1', port: 22,
  authType: 'password', accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'root', connectionMode: 'direct', scope: 'global',
  groupId: null, folderId: null, inventoryNodeId: null, inventoryParentId: null, inventoryParentName: null,
  bastionId: null, pemKeyId: null, effectiveBastionId: null, effectiveBastionName: null, effectiveBastionSource: 'none',
  onePasswordRef: null, startupSnippetId: null, startupSnippetMode: 'disabled', trustedHostKeyFingerprint: null,
  trustedHostKeyVerifiedAt: null, tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: true, admin: true },
  createdAt: '2026-08-09T00:00:00Z',
}

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', canManageHosts: true, canViewLiveSessions: true, stage: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.harness`
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ token, pendingHost }) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'terminal-harness-refresh')
    localStorage.setItem('na_term_fontSize', '14')
    localStorage.setItem('na_hosts_default_view', 'list')
    sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(pendingHost))
    window.__terminalExperience = { sent: [], resizeMessages: [], sockets: [], errors: [] }
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
      constructor(url) {
        super()
        this.url = String(url); this.readyState = 0; this.binaryType = 'arraybuffer'
        window.__terminalExperience.sockets.push(this)
        setTimeout(() => {
          this.readyState = 1
          this.onopen?.(new Event('open'))
          if (!this.url.includes('/ws/ssh/')) return
          this.emitControl({ type: 'connected', sessionId: 99101, hostName: pendingHost.name, connectionMethod: 'direct', agentName: null })
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
        } catch {}
      }
      close() { this.readyState = 3; this.onclose?.(new CloseEvent('close')) }
      emitControl(value) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) })) }
      emitBytes(value) { this.onmessage?.(new MessageEvent('message', { data: encoder.encode(value).buffer })) }
    }
    window.WebSocket = FakeWebSocket
    window.__emitHtopFrame = (rows) => {
      const socket = window.__terminalExperience.sockets.find((item) => item.url.includes('/ws/ssh/'))
      const lines = ['NodeAccess HTOP  CPU  MEM', ...Array.from({ length: Math.max(2, rows - 2) }, (_, index) => `PID ${String(index + 1).padStart(4, '0')} process-${index + 1}`), 'F1Help F10Quit']
      lines.forEach((line, index) => socket?.emitBytes(`${index === 0 ? '\u001b[?1049h\u001b[2J\u001b[H' : ''}${line}${index < lines.length - 1 ? '\r\n' : ''}`))
    }
    window.__emitPresenceEnded = () => {
      const socket = window.__terminalExperience.sockets.find((item) => item.url.includes('/ws/events'))
      socket?.emitControl({ type: 'session_presence_changed', tenantId: 1, hostId: pendingHost.id, sessionId: 99101, userId: 1, action: 'ended', changedAt: new Date().toISOString() })
    }
    addEventListener('error', (event) => window.__terminalExperience.errors.push(String(event.message)))
    addEventListener('unhandledrejection', (event) => window.__terminalExperience.errors.push(String(event.reason)))
  }, { token: fakeJwt(), pendingHost: host })

  let accessMapActive = true
  let currentHost = structuredClone(host)
  const hostUpdates = []
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/v1/sessions/access-map') body = {
      generatedAt: new Date().toISOString(), refreshAfterSeconds: 5,
      totals: { activeSessions: accessMapActive ? 1 : 0, activeHosts: accessMapActive ? 1 : 0, uniqueUsers: accessMapActive ? 1 : 0, concurrentHosts: 0 },
      hosts: accessMapActive ? [{ host: currentHost, activeSessions: 1, uniqueUsers: 1, oldestStartedAt: new Date().toISOString(), lastStartedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), sessions: [{ id: 99101, user: { id: 1, name: 'Admin', email: 'admin@test', avatarUrl: null, avatarVersion: null }, startedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), durationSeconds: 1, connectionMethod: 'direct', accessType: 'authenticated', clientIp: null, agentRemoteIp: null, agentNameSnapshot: null }] }] : [],
    }
    else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 1, global: 1, unfiled: 1, maxHosts: null, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else if (path === '/api/v1/hosts/sidebar-summary') body = { all: 1, global: 1, unfiled: 1, maxHosts: null, folders: {}, groups: {}, tags: {} }
    else if (path === `/api/v1/hosts/${host.id}` && route.request().method() === 'PATCH') {
      const update = route.request().postDataJSON()
      hostUpdates.push(update)
      currentHost = { ...currentHost, ...update }
      body = currentHost
    }
    else if (path === `/api/v1/hosts/${host.id}`) body = currentHost
    else if (path === '/api/v1/hosts') body = { data: [currentHost], total: 1, page: 1, limit: 50 }
    else if (path === '/api/v1/features') body = { multiConnect: true, sessionAuditLicensed: true, agentsLicensed: true, secretsLicensed: true, snippetsLicensed: true, portForwardingLicensed: true, feedbackLicensed: true, localAiLicensed: true, mcpLicensed: true, sharedSessions: { expiryMinutes: [2, 5, 10, 30] } }
    else if (path.includes('/preferences')) body = null
    else if (path.includes('/snippets')) body = { data: [], total: 0, page: 1, limit: 50 }
    else if (path === '/api/v1/inventory' || path === '/api/v1/forwardings') body = []
    else if (path.includes('/port-forwardings')) body = []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Log.enable'), cdp.send('Network.enable'), cdp.send('Performance.enable')])
  const cdpAnomalies = []
  cdp.on('Runtime.exceptionThrown', (event) => {
    const detail = event.exceptionDetails
    const description = detail.exception?.description || detail.exception?.value || detail.text
    cdpAnomalies.push(`runtime:${description}@${detail.url || 'unknown'}:${detail.lineNumber ?? 0}`)
  })
  cdp.on('Log.entryAdded', (event) => {
    if (event.entry.level === 'error') cdpAnomalies.push(`log:${event.entry.text}`)
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
  if (layout.errors.length) throw new Error(`Erros no browser: ${layout.errors.join('; ')}`)
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
  if (cdpAnomalies.length) throw new Error(`Anomalias CDP: ${cdpAnomalies.join('; ')}`)
  const report = { changeId: 'NA-0014', frontend: FRONTEND, result: 'passed', initialFont, zoomedFont: initialFont + 1, zoomBounds: { min: 10, max: 24 }, before, layout, htopRenderMs, hostEdit: { updates: hostUpdates, nameOnlyKeptSession: true, connectionChangeReconnected: true, mobileModalFits: true }, cdp: { anomalies: cdpAnomalies, metrics: Object.fromEntries(performanceMetrics.metrics.filter((metric) => ['JSHeapUsedSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount'].includes(metric.name)).map((metric) => [metric.name, metric.value])) }, presenceEndedImmediately: true, screenshot: SCREENSHOT_PATH }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
