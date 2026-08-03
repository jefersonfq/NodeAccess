#!/usr/bin/env node
/*
 * Real terminal dimensions/fidelity check via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9360 --user-data-dir=/tmp/nodeaccess-terminal-cdp \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9360 \
 *     node tools/frontend/terminal-cdp-real-flow.cjs
 *
 * Optional:
 *   HOST_ID=123
 *   RUN_COMMANDS=1
 *   REPORT_PATH=/tmp/nodeaccess-terminal-cdp-real.json
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9360'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || '1')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nodeaccess.local'
const TENANT_ID = Number(process.env.TENANT_ID || '1')
const HOST_ID = Number(process.env.HOST_ID || '0')
const RUN_COMMANDS = process.env.RUN_COMMANDS === '1'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-cdp-real.json'

function readJwtSecret() {
  const envPath = process.env.BACKEND_ENV_PATH || path.join(REPO_ROOT, 'apps/backend/.env')
  const envFile = fs.readFileSync(envPath, 'utf8')
  const match = envFile.match(/^JWT_SECRET=(.+)$/m)
  if (!match) throw new Error(`JWT_SECRET not found in ${envPath}`)
  return match[1].trim().replace(/^"|"$/g, '')
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(payload, secret, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64Url(JSON.stringify({ iat: now, exp: now + ttlSeconds, ...payload }))
  const data = `${header}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

function requestJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function getPageWebSocketUrl() {
  try {
    const created = await requestJson(`${CDP_BASE}/json/new?${encodeURIComponent(`${FRONTEND}/about:blank`)}`, 'PUT')
    if (created?.webSocketDebuggerUrl) return created.webSocketDebuggerUrl
  } catch {
    // Older Chromium builds may not allow /json/new. Fall back to an existing page.
  }
  const targets = await getJson(`${CDP_BASE}/json`)
  const page = Array.isArray(targets)
    ? targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    : null
  if (!page?.webSocketDebuggerUrl) throw new Error('No CDP page target found')
  return page.webSocketDebuggerUrl
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timeout } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(timeout)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
        return
      }
      if (msg.method) this.events.push({ at: Date.now(), ...msg })
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 20000)
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  close() {
    this.ws.close()
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'Runtime exception'
    throw new Error(String(detail))
  }
  return result.result?.value
}

async function waitFor(cdp, expression, timeoutMs = 15000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"', 15000)
}

async function api(cdp, token, method, pathName, body) {
  const headers = { authorization: `Bearer ${token}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const result = await evaluate(cdp, `
    (async () => {
      const response = await fetch(${JSON.stringify(`/api/v1${pathName}`)}, {
        method: ${JSON.stringify(method)},
        headers: ${JSON.stringify(headers)},
        body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data };
    })()
  `)
  if (!result.ok) throw new Error(`${method} ${pathName} failed with ${result.status}: ${JSON.stringify(result.data)}`)
  return result.data
}

async function resolveHost(cdp, token) {
  if (HOST_ID) {
    const data = await api(cdp, token, 'GET', `/hosts/${HOST_ID}`)
    return data
  }
  const list = await api(cdp, token, 'GET', '/hosts?page=1&limit=50')
  const hosts = Array.isArray(list?.data) ? list.data : []
  const host = hosts.find((item) => ['SSH', 'ssh', undefined, null, ''].includes(item.accessProtocol))
    || hosts.find((item) => item.id)
  if (!host) throw new Error('No SSH host found. Set HOST_ID explicitly.')
  return host
}

async function collectTerminalSnapshot(cdp, label) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const container = document.querySelector('[data-terminal-container="true"]')
    const xterm = document.querySelector('.xterm')
    const screen = document.querySelector('.xterm-screen')
    const rows = Number(container?.getAttribute('data-terminal-rows') || 0)
    const cols = Number(container?.getAttribute('data-terminal-cols') || 0)
    const rect = container?.getBoundingClientRect()
    const xtermRect = xterm?.getBoundingClientRect()
    const screenRect = screen?.getBoundingClientRect()
    const rowHeight = rows > 0 && screenRect ? screenRect.height / rows : 0
    const expectedRows = rowHeight > 0 && rect ? Math.floor(rect.height / rowHeight) : 0
    return {
      label: ${JSON.stringify(label)},
      href: location.href,
      bodyTextStart: document.body.innerText.slice(0, 800),
      statusText: [...document.querySelectorAll('[class]')].map((el) => normalize(el.textContent)).find((text) => /Conect|connected|Erro|error|Sessão encerrada/i.test(text)) || null,
      container: rect ? {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        rows,
        cols,
        dataWidth: Number(container?.getAttribute('data-terminal-width') || 0),
        dataHeight: Number(container?.getAttribute('data-terminal-height') || 0),
        resizeSentAt: container?.getAttribute('data-terminal-resize-sent-at') || null,
      } : null,
      xterm: xtermRect ? { width: Math.round(xtermRect.width), height: Math.round(xtermRect.height) } : null,
      screen: screenRect ? { width: Math.round(screenRect.width), height: Math.round(screenRect.height), expectedRows } : null,
      hasTerminal: Boolean(container && xterm && screen),
    }
  })()`)
}

async function insertText(cdp, text) {
  await cdp.send('Input.insertText', { text })
}

async function main() {
  const cdp = new Cdp(await getPageWebSocketUrl())
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })

  const token = signJwt({
    stage: 'authenticated',
    sub: String(ADMIN_USER_ID),
    userId: ADMIN_USER_ID,
    tenantId: TENANT_ID,
    role: 'admin',
    email: ADMIN_EMAIL,
  }, readJwtSecret())

  await navigate(cdp, `${FRONTEND}/hosts?cdp=${Date.now()}`)
  await evaluate(cdp, `
    localStorage.setItem('na_access_token', ${JSON.stringify(token)});
    localStorage.setItem('na_refresh_token', 'cdp-dev-refresh-placeholder');
  `)
  const host = await resolveHost(cdp, token)
  await evaluate(cdp, `
    sessionStorage.setItem('na:pending-terminal-host', ${JSON.stringify(JSON.stringify({
      id: host.id,
      name: host.name,
      ip: host.ip,
      port: host.port,
      authType: host.authType,
      accessProtocol: host.accessProtocol || 'SSH',
    }))});
  `)
  await navigate(cdp, `${FRONTEND}/terminal?cdp=${Date.now()}`)
  await waitFor(cdp, `document.querySelector('[data-terminal-container="true"]')`, 20000)
  await new Promise((resolve) => setTimeout(resolve, 1800))
  const initial = await collectTerminalSnapshot(cdp, 'initial')

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await new Promise((resolve) => setTimeout(resolve, 900))
  const afterStableResize = await collectTerminalSnapshot(cdp, 'after-stable-resize')

  let commandSnapshot = null
  if (RUN_COMMANDS) {
    await evaluate(cdp, `document.querySelector('.xterm-helper-textarea')?.focus()`)
    await insertText(cdp, 'printf "__NA_BEGIN__"; stty size; printf "__NA_END__"\\r')
    await new Promise((resolve) => setTimeout(resolve, 1800))
    commandSnapshot = await collectTerminalSnapshot(cdp, 'after-stty-size')
  }

  const findings = []
  for (const snapshot of [initial, afterStableResize]) {
    if (!snapshot.hasTerminal) findings.push(`${snapshot.label}: xterm/container nao encontrado`)
    if ((snapshot.container?.height || 0) < 360) findings.push(`${snapshot.label}: altura de container baixa (${snapshot.container?.height || 0}px)`)
    if ((snapshot.container?.rows || 0) < 24) findings.push(`${snapshot.label}: rows baixo para terminal real (${snapshot.container?.rows || 0})`)
    const expectedRows = snapshot.screen?.expectedRows || 0
    const actualRows = snapshot.container?.rows || 0
    if (expectedRows > 0 && Math.abs(expectedRows - actualRows) > 2) {
      findings.push(`${snapshot.label}: rows xterm (${actualRows}) diverge da altura util estimada (${expectedRows})`)
    }
    if (snapshot.container && snapshot.screen && snapshot.screen.height < snapshot.container.height * 0.82) {
      findings.push(`${snapshot.label}: tela xterm ocupa pouca altura do container (${snapshot.screen.height}/${snapshot.container.height})`)
    }
  }

  const report = {
    ok: findings.length === 0,
    startedAt: new Date().toISOString(),
    frontend: FRONTEND,
    cdp: CDP_BASE,
    host: { id: host.id, name: host.name, ip: host.ip, port: host.port, accessProtocol: host.accessProtocol },
    runCommands: RUN_COMMANDS,
    snapshots: { initial, afterStableResize, commandSnapshot },
    findings,
    finishedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    host: report.host,
    findings,
    snapshots: {
      initial: initial.container,
      afterStableResize: afterStableResize.container,
      commandSnapshot: commandSnapshot?.container ?? null,
    },
  }, null, 2))
  cdp.close()
  if (!report.ok) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
