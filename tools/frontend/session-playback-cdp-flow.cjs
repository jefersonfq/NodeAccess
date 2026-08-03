#!/usr/bin/env node
/*
 * Session playback UX/performance check via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9347 --user-data-dir=/tmp/nodeaccess-playback-cdp \
 *     --window-size=1440,1000 about:blank
 *
 *   node tools/frontend/session-playback-cdp-flow.cjs
 *
 * Useful env vars:
 *   FRONTEND_BASE=http://127.0.0.1:5173
 *   CDP_BASE=http://127.0.0.1:9347
 *   ADMIN_USER_ID=1
 *   ADMIN_EMAIL=admin@nodeaccess.local
 *   TENANT_ID=1
 *   SESSION_ID=4177
 *   REPORT_PATH=/tmp/nodeaccess-session-playback-cdp.json
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9347'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const ADMIN_USER_ID = Number(process.env.ADMIN_USER_ID || '1')
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@nodeaccess.local'
const TENANT_ID = Number(process.env.TENANT_ID || '1')
const SESSION_ID = Number(process.env.SESSION_ID || '0')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-session-playback-cdp.json'
const PLAYBACK_EVENT_LIMIT = Number(process.env.PLAYBACK_EVENT_LIMIT || '5000')

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

async function waitFor(cdp, expression, timeoutMs = 12000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function api(cdp, token, method, pathName, body) {
  const startedAt = Date.now()
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
  return { data: result.data, durationMs: Date.now() - startedAt }
}

async function navigate(cdp, url) {
  const startedAt = Date.now()
  await cdp.send('Page.navigate', { url })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"', 15000)
  return Date.now() - startedAt
}

function summarizeNetwork(events) {
  const requests = new Map()
  const responses = new Map()
  const failures = []
  for (const event of events) {
    const params = event.params || {}
    const requestId = params.requestId
    if (event.method === 'Network.requestWillBeSent' && params.request?.url?.includes('/api/')) {
      requests.set(requestId, { at: event.at, method: params.request.method, url: params.request.url })
    } else if (event.method === 'Network.responseReceived' && requestId && params.response?.url?.includes('/api/')) {
      responses.set(requestId, { at: event.at, status: params.response.status, url: params.response.url })
    } else if (event.method === 'Network.loadingFailed' && requestId) {
      failures.push({ requestId, errorText: params.errorText, canceled: !!params.canceled })
    }
  }
  const calls = [...requests.entries()].map(([requestId, request]) => {
    const response = responses.get(requestId)
    return {
      method: request.method,
      url: request.url.replace(FRONTEND, ''),
      status: response?.status ?? null,
      durationMs: response ? response.at - request.at : null,
    }
  })
  return { calls, failures }
}

async function resolveSession(cdp, token) {
  if (SESSION_ID) {
    const [detail, preview, commands] = await Promise.all([
      api(cdp, token, 'GET', `/session-audit/${SESSION_ID}`),
      api(cdp, token, 'GET', `/session-audit/${SESSION_ID}/preview?limit=${PLAYBACK_EVENT_LIMIT}`),
      api(cdp, token, 'GET', `/session-audit/${SESSION_ID}/commands?limit=100`),
    ])
    return { detail: detail.data, preview: preview.data, commands: commands.data }
  }

  const list = await api(cdp, token, 'GET', '/session-audit?page=1&limit=20')
  const candidates = list.data?.data || []
  let fallback = null
  for (const item of candidates) {
    if (Number(item.chunkCount || 0) <= 0) continue
    const [preview, commands] = await Promise.all([
      api(cdp, token, 'GET', `/session-audit/${item.sessionId}/preview?limit=${PLAYBACK_EVENT_LIMIT}`),
      api(cdp, token, 'GET', `/session-audit/${item.sessionId}/commands?limit=100`),
    ])
    if ((preview.data || []).length <= 0) continue
    if ((commands.data || []).length > 0) return { detail: item, preview: preview.data, commands: commands.data }
    fallback ??= { detail: item, preview: preview.data, commands: commands.data }
  }
  if (fallback) return fallback
  throw new Error('No audited session with preview events found. Set SESSION_ID explicitly.')
}

async function collectPlaybackSnapshot(cdp, label) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const tabs = [...document.querySelectorAll('[role="tab"], .n-tabs-tab')]
      .map((el) => normalize(el.textContent))
      .filter(Boolean)
    const buttons = [...document.querySelectorAll('button')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return { text: normalize(el.textContent), width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 }
      })
      .filter((item) => item.visible)
    const terminal = [...document.querySelectorAll('[data-playback-terminal], pre')]
      .map((el) => ({ el, text: el.textContent || '', rect: el.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 80 && item.rect.height > 250)
      .sort((a, b) => b.rect.height - a.rect.height)[0]
    const timelineMarkers = [...document.querySelectorAll('[data-playback-marker]')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          key: el.getAttribute('data-playback-marker'),
          text: normalize(el.textContent),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: rect.width > 0 && rect.height > 0,
        }
      })
      .filter((item) => item.visible)
    const hasControlNoise = (text) =>
      text.includes('␛')
      || text.includes(String.fromCharCode(27))
      || /\\[[0-9;?]{1,12}[A-Za-z]/.test(text)
    const activeAuditTab = document.querySelector('[data-active-audit-tab]')?.getAttribute('data-active-audit-tab') || null
    const cards = [...document.querySelectorAll('.na-item, .n-card, .na-panel')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return { text: normalize(el.textContent).slice(0, 120), top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      })
      .filter((item) => item.width > 0 && item.height > 0)
    const viewportWidth = document.documentElement.clientWidth
    const isClippedInsideViewport = (el) => {
      let current = el.parentElement
      while (current && current !== document.body) {
        const style = getComputedStyle(current)
        const clipsX = ['auto', 'hidden', 'scroll', 'clip'].includes(style.overflowX)
        if (clipsX) {
          const rect = current.getBoundingClientRect()
          if (rect.right <= viewportWidth + 2) return true
        }
        current = current.parentElement
      }
      return false
    }
    const overflowing = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.right > viewportWidth + 2 && !isClippedInsideViewport(el)
      })
      .slice(0, 8)
      .map((el) => ({ tag: el.tagName, text: normalize(el.textContent).slice(0, 80), right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) }))
    const perf = window.__playbackPerf || {}
    const longTasks = perf.longTasks || []
    const layoutShifts = perf.layoutShifts || []
    return {
      label: ${JSON.stringify(label)},
      href: location.href,
      bodyHasLogin: /entrar|login/i.test(document.body.innerText.slice(0, 400)),
      bodyTextStart: document.body.innerText.slice(0, 500),
      tabs,
      activeAuditTab,
      buttons,
      terminal: terminal ? {
        textLength: terminal.text.length,
        lineCount: terminal.text.split('\\n').length,
        width: Math.round(terminal.rect.width),
        height: Math.round(terminal.rect.height),
        mode: terminal.el.getAttribute('data-playback-mode') || null,
        cursorIndex: Number(terminal.el.getAttribute('data-playback-cursor-index') || 0),
        timelineLength: Number(terminal.el.getAttribute('data-playback-timeline-length') || 0),
        hasControlNoise: hasControlNoise(terminal.text),
        text: terminal.text.slice(0, 50000),
        textStart: terminal.text.slice(0, 300),
        textEnd: terminal.text.slice(-300),
      } : null,
      timelineMarkers,
      overflowing,
      nodeCount: document.getElementsByTagName('*').length,
      cardCount: cards.length,
      longTaskCount: longTasks.length,
      longTaskTotalMs: Math.round(longTasks.reduce((total, item) => total + item.duration, 0)),
      longestLongTaskMs: Math.round(longTasks.reduce((max, item) => Math.max(max, item.duration), 0)),
      layoutShiftCount: layoutShifts.length,
      layoutShiftTotal: Number(layoutShifts.reduce((total, item) => total + item.value, 0).toFixed(4)),
    }
  })()`)
}

async function collectCommandsSnapshot(cdp, label) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const hasControlNoise = (text) =>
      text.includes('␛')
      || text.includes(String.fromCharCode(27))
      || /\\[[0-9;?]{1,12}[A-Za-z]/.test(text)
    const rows = [...document.querySelectorAll('[data-audit-command-row="true"]')]
      .map((row) => {
        const commandEl = row.querySelector('[data-audit-command-text="true"]')
        const outputEl = row.querySelector('[data-audit-command-output="true"]')
        const rect = row.getBoundingClientRect()
        return {
          index: Number(row.getAttribute('data-command-index') || 0),
          confidence: row.getAttribute('data-command-confidence'),
          command: normalize(commandEl?.textContent),
          output: outputEl ? outputEl.textContent || '' : '',
          outputTextLength: outputEl ? (outputEl.textContent || '').length : 0,
          hasControlNoise: hasControlNoise(row.textContent || ''),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      })
    const actionButtons = [...document.querySelectorAll('button')]
      .map((button) => normalize(button.textContent))
      .filter((text) => /Ver no playback|View in playback/.test(text))
    return {
      label: ${JSON.stringify(label)},
      activeAuditTab: document.querySelector('[data-active-audit-tab]')?.getAttribute('data-active-audit-tab') || null,
      rowCount: rows.length,
      actionCount: actionButtons.length,
      lowConfidenceCount: rows.filter((row) => row.confidence === 'low').length,
      controlNoiseRows: rows.filter((row) => row.hasControlNoise).map((row) => ({ index: row.index, command: row.command })).slice(0, 10),
      rows,
      firstCommands: rows.slice(0, 8),
      lastCommands: rows.slice(-5),
    }
  })()`)
}

function normalizeAuditComparable(value) {
  return String(value || '')
    .replace(/\[[Tt]ab\]/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function commandNeedles(command) {
  const normalized = normalizeAuditComparable(command)
  if (!normalized) return []
  const parts = normalized.split(/\s+/).filter(Boolean)
  const needles = [normalized]
  if (parts.length > 1) needles.push(`${parts[0]} ${parts[parts.length - 1]}`)
  else needles.push(parts[0])
  return [...new Set(needles)].filter((needle) => needle.length >= 2)
}

function meaningfulOutputNeedles(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length >= 12
      && !/^(?:saida interativa|interactive screen|sem saida|no output)/i.test(line)
      && !/^\[[^\]]+\]$/.test(line)
    )
    .slice(0, 20)
}

function collectCommandPlaybackConsistency(scenario, apiCommands) {
  const playbackText = scenario.afterLoadEnd.terminal?.text || scenario.initial.terminal?.text || ''
  const normalizedPlayback = normalizeAuditComparable(playbackText)
  const rows = scenario.commandsSnapshot.rows || []
  const apiRows = Array.isArray(apiCommands) ? apiCommands : []
  const sourceRows = rows.length > 0 ? rows : apiRows
  const missingCommands = []
  const missingOutputNeedles = []
  const apiByCommand = new Map(apiRows.map((command) => [normalizeAuditComparable(command.command), command]))

  for (const row of sourceRows) {
    const command = row.command || ''
    const hasCommand = commandNeedles(command).some((needle) => normalizedPlayback.includes(needle))
    if (!hasCommand) missingCommands.push({ index: row.index, command })

    const apiCommand = apiByCommand.get(normalizeAuditComparable(command))
    const output = row.output || apiCommand?.output || ''
    for (const needle of meaningfulOutputNeedles(output)) {
      if (!normalizedPlayback.includes(normalizeAuditComparable(needle))) {
        missingOutputNeedles.push({ index: row.index, command, sample: needle.slice(0, 160) })
      }
    }
  }

  const commandOutputCorpus = normalizeAuditComparable(apiRows.map((command) => command.output || '').join('\n'))
  const orphanDiagnosticLines = playbackText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      /\b(?:DEBUG|DDEBUG|INFO|WARN|ERROR)\b/.test(line)
      && !commandOutputCorpus.includes(normalizeAuditComparable(line).slice(0, 80))
    )
    .slice(0, 12)

  return {
    playbackTextLength: playbackText.length,
    commandRows: sourceRows.length,
    missingCommands,
    missingOutputNeedles: missingOutputNeedles.slice(0, 12),
    orphanDiagnosticLines,
  }
}

async function clickByText(cdp, text) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const candidates = [...document.querySelectorAll('button, [role="tab"], .n-tabs-tab, a')]
      .map((el) => ({ el, text: normalize(el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0 && item.text.includes(${JSON.stringify(text)}))
    const target = candidates[0]
    if (!target) return { clicked: false, reason: 'not-found', text: ${JSON.stringify(text)} }
    target.el.click()
    return { clicked: true, text: target.text }
  })()`)
}

async function clickButtonByText(cdp, text) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const candidates = [...document.querySelectorAll('button')]
      .map((el) => ({ el, text: normalize(el.textContent), rect: el.getBoundingClientRect() }))
      .filter((item) => item.rect.width > 0 && item.rect.height > 0)
    const target = candidates.find((item) => item.text === ${JSON.stringify(text)})
      || candidates.find((item) => item.text.includes(${JSON.stringify(text)}))
    if (!target) return { clicked: false, reason: 'not-found', text: ${JSON.stringify(text)}, buttons: candidates.map((item) => item.text).slice(0, 20) }
    target.el.click()
    return { clicked: true, text: target.text }
  })()`)
}

async function clickFirstCommandPlaybackAction(cdp) {
  return evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const meaningfulOutputNeedles = (output) => String(output || '')
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter((line) =>
        line.length >= 12
        && !/^(?:saida interativa|interactive screen|sem saida|no output)/i.test(line)
        && !/^\\[[^\\]]+\\]$/.test(line)
      )
      .slice(0, 5)
    const rows = [...document.querySelectorAll('[data-audit-command-row="true"]')]
      .map((row) => {
        const rect = row.getBoundingClientRect()
        const output = row.querySelector('[data-audit-command-output="true"]')?.textContent || ''
        const button = [...row.querySelectorAll('button')]
          .find((item) => /Ver no playback|View in playback/.test(normalize(item.textContent)))
        return {
          row,
          button,
          index: Number(row.getAttribute('data-command-index') || 0),
          command: normalize(row.querySelector('[data-audit-command-text="true"]')?.textContent),
          output,
          outputNeedles: meaningfulOutputNeedles(output),
          visible: rect.width > 0 && rect.height > 0,
        }
      })
    const target = rows.find((row) => row.visible && row.button && row.outputNeedles.length > 0)
      || rows.find((row) => row.visible && row.button)
    if (!target?.button) {
      return {
        clicked: false,
        reason: 'not-found',
        rows: rows.map((row) => ({ index: row.index, command: row.command, outputNeedles: row.outputNeedles.length })).slice(0, 10),
      }
    }
    target.button.click()
    return {
      clicked: true,
      index: target.index,
      command: target.command,
      outputNeedles: target.outputNeedles,
    }
  })()`)
}

async function clickPlaybackAction(cdp, action) {
  return evaluate(cdp, `(() => {
    const target = document.querySelector(\`[data-playback-action="${action}"]\`)
    if (!target) return { clicked: false, reason: 'not-found', action: ${JSON.stringify(action)} }
    const rect = target.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return { clicked: false, reason: 'not-visible', action: ${JSON.stringify(action)} }
    target.click()
    return { clicked: true, action: ${JSON.stringify(action)}, text: (target.textContent || '').replace(/\\s+/g, ' ').trim() }
  })()`)
}

async function runViewportScenario(cdp, sessionId, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  })
  cdp.events.length = 0
  const navMs = await navigate(cdp, `${FRONTEND}/admin/session-audit/${sessionId}?tab=playback&cdp=${Date.now()}`)
  await waitFor(cdp, `!location.pathname.includes('/login') && document.body.innerText.includes('Playback')`, 20000)
  let deepLinkActivated = true
  try {
    await waitFor(cdp, `document.body.innerText.includes('Terminal fake') || document.body.innerText.includes('Fake terminal')`, 2500)
  } catch {
    deepLinkActivated = false
    await clickByText(cdp, 'Playback')
    await waitFor(cdp, `document.body.innerText.includes('Terminal fake') || document.body.innerText.includes('Fake terminal')`, 10000)
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
  const initial = await collectPlaybackSnapshot(cdp, `${viewport.name}:initial`)
  let playClick = await clickPlaybackAction(cdp, 'play')
  if (!playClick.clicked) playClick = await clickButtonByText(cdp, initial.bodyTextStart.includes('Pausar') ? 'Pausar' : 'Play')
  await new Promise((resolve) => setTimeout(resolve, 180))
  const afterPlayStart = await collectPlaybackSnapshot(cdp, `${viewport.name}:after-play-start`)
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const afterPlay = await collectPlaybackSnapshot(cdp, `${viewport.name}:after-play`)
  const loadEndClick = await clickPlaybackAction(cdp, 'load-end')
  if (!loadEndClick.clicked) await clickButtonByText(cdp, initial.bodyTextStart.includes('Carregar final') ? 'Carregar final' : 'Load end')
  await new Promise((resolve) => setTimeout(resolve, 350))
  const afterLoadEnd = await collectPlaybackSnapshot(cdp, `${viewport.name}:after-load-end`)

  const commandJump = await evaluate(cdp, `(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim()
    const commandsTab = [...document.querySelectorAll('[role="tab"], .n-tabs-tab')]
      .find((el) => /Comandos|Commands/.test(normalize(el.textContent)))
    commandsTab?.click()
    return Boolean(commandsTab)
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const commandsSnapshot = await collectCommandsSnapshot(cdp, `${viewport.name}:commands`)
  const jumpClick = await clickFirstCommandPlaybackAction(cdp)
  if (!jumpClick.clicked) {
    const fallbackJumpClick = await clickByText(cdp, initial.bodyTextStart.includes('Terminal fake') ? 'Ver no playback' : 'View in playback')
    jumpClick.fallback = fallbackJumpClick
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  const afterJump = await collectPlaybackSnapshot(cdp, `${viewport.name}:after-command-jump`)

  return {
    viewport,
    navMs,
    deepLinkActivated,
    initial,
    playClick,
    afterPlayStart,
    afterPlay,
    afterLoadEnd,
    commandJumpTabClicked: commandJump,
    commandsSnapshot,
    jumpClick,
    afterJump,
    network: summarizeNetwork(cdp.events),
  }
}

async function main() {
  const targets = await getJson(`${CDP_BASE}/json/list`)
  const target = targets.find((item) => item.type === 'page') || targets[0]
  if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP page target found at ${CDP_BASE}`)

  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const token = signJwt({
    sub: ADMIN_USER_ID,
    email: ADMIN_EMAIL,
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: TENANT_ID,
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
  }, readJwtSecret())

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__playbackPerf = { longTasks: [], layoutShifts: [] };
      try {
        new PerformanceObserver((list) => {
          window.__playbackPerf.longTasks.push(...list.getEntries().map((entry) => ({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          })).slice(-100));
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      try {
        new PerformanceObserver((list) => {
          window.__playbackPerf.layoutShifts.push(...list.getEntries()
            .filter((entry) => !entry.hadRecentInput)
            .map((entry) => ({ startTime: entry.startTime, value: entry.value })).slice(-100));
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
      localStorage.setItem('na_access_token', ${JSON.stringify(token)});
      localStorage.setItem('na_refresh_token', 'cdp-dev-refresh-placeholder');
    `,
  })

  await navigate(cdp, `${FRONTEND}/admin/session-audit?cdp=${Date.now()}`)
  await waitFor(cdp, '!location.pathname.includes("/login")', 15000)
  const session = await resolveSession(cdp, token)
  const listSnapshot = await collectPlaybackSnapshot(cdp, 'list')
  const scenarios = []
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000, mobile: false },
    { name: 'narrow', width: 390, height: 900, mobile: true },
  ]) {
    scenarios.push(await runViewportScenario(cdp, session.detail.sessionId, viewport))
  }

  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .slice(-30)

  const findings = []
  for (const scenario of scenarios) {
    scenario.commandPlaybackConsistency = collectCommandPlaybackConsistency(scenario, session.commands)
    if (!scenario.deepLinkActivated) findings.push(`${scenario.viewport.name}: deep link ?tab=playback nao ativou a aba sem clique manual`)
    if (!scenario.initial.terminal) findings.push(`${scenario.viewport.name}: terminal fake nao encontrado`)
    if (scenario.initial.terminal?.hasControlNoise) findings.push(`${scenario.viewport.name}: terminal fake contem sequencias ANSI/controle visiveis`)
    if (scenario.initial.overflowing.length > 0) findings.push(`${scenario.viewport.name}: overflow horizontal detectado`)
    if (session.commands.length > 0 && scenario.commandsSnapshot.rowCount === 0) findings.push(`${scenario.viewport.name}: aba Comandos sem linhas renderizadas`)
    if (session.commands.length > 0 && scenario.commandsSnapshot.actionCount === 0) findings.push(`${scenario.viewport.name}: aba Comandos sem acao Ver no playback`)
    if (session.commands.length > 0 && scenario.initial.timelineMarkers.length < session.commands.length + 1) {
      findings.push(`${scenario.viewport.name}: timeline do playback sem marcadores suficientes`)
    }
    if (scenario.commandsSnapshot.controlNoiseRows.length > 0) findings.push(`${scenario.viewport.name}: aba Comandos contem sequencias ANSI/controle visiveis`)
    if (!scenario.playClick.clicked) findings.push(`${scenario.viewport.name}: botao Play nao foi acionado pelo harness`)
    const initialCursorIndex = scenario.initial.terminal?.cursorIndex || 0
    const timelineLength = scenario.initial.terminal?.timelineLength || 0
    const openedNearEnd = timelineLength > 0 && initialCursorIndex >= timelineLength * 0.75
    if (openedNearEnd) findings.push(`${scenario.viewport.name}: Playback abriu perto do fim em vez de iniciar no começo da timeline`)
    if (
      scenario.playClick.clicked
      && openedNearEnd
      && (scenario.afterPlayStart.terminal?.cursorIndex || 0) >= initialCursorIndex
    ) {
      findings.push(`${scenario.viewport.name}: Play no fim nao reiniciou/limpou o playback antes de reproduzir`)
    }
    const earlyPlaybackCommandCount = (scenario.afterPlayStart.terminal?.text.match(/^\$\s+\S/gm) || []).length
    if (scenario.playClick.clicked && earlyPlaybackCommandCount > 1) {
      findings.push(`${scenario.viewport.name}: Play mostrou ${earlyPlaybackCommandCount} comandos logo no inicio da reproducao`)
    }
    if (
      scenario.playClick.clicked
      && (scenario.afterPlay.terminal?.textLength || 0) < (scenario.afterPlayStart.terminal?.textLength || 0)
    ) {
      findings.push(`${scenario.viewport.name}: Playback reduziu conteudo durante reproducao`)
    }
    if (scenario.commandPlaybackConsistency.missingCommands.length > 0) {
      findings.push(`${scenario.viewport.name}: Playback nao contem ${scenario.commandPlaybackConsistency.missingCommands.length} comando(s) da aba Comandos`)
    }
    if (scenario.commandPlaybackConsistency.missingOutputNeedles.length > 0) {
      findings.push(`${scenario.viewport.name}: Playback nao contem ${scenario.commandPlaybackConsistency.missingOutputNeedles.length} amostra(s) de saida da aba Comandos`)
    }
    if (scenario.commandPlaybackConsistency.orphanDiagnosticLines.length > 0) {
      findings.push(`${scenario.viewport.name}: Playback contem linhas DEBUG/INFO sem correspondencia na aba Comandos`)
    }
    if (!scenario.jumpClick.clicked && !scenario.jumpClick.fallback?.clicked && session.commands.length > 0) findings.push(`${scenario.viewport.name}: acao Ver no playback nao acionada`)
    if (scenario.jumpClick.clicked && scenario.jumpClick.outputNeedles?.length > 0) {
      const afterJumpText = normalizeAuditComparable(scenario.afterJump.terminal?.text || '')
      const hasClickedOutput = scenario.jumpClick.outputNeedles
        .some((needle) => afterJumpText.includes(normalizeAuditComparable(needle)))
      if (!hasClickedOutput) {
        findings.push(`${scenario.viewport.name}: clique em comando #${scenario.jumpClick.index} nao mostrou amostra da saida no playback`)
      }
    }
    if ((scenario.afterLoadEnd.terminal?.textLength || 0) < (scenario.initial.terminal?.textLength || 0)) findings.push(`${scenario.viewport.name}: Carregar final reduziu conteudo renderizado`)
    const unexpectedErrors = scenario.network.calls.filter((call) =>
      call.status
      && call.status >= 400
      && !call.url.includes('/api/v1/integrations/jira')
    )
    if (unexpectedErrors.length > 0) findings.push(`${scenario.viewport.name}: API 4xx/5xx inesperado`)
  }

  const report = {
    ok: findings.length === 0 && consoleErrors.length === 0,
    startedAt: new Date().toISOString(),
    environment: { frontendBase: FRONTEND, cdpBase: CDP_BASE, tenantId: TENANT_ID },
    session: {
      sessionId: session.detail.sessionId,
      status: session.detail.status,
      host: session.detail.hostNameSnapshot,
      user: session.detail.userNameSnapshot,
      chunkCount: session.detail.chunkCount,
      previewEvents: session.preview.length,
      commands: session.commands.length,
    },
    listSnapshot,
    scenarios,
    findings,
    consoleErrors,
    recommendations: [
      'Trocar a fonte do playback de preview limitado para endpoint completo /session-audit/:id/playback.',
      'Adicionar opcao de exibir horario por evento/comando no terminal fake para auditoria fina.',
      'Migrar o renderizador textual para xterm.js read-only quando o endpoint completo preservar ANSI/resize com fidelidade.',
      'Rodar tools/session-audit/reconstruction-fidelity.ts junto do CDP quando a mudanca tocar gateway, auditoria ou normalizador.',
      'Se o runner bloquear CDP ou tsx com EPERM em 127.0.0.1 ou /tmp/tsx-*.pipe, rerodar o mesmo comando com permissao elevada; isso e restricao do sandbox.',
    ],
    finishedAt: new Date().toISOString(),
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    session: report.session,
    findings: report.findings,
    summary: report.scenarios.map((scenario) => ({
      viewport: scenario.viewport.name,
      navMs: scenario.navMs,
      terminalTextLength: scenario.initial.terminal?.textLength ?? 0,
      afterLoadEndTextLength: scenario.afterLoadEnd.terminal?.textLength ?? 0,
      overflowCount: scenario.initial.overflowing.length,
      commandRows: scenario.commandsSnapshot.rowCount,
      commandActions: scenario.commandsSnapshot.actionCount,
      commandLowConfidence: scenario.commandsSnapshot.lowConfidenceCount,
      missingPlaybackCommands: scenario.commandPlaybackConsistency.missingCommands.length,
      missingPlaybackOutputSamples: scenario.commandPlaybackConsistency.missingOutputNeedles.length,
      orphanDiagnosticLines: scenario.commandPlaybackConsistency.orphanDiagnosticLines.length,
      longTaskTotalMs: scenario.initial.longTaskTotalMs,
      apiStatuses: scenario.network.calls.map((call) => call.status).filter(Boolean),
    })),
  }, null, 2))
  cdp.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
