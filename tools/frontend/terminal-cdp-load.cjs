#!/usr/bin/env node
/*
 * Terminal browser load harness via Chromium CDP.
 *
 * This exercises the real frontend terminal UI with multiple browser pages.
 * It uses profile.local.json tokens/hosts, opens /terminal, sends commands
 * through xterm, and observes WebSocket frames through CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9362 --user-data-dir=/tmp/nodeaccess-terminal-load-cdp \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9362 \
 *     CONCURRENCY=5 RUN_COMMANDS=1 node tools/frontend/terminal-cdp-load.cjs
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')
const WebSocket = require('ws')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9362'
const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const PROFILE_FILE = process.env.PROFILE_FILE || path.join(REPO_ROOT, 'tools/load-tests/data/profile.local.json')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-cdp-load.json'
const CONCURRENCY = numberEnv('CONCURRENCY', 5)
const START_STAGGER_MS = numberEnv('START_STAGGER_MS', 500)
const HOLD_MS = numberEnv('HOLD_MS', 15000)
const COMMAND_INTERVAL_MS = numberEnv('COMMAND_INTERVAL_MS', 5000)
const RUN_COMMANDS = process.env.RUN_COMMANDS !== '0'
const VIEWPORT_WIDTH = numberEnv('VIEWPORT_WIDTH', 1440)
const VIEWPORT_HEIGHT = numberEnv('VIEWPORT_HEIGHT', 1000)
const METRICS_INTERVAL_MS = numberEnv('METRICS_INTERVAL_MS', 1000)
const CDP_OPEN_TIMEOUT_MS = numberEnv('CDP_OPEN_TIMEOUT_MS', 15000)
const CDP_COMMAND_TIMEOUT_MS = numberEnv('CDP_COMMAND_TIMEOUT_MS', 45000)
const CDP_SETUP_RETRIES = numberEnv('CDP_SETUP_RETRIES', 2)
const DISK_PATHS = parseListEnv('DISK_PATHS', [REPO_ROOT, '/tmp'])
const CONTAINER_NAMES = parseListEnv('CONTAINER_NAMES', [])
const CONTAINER_NAME_PATTERN = new RegExp(process.env.CONTAINER_NAME_PATTERN || 'nodeaccess', 'i')

function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseListEnv(name, fallback) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = value.split(',').map((item) => item.trim()).filter(Boolean)
  return parsed.length > 0 ? [...new Set(parsed)] : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readCpuStat() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0]
  const values = line.trim().split(/\s+/).slice(1).map(Number)
  const idle = values[3] + (values[4] || 0)
  const total = values.reduce((sum, value) => sum + value, 0)
  return { idle, total }
}

function readMemInfo() {
  const content = fs.readFileSync('/proc/meminfo', 'utf8')
  const fields = Object.fromEntries(
    content.split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, value] = line.split(':')
        return [key, Number(value.trim().split(/\s+/)[0])]
      }),
  )
  const totalKb = fields.MemTotal || 0
  const availableKb = fields.MemAvailable || 0
  const usedKb = Math.max(0, totalKb - availableKb)
  return {
    totalMb: Math.round(totalKb / 1024),
    usedMb: Math.round(usedKb / 1024),
    availableMb: Math.round(availableKb / 1024),
    usedPercent: totalKb > 0 ? Math.round((usedKb / totalKb) * 1000) / 10 : 0,
  }
}

function readDiskInfo() {
  return DISK_PATHS.map((diskPath) => {
    try {
      const stats = fs.statfsSync(diskPath)
      const totalBytes = stats.blocks * stats.bsize
      const freeBytes = stats.bfree * stats.bsize
      const availableBytes = stats.bavail * stats.bsize
      const usedBytes = Math.max(0, totalBytes - freeBytes)
      return {
        path: diskPath,
        totalMb: Math.round(totalBytes / 1024 / 1024),
        usedMb: Math.round(usedBytes / 1024 / 1024),
        availableMb: Math.round(availableBytes / 1024 / 1024),
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
        ok: true,
      }
    } catch (error) {
      return { path: diskPath, ok: false, error: error.message }
    }
  })
}

function parsePercent(value) {
  const number = Number(String(value || '').replace('%', '').trim())
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0
}

function parseSizeToMb(value) {
  const match = String(value || '').trim().match(/^([\d.]+)\s*([KMGT]?i?B)?$/i)
  if (!match) return 0
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return 0
  const unit = (match[2] || 'B').toLowerCase()
  const multipliers = {
    b: 1 / 1024 / 1024,
    kb: 1 / 1024,
    kib: 1 / 1024,
    mb: 1,
    mib: 1,
    gb: 1024,
    gib: 1024,
    tb: 1024 * 1024,
    tib: 1024 * 1024,
  }
  return Math.round(amount * (multipliers[unit] || 0) * 10) / 10
}

function parseDockerMemoryUsage(value) {
  const [usedRaw = '0'] = String(value || '').split('/')
  return parseSizeToMb(usedRaw.trim())
}

function shouldIncludeContainer(row) {
  if (CONTAINER_NAMES.length > 0) return CONTAINER_NAMES.includes(row.Name)
  return CONTAINER_NAME_PATTERN.test(row.Name || '')
}

function readContainerStats() {
  const result = spawnSync('docker', ['stats', '--no-stream', '--format', '{{json .}}'], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || result.stderr?.trim() || `docker stats exited with ${result.status}`,
      containers: [],
    }
  }
  const containers = result.stdout.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
    .filter(shouldIncludeContainer)
    .map((row) => ({
      id: row.Container || '',
      name: row.Name || '',
      cpuPercent: parsePercent(row.CPUPerc),
      memoryPercent: parsePercent(row.MemPerc),
      memoryUsedMb: parseDockerMemoryUsage(row.MemUsage),
      memoryUsage: row.MemUsage || '',
      netIO: row.NetIO || '',
      blockIO: row.BlockIO || '',
      pids: Number(row.PIDs || 0),
    }))
  return { ok: true, containers }
}

function sampleProcesses() {
  const rows = []
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const cmdline = fs.readFileSync(path.join('/proc', pid, 'cmdline'), 'utf8').replace(/\0/g, ' ').trim()
      if (!cmdline || !/(node|tsx|npm|chromium|chrome|nodeaccess|fastify)/i.test(cmdline)) continue
      const status = fs.readFileSync(path.join('/proc', pid, 'status'), 'utf8')
      const rssMatch = status.match(/^VmRSS:\s+(\d+)/m)
      const threadsMatch = status.match(/^Threads:\s+(\d+)/m)
      let fdCount = 0
      try { fdCount = fs.readdirSync(path.join('/proc', pid, 'fd')).length } catch { fdCount = 0 }
      rows.push({
        pid: Number(pid),
        rssMb: rssMatch ? Math.round(Number(rssMatch[1]) / 1024) : 0,
        threads: threadsMatch ? Number(threadsMatch[1]) : 0,
        fdCount,
        command: cmdline.slice(0, 180),
      })
    } catch {
      // Process exited while sampling.
    }
  }
  return rows.sort((a, b) => b.rssMb - a.rssMb).slice(0, 12)
}

function readProfile() {
  return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'))
}

function activeUsers(profile) {
  return (profile.users || []).filter((user) => user.accessToken && !String(user.accessToken).startsWith('paste-'))
}

function pickPair(profile, index) {
  const users = activeUsers(profile)
  const hosts = profile.hosts || []
  if (users.length === 0) throw new Error(`No users with accessToken in ${PROFILE_FILE}`)
  if (hosts.length === 0) throw new Error(`No hosts in ${PROFILE_FILE}`)

  const user = users[index % users.length]
  const ownedHosts = hosts.filter((host) => !host.user || host.user === user.name || host.user === user.email)
  const hostPool = ownedHosts.length > 0 ? ownedHosts : hosts
  return { user, host: hostPool[index % hostPool.length] }
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

async function createPageTarget(index) {
  const url = `about:blank#terminalLoad=${Date.now()}-${index}`
  try {
    const created = await requestJson(`${CDP_BASE}/json/new?${encodeURIComponent(url)}`, 'PUT')
    if (created?.webSocketDebuggerUrl) {
      return { wsUrl: created.webSocketDebuggerUrl, targetId: created.id || created.webSocketDebuggerUrl.split('/').at(-1) }
    }
  } catch {
    // Older Chromium builds may not allow /json/new.
  }
  const targets = await getJson(`${CDP_BASE}/json/list`)
  const page = Array.isArray(targets)
    ? targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    : null
  if (!page?.webSocketDebuggerUrl) throw new Error(`No CDP page target found at ${CDP_BASE}`)
  return { wsUrl: page.webSocketDebuggerUrl, targetId: page.id || page.webSocketDebuggerUrl.split('/').at(-1) }
}

async function closePageTarget(targetId) {
  if (!targetId) return
  await requestJson(`${CDP_BASE}/json/close/${encodeURIComponent(targetId)}`).catch(() => {})
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
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
      if (msg.method) {
        this.events.push({ at: Date.now(), ...msg })
        for (const handler of this.handlers.get(msg.method) || []) {
          Promise.resolve(handler(msg)).catch(() => {})
        }
      }
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws.terminate()
        reject(new Error('CDP timeout: WebSocket open'))
      }, CDP_OPEN_TIMEOUT_MS)
      this.ws.once('open', () => {
        clearTimeout(timeout)
        resolve()
      })
      this.ws.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, CDP_COMMAND_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || []
    handlers.push(handler)
    this.handlers.set(method, handlers)
  }

  isOpen() {
    return this.ws.readyState === WebSocket.OPEN
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close()
    }
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

async function cdpSetupSend(cdp, method, params = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= CDP_SETUP_RETRIES; attempt += 1) {
    try {
      return await cdp.send(method, params)
    } catch (error) {
      lastError = error
      if (!String(error.message || '').startsWith('CDP timeout:')) throw error
      if (attempt < CDP_SETUP_RETRIES) await sleep(500 * (attempt + 1))
    }
  }
  throw lastError
}

async function waitFor(cdp, expression, timeoutMs = 20000, intervalMs = 100) {
  const startedAt = Date.now()
  let last = null
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url })
  await waitFor(cdp, 'document.readyState === "complete" || document.readyState === "interactive"', 20000)
}

async function insertText(cdp, text) {
  await cdp.send('Input.insertText', { text })
}

function terminalSnapshotExpression(label) {
  return `(() => {
    const container = document.querySelector('[data-terminal-container="true"]');
    const xterm = document.querySelector('.xterm');
    const screen = document.querySelector('.xterm-screen');
    const helper = document.querySelector('.xterm-helper-textarea');
    const rect = container?.getBoundingClientRect();
    return {
      label: ${JSON.stringify(label)},
      href: location.href,
      hasTerminal: Boolean(container && xterm && screen),
      hasFocus: document.activeElement === helper,
      rows: Number(container?.getAttribute('data-terminal-rows') || 0),
      cols: Number(container?.getAttribute('data-terminal-cols') || 0),
      width: rect ? Math.round(rect.width) : 0,
      height: rect ? Math.round(rect.height) : 0,
      bodyText: document.body.innerText.slice(0, 1000),
    };
  })()`
}

async function collectSnapshot(cdp, label) {
  return evaluate(cdp, terminalSnapshotExpression(label))
}

async function optionalSnapshot(cdp, label) {
  try {
    return await collectSnapshot(cdp, label)
  } catch (error) {
    return { label, skipped: true, error: error.message }
  }
}

async function querySelectorNodeId(cdp, selector) {
  const root = await cdp.send('DOM.getDocument', { depth: 1, pierce: true })
  if (!root.root?.nodeId) return 0
  const result = await cdp.send('DOM.querySelector', {
    nodeId: root.root.nodeId,
    selector,
  })
  return result.nodeId || 0
}

async function waitForSelector(cdp, selector, timeoutMs = 20000, intervalMs = 100) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const nodeId = await querySelectorNodeId(cdp, selector)
    if (nodeId) return nodeId
    await sleep(intervalMs)
  }
  throw new Error(`waitForSelector timeout: ${selector}`)
}

async function focusSelector(cdp, selector) {
  const nodeId = await waitForSelector(cdp, selector, 10000)
  await cdp.send('DOM.focus', { nodeId })
  return nodeId
}

async function waitForReceivedFrame(stats, previousCount, timeoutMs = 5000) {
  const startedAt = performance.now()
  while (performance.now() - startedAt < timeoutMs) {
    if (stats.wsReceivedFrames > previousCount) return Math.round(performance.now() - startedAt)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return null
}

async function runSession(profile, index) {
  const { user, host } = pickPair(profile, index)
  const stats = {
    index,
    user: user.name || user.email || `user-${index}`,
    host: host.name || String(host.id),
    hostId: host.id,
    ok: false,
    error: null,
    timeToTerminalMs: 0,
    commandsSent: 0,
    commandLatencyMs: [],
    wsSentFrames: 0,
    wsReceivedFrames: 0,
    wsSentBytes: 0,
    wsReceivedBytes: 0,
    snapshots: {},
    stage: 'created',
  }

  const startedAt = performance.now()
  const pageTarget = await createPageTarget(index)
  const cdp = new Cdp(pageTarget.wsUrl)
  try {
    stats.stage = 'cdp.open'
    await cdp.open()
    stats.stage = 'cdp.setup.page'
    await cdpSetupSend(cdp, 'Page.enable')
    stats.stage = 'cdp.setup.runtime'
    await cdpSetupSend(cdp, 'Runtime.enable')
    stats.stage = 'cdp.setup.network'
    await cdpSetupSend(cdp, 'Network.enable')
    stats.stage = 'cdp.setup.dom'
    await cdpSetupSend(cdp, 'DOM.enable')
    stats.stage = 'cdp.setup.viewport'
    await cdpSetupSend(cdp, 'Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    })

    cdp.on('Network.webSocketFrameSent', (event) => {
      const payload = event.params?.response?.payloadData || ''
      stats.wsSentFrames += 1
      stats.wsSentBytes += Buffer.byteLength(payload)
    })
    cdp.on('Network.webSocketFrameReceived', (event) => {
      const payload = event.params?.response?.payloadData || ''
      stats.wsReceivedFrames += 1
      stats.wsReceivedBytes += Buffer.byteLength(payload)
    })

    stats.stage = 'navigate.hosts'
    await navigate(cdp, `${FRONTEND}/hosts?terminalLoad=${Date.now()}-${index}`)
    stats.stage = 'auth.localStorage'
    await evaluate(cdp, `
      localStorage.setItem('na_access_token', ${JSON.stringify(user.accessToken)});
      localStorage.setItem('na_refresh_token', ${JSON.stringify(user.refreshToken || 'cdp-load-refresh-placeholder')});
    `)
    stats.stage = 'fetch.host.details'
    const resolvedHost = await evaluate(cdp, `
      (async () => {
        const response = await fetch(${JSON.stringify(`/api/v1/hosts/${host.id}`)}, {
          headers: { authorization: ${JSON.stringify(`Bearer ${user.accessToken}`)} },
        });
        const text = await response.text();
        if (!response.ok) return { ok: false, status: response.status, text };
        const data = text ? JSON.parse(text) : null;
        return { ok: true, data };
      })()
    `)
    if (!resolvedHost?.ok) {
      throw new Error(`GET /hosts/${host.id} failed with ${resolvedHost?.status}: ${resolvedHost?.text || ''}`)
    }
    const hostDetails = resolvedHost.data
    stats.stage = 'sessionStorage.pendingHost'
    await evaluate(cdp, `
      sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(${JSON.stringify({
        id: hostDetails.id,
        name: hostDetails.name,
        ip: hostDetails.ip,
        port: hostDetails.port,
        authType: hostDetails.authType,
        accessProtocol: hostDetails.accessProtocol || 'SSH',
      })}));
    `)
    stats.stage = 'navigate.terminal'
    await navigate(cdp, `${FRONTEND}/terminal?terminalLoad=${Date.now()}-${index}`)
    stats.stage = 'wait.terminal.container'
    await waitForSelector(cdp, '[data-terminal-container="true"]', 25000)
    stats.timeToTerminalMs = Math.round(performance.now() - startedAt)
    await sleep(1500)
    stats.stage = 'snapshot.initial'
    stats.snapshots.initial = await optionalSnapshot(cdp, 'initial')

    stats.stage = 'terminal.focus'
    await focusSelector(cdp, '.xterm-helper-textarea')
    if (RUN_COMMANDS) {
      const commands = Array.isArray(host.commands) && host.commands.length > 0
        ? host.commands
        : ['whoami', 'pwd', 'uptime']
      const endAt = performance.now() + HOLD_MS
      let commandIndex = 0
      while (performance.now() < endAt) {
        stats.stage = `terminal.command.${commandIndex + 1}`
        const beforeFrames = stats.wsReceivedFrames
        await insertText(cdp, `${commands[commandIndex % commands.length]}\r`)
        stats.commandsSent += 1
        const latency = await waitForReceivedFrame(stats, beforeFrames)
        if (typeof latency === 'number') stats.commandLatencyMs.push(latency)
        commandIndex += 1
        await sleep(COMMAND_INTERVAL_MS)
      }
    } else {
      await sleep(HOLD_MS)
    }

    stats.stage = 'snapshot.final'
    stats.snapshots.final = await optionalSnapshot(cdp, 'final')
    stats.ok = Boolean(stats.snapshots.initial?.hasTerminal !== false && stats.snapshots.final?.hasTerminal !== false)
    stats.stage = stats.ok ? 'done' : 'terminal.missing'
  } catch (error) {
    stats.error = `${stats.stage}: ${error.message}`
    if (cdp.isOpen()) {
      try {
        stats.snapshots.failure = await collectSnapshot(cdp, 'failure')
      } catch {
        // Keep original failure.
      }
    }
  } finally {
    cdp.close()
    await closePageTarget(pageTarget.targetId)
  }

  return stats
}

function percentile(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function summarize(values) {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 }
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  }
}

function summarizeRange(values) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0 }
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    min: Math.round(Math.min(...values) * 10) / 10,
    max: Math.round(Math.max(...values) * 10) / 10,
    avg: Math.round((sum / values.length) * 10) / 10,
  }
}

let previousCpu = readCpuStat()
const machineSamples = []
let samplerTimer = null

async function sampleOnce() {
  const currentCpu = readCpuStat()
  const totalDelta = currentCpu.total - previousCpu.total
  const idleDelta = currentCpu.idle - previousCpu.idle
  const cpuPercent = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0
  previousCpu = currentCpu
  machineSamples.push({
    at: new Date().toISOString(),
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memory: readMemInfo(),
    disks: readDiskInfo(),
    containers: readContainerStats(),
    loadAverage: os.loadavg(),
    processes: sampleProcesses(),
  })
}

function startSampler() {
  samplerTimer = setInterval(() => {
    sampleOnce().catch(() => {})
  }, METRICS_INTERVAL_MS)
}

function stopSampler() {
  if (samplerTimer) clearInterval(samplerTimer)
}

function summarizeContainers() {
  const collectionSamples = machineSamples.map((sample) => sample.containers).filter(Boolean)
  const byName = new Map()
  for (const containerSample of collectionSamples) {
    if (!containerSample.ok) continue
    for (const container of containerSample.containers) {
      const rows = byName.get(container.name) || []
      rows.push(container)
      byName.set(container.name, rows)
    }
  }
  return {
    collectionSamples: collectionSamples.length,
    okSamples: collectionSamples.filter((sample) => sample.ok).length,
    failedSamples: collectionSamples.filter((sample) => !sample.ok).length,
    filter: CONTAINER_NAMES.length > 0
      ? { type: 'names', value: CONTAINER_NAMES }
      : { type: 'pattern', value: CONTAINER_NAME_PATTERN.source },
    containers: [...byName.entries()].map(([name, rows]) => ({
      name,
      samples: rows.length,
      cpuPercent: summarizeRange(rows.map((row) => row.cpuPercent)),
      memoryPercent: summarizeRange(rows.map((row) => row.memoryPercent)),
      memoryUsedMb: summarizeRange(rows.map((row) => row.memoryUsedMb)),
      pids: summarizeRange(rows.map((row) => row.pids)),
      last: rows.at(-1) || null,
    })),
  }
}

function summarizeMachine() {
  return {
    samples: machineSamples.length,
    cpuPercent: summarizeRange(machineSamples.map((sample) => sample.cpuPercent)),
    memoryUsedPercent: summarizeRange(machineSamples.map((sample) => sample.memory.usedPercent)),
    memoryUsedMb: summarizeRange(machineSamples.map((sample) => sample.memory.usedMb)),
    disks: DISK_PATHS.map((diskPath) => {
      const diskSamples = machineSamples
        .flatMap((sample) => sample.disks || [])
        .filter((disk) => disk.path === diskPath)
      const okSamples = diskSamples.filter((disk) => disk.ok)
      return {
        path: diskPath,
        okSamples: okSamples.length,
        usedPercent: summarizeRange(okSamples.map((disk) => disk.usedPercent)),
        usedMb: summarizeRange(okSamples.map((disk) => disk.usedMb)),
        availableMb: summarizeRange(okSamples.map((disk) => disk.availableMb)),
        last: diskSamples.at(-1) || null,
      }
    }),
    containers: summarizeContainers(),
    lastProcesses: machineSamples.at(-1)?.processes || [],
  }
}

async function main() {
  const profile = readProfile()
  await sampleOnce()
  startSampler()
  const sessions = []
  let results = []
  try {
    for (let index = 0; index < CONCURRENCY; index += 1) {
      sessions.push(runSession(profile, index))
      await sleep(START_STAGGER_MS)
    }
    results = await Promise.all(sessions)
  } finally {
    stopSampler()
    await sampleOnce().catch(() => {})
  }
  const ok = results.filter((result) => result.ok)
  const failed = results.filter((result) => !result.ok)
  const commandLatencies = results.flatMap((result) => result.commandLatencyMs)
  const findings = []
  if (failed.length > 0) findings.push(`${failed.length}/${results.length} browser terminal sessions failed`)

  const report = {
    ok: findings.length === 0,
    createdAt: new Date().toISOString(),
    frontend: FRONTEND,
    cdpBase: CDP_BASE,
    profile: PROFILE_FILE,
    config: {
      concurrency: CONCURRENCY,
      holdMs: HOLD_MS,
      commandIntervalMs: COMMAND_INTERVAL_MS,
      runCommands: RUN_COMMANDS,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    },
    summary: {
      connectedUi: ok.length,
      failedUi: failed.length,
      commandsSent: results.reduce((sum, result) => sum + result.commandsSent, 0),
      wsSentFrames: results.reduce((sum, result) => sum + result.wsSentFrames, 0),
      wsReceivedFrames: results.reduce((sum, result) => sum + result.wsReceivedFrames, 0),
      wsSentBytes: results.reduce((sum, result) => sum + result.wsSentBytes, 0),
      wsReceivedBytes: results.reduce((sum, result) => sum + result.wsReceivedBytes, 0),
      timeToTerminalMs: summarize(ok.map((result) => result.timeToTerminalMs)),
      commandLatencyMs: summarize(commandLatencies),
    },
    machineSummary: summarizeMachine(),
    findings,
    results,
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    summary: report.summary,
    machineSummary: {
      cpuPercent: report.machineSummary.cpuPercent,
      memoryUsedPercent: report.machineSummary.memoryUsedPercent,
      disks: report.machineSummary.disks.map((disk) => ({
        path: disk.path,
        usedPercent: disk.usedPercent,
      })),
      containers: report.machineSummary.containers.containers.map((container) => ({
        name: container.name,
        cpuPercent: container.cpuPercent,
        memoryPercent: container.memoryPercent,
      })),
    },
    findings,
  }, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
