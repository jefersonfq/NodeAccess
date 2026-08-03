#!/usr/bin/env node
/*
 * Terminal browser load harness via Playwright.
 *
 * This exercises the real frontend terminal UI with multiple browser pages.
 * It uses profile.local.json tokens/hosts, opens /terminal, sends commands
 * through xterm, and records browser/network failures with machine metrics.
 *
 * Usage:
 *   FRONTEND_BASE=http://127.0.0.1:5173 \
 *   PROFILE_FILE=tools/load-tests/data/profile.local.json \
 *   CONCURRENCY=5 BROWSER=chromium \
 *   node tools/frontend/terminal-playwright-load.cjs
 */

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const os = require('node:os')
const { performance } = require('node:perf_hooks')
const { spawnSync } = require('node:child_process')

let playwright
try {
  playwright = require('playwright')
} catch {
  console.error('Missing dependency: playwright. Install it with `npm install -D playwright`.')
  process.exit(2)
}

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const PROFILE_FILE = process.env.PROFILE_FILE || path.join(REPO_ROOT, 'tools/load-tests/data/profile.local.json')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-terminal-playwright-load.json'
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/tmp/nodeaccess-terminal-playwright-artifacts'
const BROWSER = process.env.BROWSER || 'chromium'
const HEADLESS = process.env.HEADLESS !== '0'
const CONCURRENCY = numberEnv('CONCURRENCY', 5)
const START_STAGGER_MS = numberEnv('START_STAGGER_MS', 500)
const HOLD_MS = numberEnv('HOLD_MS', 15000)
const COMMAND_INTERVAL_MS = numberEnv('COMMAND_INTERVAL_MS', 5000)
const RUN_COMMANDS = process.env.RUN_COMMANDS !== '0'
const VIEWPORT_WIDTH = numberEnv('VIEWPORT_WIDTH', 1440)
const VIEWPORT_HEIGHT = numberEnv('VIEWPORT_HEIGHT', 1000)
const ACTION_TIMEOUT_MS = numberEnv('ACTION_TIMEOUT_MS', 30000)
const NAVIGATION_TIMEOUT_MS = numberEnv('NAVIGATION_TIMEOUT_MS', 45000)
const TERMINAL_READY_TIMEOUT_MS = numberEnv('TERMINAL_READY_TIMEOUT_MS', ACTION_TIMEOUT_MS)
const SESSION_TIMEOUT_MS = numberEnv('SESSION_TIMEOUT_MS', Math.max(90000, HOLD_MS + 60000))
const COMMAND_SEND_TIMEOUT_MS = numberEnv('COMMAND_SEND_TIMEOUT_MS', 10000)
const COMMAND_INPUT_MODE = process.env.COMMAND_INPUT_MODE || 'keys'
const CACHE_DIAGNOSTICS = process.env.CACHE_DIAGNOSTICS !== '0'
const CACHE_DIAGNOSTICS_DETAIL = process.env.CACHE_DIAGNOSTICS_DETAIL === '1'
const METRICS_INTERVAL_MS = numberEnv('METRICS_INTERVAL_MS', 1000)
const SCREENSHOTS = process.env.SCREENSHOTS !== '0'
const SCREENSHOT_MODE = process.env.SCREENSHOT_MODE || (SCREENSHOTS ? 'all' : 'off')
const CONTEXT_CLOSE_TIMEOUT_MS = numberEnv('CONTEXT_CLOSE_TIMEOUT_MS', 10000)
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
      if (!cmdline || !/(node|tsx|npm|chromium|chrome|firefox|playwright|nodeaccess|fastify)/i.test(cmdline)) continue
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

function requestJson(url, headers = {}, timeoutMs = ACTION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : null
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data, body })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms: ${url}`))
    })
    req.on('error', reject)
    req.end()
  })
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

function normalizeApiEndpoint(url) {
  try {
    const parsed = new URL(url)
    if (!parsed.pathname.startsWith('/api/v1/')) return null
    return parsed.pathname
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
  } catch {
    return null
  }
}

function summarizeApiResponses(results) {
  const byEndpoint = new Map()
  for (const result of results) {
    for (const row of result.apiResponses || []) {
      const key = `${row.method} ${row.endpoint}`
      const rows = byEndpoint.get(key) || []
      rows.push(row)
      byEndpoint.set(key, rows)
    }
  }

  return [...byEndpoint.entries()]
    .map(([key, rows]) => {
      const [method, ...endpointParts] = key.split(' ')
      const endpoint = endpointParts.join(' ')
      const durations = rows.map((row) => row.durationMs).filter((value) => Number.isFinite(value))
      const encodedBytes = rows.map((row) => row.encodedBodySize || 0).filter((value) => Number.isFinite(value))
      const statuses = rows.reduce((acc, row) => {
        const status = String(row.status || 'failed')
        acc[status] = (acc[status] || 0) + 1
        return acc
      }, {})
      return {
        method,
        endpoint,
        count: rows.length,
        statuses,
        durationMs: summarize(durations),
        encodedBodyBytes: summarize(encodedBytes),
      }
    })
    .sort((a, b) => b.count - a.count || b.durationMs.p95 - a.durationMs.p95)
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

async function withTimeout(promise, ms, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function browserType() {
  const type = playwright[BROWSER]
  if (!type) throw new Error(`Unsupported BROWSER=${BROWSER}. Use chromium, firefox or webkit.`)
  return type
}

function launchOptions() {
  const options = {
    headless: HEADLESS,
    args: BROWSER === 'chromium' ? ['--no-sandbox', '--disable-gpu'] : [],
  }
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    options.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  }
  return options
}

async function screenshot(page, stats, label) {
  if (SCREENSHOT_MODE === 'off') return
  if (SCREENSHOT_MODE === 'failure' && label !== 'failure') return
  const file = path.join(ARTIFACTS_DIR, `session-${stats.index}-${label}.png`)
  await page.screenshot({ path: file, fullPage: false }).catch(() => {})
  stats.artifacts.push(file)
}

async function sendCommandInput(page, command) {
  if (COMMAND_INPUT_MODE === 'insert') {
    await page.keyboard.insertText(command)
    await page.keyboard.press('Enter')
    return
  }
  if (COMMAND_INPUT_MODE === 'paste') {
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text)
    }, command)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
    await page.keyboard.press('Enter')
    return
  }
  if (COMMAND_INPUT_MODE === 'hook') {
    await page.evaluate((text) => {
      window.dispatchEvent(new CustomEvent('nodeaccess:terminal-send-input', { detail: { text } }))
    }, `${command}\r`)
    return
  }
  await page.keyboard.type(command, { delay: 5 })
  await page.keyboard.press('Enter')
}

async function terminalSnapshot(page, label) {
  return page.evaluate((snapshotLabel) => {
    const container = document.querySelector('[data-terminal-container="true"]')
    const xterm = document.querySelector('.xterm')
    const screen = document.querySelector('.xterm-screen')
    const helper = document.querySelector('.xterm-helper-textarea')
    const rect = container?.getBoundingClientRect()
    return {
      label: snapshotLabel,
      href: location.href,
      title: document.title,
      hasTerminal: Boolean(container && xterm && screen),
      hasFocus: document.activeElement === helper,
      rows: Number(container?.getAttribute('data-terminal-rows') || 0),
      cols: Number(container?.getAttribute('data-terminal-cols') || 0),
      width: rect ? Math.round(rect.width) : 0,
      height: rect ? Math.round(rect.height) : 0,
      bodyText: document.body.innerText.slice(0, 1000),
      harness: window.__NODEACCESS_TERMINAL_HARNESS__ || null,
    }
  }, label)
}

async function terminalHarnessState(page) {
  return page.evaluate(() => window.__NODEACCESS_TERMINAL_HARNESS__ || null)
}

async function cacheSnapshot(page, label) {
  if (!CACHE_DIAGNOSTICS) return null
  const row = await page.evaluate((snapshotLabel) => {
    const diagnostics = window.__NODEACCESS_CACHE_DIAGNOSTICS__
    return {
      label: snapshotLabel,
      href: location.href,
      snapshot: diagnostics?.snapshot?.() ?? null,
    }
  }, label)
  row.snapshot = compactCacheSnapshot(row.snapshot)
  return row
}

function compactCacheSnapshot(snapshot) {
  if (!snapshot) return null
  if (CACHE_DIAGNOSTICS_DETAIL) return snapshot
  return {
    at: snapshot.at,
    caches: (snapshot.caches || []).map((cache) => ({
      name: cache.name,
      kind: cache.kind,
      ttlMs: cache.ttlMs,
      entryCount: cache.entryCount,
      stats: {
        hits: cache.stats?.hits || 0,
        misses: cache.stats?.misses || 0,
        sets: cache.stats?.sets || 0,
        updates: cache.stats?.updates || 0,
        clears: cache.stats?.clears || 0,
      },
      totalReads: cache.totalReads || 0,
      hitRate: cache.hitRate || 0,
      health: cache.health,
      keyInsights: (cache.keyInsights || []).slice(0, 4).map((item) => ({
        label: item.label,
        reads: item.reads,
        hits: item.hits,
        misses: item.misses,
        hitRate: item.hitRate,
      })),
      meta: cache.meta || null,
    })),
  }
}

function diffCacheSnapshots(before, after) {
  const beforeCaches = before?.snapshot?.caches || []
  const afterCaches = after?.snapshot?.caches || []
  const beforeByName = new Map(beforeCaches.map((cache) => [cache.name, cache]))
  return afterCaches
    .map((cache) => {
      const previous = beforeByName.get(cache.name)
      const hits = (cache.stats?.hits || 0) - (previous?.stats?.hits || 0)
      const misses = (cache.stats?.misses || 0) - (previous?.stats?.misses || 0)
      const clears = (cache.stats?.clears || 0) - (previous?.stats?.clears || 0)
      const reads = hits + misses
      return {
        name: cache.name,
        entryCount: cache.entryCount,
        hits,
        misses,
        clears,
        reads,
        hitRate: reads > 0 ? Math.round((hits / reads) * 1000) / 10 : null,
      }
    })
    .filter((cache) => cache.reads > 0 || cache.clears > 0)
    .sort((a, b) => b.reads - a.reads || b.misses - a.misses || a.name.localeCompare(b.name))
}

function summarizeCacheDiagnostics(results) {
  const byName = new Map()
  for (const result of results) {
    const snapshots = result.cacheSnapshots || {}
    const ordered = ['afterHosts', 'afterHostDetails', 'afterTerminalReady', 'final']
      .map((key) => snapshots[key])
      .filter(Boolean)
    const finalSnapshot = ordered.at(-1)
    for (const cache of finalSnapshot?.snapshot?.caches || []) {
      const row = byName.get(cache.name) || {
        name: cache.name,
        sessions: 0,
        entryCountMax: 0,
        hits: 0,
        misses: 0,
        clears: 0,
        reads: 0,
        keyInsights: [],
      }
      row.sessions += 1
      row.entryCountMax = Math.max(row.entryCountMax, cache.entryCount || 0)
      row.hits += cache.stats?.hits || 0
      row.misses += cache.stats?.misses || 0
      row.clears += cache.stats?.clears || 0
      row.reads += cache.totalReads || 0
      row.keyInsights = [...row.keyInsights, ...(cache.keyInsights || [])].slice(0, 12)
      byName.set(cache.name, row)
    }
  }
  return [...byName.values()]
    .map((row) => ({
      ...row,
      hitRate: row.reads > 0 ? Math.round((row.hits / row.reads) * 1000) / 10 : 0,
    }))
    .filter((row) => row.reads > 0 || row.entryCountMax > 0 || row.clears > 0)
    .sort((a, b) => b.reads - a.reads || b.misses - a.misses || a.name.localeCompare(b.name))
}

function createSessionStats(profile, index) {
  const { user, host } = pickPair(profile, index)
  return {
    index,
    user: user.name || user.email || `user-${index}`,
    accessToken: user.accessToken,
    refreshToken: user.refreshToken || 'playwright-load-refresh-placeholder',
    host: host.name || String(host.id),
    hostId: host.id,
    commands: Array.isArray(host.commands) && host.commands.length > 0 ? host.commands : ['whoami', 'pwd', 'uptime'],
    ok: false,
    error: null,
    stage: 'created',
    timeToTerminalMs: 0,
    commandsSent: 0,
    commandLatencyMs: [],
    requestFailed: [],
    requestAborted: [],
    responseErrors: [],
    apiResponses: [],
    pageErrors: [],
    consoleErrors: [],
    snapshots: {},
    cacheSnapshots: {},
    cacheDeltas: {},
    artifacts: [],
  }
}

async function runSession(browser, stats) {
  const startedAt = performance.now()
  let context
  let page
  try {
    context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      ignoreHTTPSErrors: true,
    })
    context.setDefaultTimeout(ACTION_TIMEOUT_MS)
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)
    await context.addInitScript(({ accessToken, refreshToken }) => {
      window.localStorage.setItem('na_access_token', accessToken)
      window.localStorage.setItem('na_refresh_token', refreshToken)
    }, {
      accessToken: stats.accessToken,
      refreshToken: stats.refreshToken,
    })

    page = await context.newPage()
    const requestStartedAt = new Map()
    page.on('request', (request) => {
      requestStartedAt.set(request, performance.now())
    })
    page.on('requestfailed', (request) => {
      const endpoint = normalizeApiEndpoint(request.url())
      if (endpoint) {
        stats.apiResponses.push({
          endpoint,
          url: request.url(),
          method: request.method(),
          status: 'failed',
          durationMs: Math.round(performance.now() - (requestStartedAt.get(request) || performance.now())),
          encodedBodySize: 0,
          failure: request.failure()?.errorText || '',
        })
      }
      const row = {
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || '',
      }
      if (row.failure === 'net::ERR_ABORTED') stats.requestAborted.push(row)
      else stats.requestFailed.push(row)
    })
    page.on('response', (response) => {
      const status = response.status()
      const request = response.request()
      const endpoint = normalizeApiEndpoint(response.url())
      if (endpoint) {
        const headers = response.headers()
        const contentLength = Number(headers['content-length'] || 0)
        stats.apiResponses.push({
          endpoint,
          url: response.url(),
          method: request.method(),
          status,
          durationMs: Math.round(performance.now() - (requestStartedAt.get(request) || performance.now())),
          encodedBodySize: Number.isFinite(contentLength) ? contentLength : 0,
        })
      }
      if (status < 400) return
      stats.responseErrors.push({
        url: response.url(),
        method: request.method(),
        status,
        statusText: response.statusText(),
      })
    })
    page.on('pageerror', (error) => {
      stats.pageErrors.push(error.message)
    })
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        stats.consoleErrors.push({
          type: message.type(),
          text: message.text().slice(0, 500),
          location: message.location(),
        })
      }
    })

    stats.stage = 'navigate.hosts'
    await page.goto(`${FRONTEND}/hosts?playwrightLoad=${Date.now()}-${stats.index}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__NODEACCESS_CACHE_DIAGNOSTICS__ || !location.hostname.match(/^(localhost|127\.0\.0\.1)$/), undefined, { timeout: 5000 }).catch(() => {})
    stats.cacheSnapshots.afterHosts = await cacheSnapshot(page, 'after-hosts').catch((error) => ({ label: 'after-hosts', error: error.message }))

    stats.stage = 'fetch.host.details'
    const resolvedHost = await requestJson(`${FRONTEND}/api/v1/hosts/${stats.hostId}`, {
      authorization: `Bearer ${stats.accessToken}`,
    })
    if (!resolvedHost.ok) {
      throw new Error(`GET /hosts/${stats.hostId} failed with ${resolvedHost.status}: ${resolvedHost.body || ''}`)
    }
    const hostDetails = resolvedHost.data
    stats.cacheSnapshots.afterHostDetails = await cacheSnapshot(page, 'after-host-details').catch((error) => ({ label: 'after-host-details', error: error.message }))

    stats.stage = 'sessionStorage.pendingHost'
    await page.evaluate((payload) => {
      window.sessionStorage.setItem('na:pending-terminal-host', JSON.stringify(payload))
    }, {
      id: hostDetails.id,
      name: hostDetails.name,
      ip: hostDetails.ip,
      port: hostDetails.port,
      authType: hostDetails.authType,
      accessProtocol: hostDetails.accessProtocol || 'ssh',
    })

    stats.stage = 'navigate.terminal'
    await page.goto(`${FRONTEND}/terminal?playwrightLoad=${Date.now()}-${stats.index}`, { waitUntil: 'domcontentloaded' })

    stats.stage = 'wait.terminal.ready'
    await page.waitForFunction(() => {
      const state = window.__NODEACCESS_TERMINAL_HARNESS__
      const container = document.querySelector('[data-terminal-container="true"]')
      return Boolean((state?.flags?.ready && state?.flags?.inputReady) || container)
    }, undefined, { timeout: TERMINAL_READY_TIMEOUT_MS })
    await page.waitForFunction(() => {
      const state = window.__NODEACCESS_TERMINAL_HARNESS__
      return Boolean(state?.flags?.ready && state?.flags?.inputReady)
    }, undefined, { timeout: TERMINAL_READY_TIMEOUT_MS })
    stats.timeToTerminalMs = Math.round(performance.now() - startedAt)
    await sleep(1000)
    stats.snapshots.initial = await terminalSnapshot(page, 'initial').catch((error) => ({ label: 'initial', error: error.message }))
    stats.cacheSnapshots.afterTerminalReady = await cacheSnapshot(page, 'after-terminal-ready').catch((error) => ({ label: 'after-terminal-ready', error: error.message }))
    stats.cacheDeltas.hostsToTerminalReady = diffCacheSnapshots(stats.cacheSnapshots.afterHosts, stats.cacheSnapshots.afterTerminalReady)
    await screenshot(page, stats, 'initial')

    stats.stage = 'terminal.focus'
    if (!stats.snapshots.initial?.hasFocus) {
      await page.locator('[data-terminal-container="true"]').click({ timeout: 5000 }).catch(() => {})
      await page.locator('.xterm-helper-textarea').focus({ timeout: 5000 }).catch(() => {})
    }

    if (RUN_COMMANDS) {
      const endAt = performance.now() + HOLD_MS
      let commandIndex = 0
      while (performance.now() < endAt) {
        const command = stats.commands[commandIndex % stats.commands.length]
        stats.stage = `terminal.command.${commandIndex + 1}`
        const beforeHarness = await terminalHarnessState(page).catch(() => null)
        const beforeCommands = beforeHarness?.counts?.commandSent || 0
        const beforeOutput = beforeHarness?.counts?.outputReceived || 0
        const commandStartedAt = performance.now()
        let sendError = null
        await withTimeout((async () => {
          await sendCommandInput(page, command)
        })(), COMMAND_SEND_TIMEOUT_MS, `send command ${commandIndex + 1}`).catch((error) => {
          sendError = error
        })
        await page.waitForFunction(
          ({ commandCount }) => {
            const state = window.__NODEACCESS_TERMINAL_HARNESS__
            return (state?.counts?.commandSent || 0) > commandCount
          },
          { commandCount: beforeCommands },
          { timeout: Math.min(5000, ACTION_TIMEOUT_MS) },
        ).catch(() => {})
        stats.commandsSent += 1
        await page.waitForFunction(
          ({ outputCount }) => {
            const state = window.__NODEACCESS_TERMINAL_HARNESS__
            return (state?.counts?.outputReceived || 0) > outputCount
          },
          { outputCount: beforeOutput },
          { timeout: Math.min(5000, ACTION_TIMEOUT_MS) },
        ).catch(() => {})
        const afterHarness = await terminalHarnessState(page).catch(() => null)
        const commandObserved = (afterHarness?.counts?.commandSent || 0) > beforeCommands
        const outputObserved = (afterHarness?.counts?.outputReceived || 0) > beforeOutput
        if (sendError && !(COMMAND_INPUT_MODE === 'hook' && commandObserved && outputObserved)) {
          throw sendError
        }
        stats.commandLatencyMs.push(Math.round(performance.now() - commandStartedAt))
        commandIndex += 1
        await sleep(COMMAND_INTERVAL_MS)
      }
    } else {
      await sleep(HOLD_MS)
    }

    stats.stage = 'snapshot.final'
    stats.snapshots.final = await terminalSnapshot(page, 'final').catch((error) => ({ label: 'final', error: error.message }))
    stats.cacheSnapshots.final = await cacheSnapshot(page, 'final').catch((error) => ({ label: 'final', error: error.message }))
    stats.cacheDeltas.terminalReadyToFinal = diffCacheSnapshots(stats.cacheSnapshots.afterTerminalReady, stats.cacheSnapshots.final)
    await screenshot(page, stats, 'final')
    stats.ok = Boolean(stats.snapshots.initial?.hasTerminal && stats.snapshots.final?.hasTerminal)
    stats.stage = stats.ok ? 'done' : 'terminal.missing'
  } catch (error) {
    stats.error = `${stats.stage}: ${error.message}`
    if (page) {
      stats.snapshots.failure = await terminalSnapshot(page, 'failure').catch((snapshotError) => ({
        label: 'failure',
        error: snapshotError.message,
      }))
      await screenshot(page, stats, 'failure')
    }
  } finally {
    stats.durationMs = Math.round(performance.now() - startedAt)
    if (context) {
      await withTimeout(context.close(), CONTEXT_CLOSE_TIMEOUT_MS, `context close ${stats.index}`).catch((error) => {
        stats.cleanupError = error.message
      })
    }
  }

  return stats
}

async function main() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const profile = readProfile()
  const browser = await browserType().launch(launchOptions())
  await sampleOnce()
  startSampler()
  const sessions = []
  let results = []
  try {
    for (let index = 0; index < CONCURRENCY; index += 1) {
      const stats = createSessionStats(profile, index)
      sessions.push(withTimeout(runSession(browser, stats), SESSION_TIMEOUT_MS, `session ${index}`)
        .catch((error) => {
          stats.ok = false
          stats.error = `${stats.stage}: ${error.message}`
          return stats
        }))
      await sleep(START_STAGGER_MS)
    }
    results = await Promise.all(sessions)
  } finally {
    stopSampler()
    await sampleOnce().catch(() => {})
    await browser.close().catch(() => {})
  }

  const ok = results.filter((result) => result.ok)
  const failed = results.filter((result) => !result.ok)
  const terminalReady = results.filter((result) => {
    const snapshots = Object.values(result.snapshots || {})
    return Boolean(
      result.timeToTerminalMs > 0
      || snapshots.some((snapshot) => snapshot?.hasTerminal)
      || snapshots.some((snapshot) => snapshot?.harness?.flags?.ready && snapshot?.harness?.flags?.inputReady),
    )
  })
  const commandLatencies = results.flatMap((result) => result.commandLatencyMs || [])
  const apiSummary = summarizeApiResponses(results)
  const publicResults = results.map(({ accessToken, refreshToken, ...result }) => result)
  const findings = []
  if (failed.length > 0) findings.push(`${failed.length}/${results.length} browser terminal sessions failed`)

  const report = {
    ok: findings.length === 0,
    createdAt: new Date().toISOString(),
    runner: 'playwright',
    browser: BROWSER,
    frontend: FRONTEND,
    profile: PROFILE_FILE,
    config: {
      concurrency: CONCURRENCY,
      holdMs: HOLD_MS,
      commandIntervalMs: COMMAND_INTERVAL_MS,
      commandInputMode: COMMAND_INPUT_MODE,
      runCommands: RUN_COMMANDS,
      actionTimeoutMs: ACTION_TIMEOUT_MS,
      navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
      terminalReadyTimeoutMs: TERMINAL_READY_TIMEOUT_MS,
      sessionTimeoutMs: SESSION_TIMEOUT_MS,
      contextCloseTimeoutMs: CONTEXT_CLOSE_TIMEOUT_MS,
      screenshotMode: SCREENSHOT_MODE,
      cacheDiagnostics: CACHE_DIAGNOSTICS,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      headless: HEADLESS,
    },
    summary: {
      connectedUi: ok.length,
      terminalReady: terminalReady.length,
      failedUi: failed.length,
      commandsSent: results.reduce((sum, result) => sum + (result.commandsSent || 0), 0),
      timeToTerminalMs: summarize(ok.map((result) => result.timeToTerminalMs || 0)),
      commandLatencyMs: summarize(commandLatencies),
      requestFailures: results.reduce((sum, result) => sum + (result.requestFailed?.length || 0), 0),
      requestAborted: results.reduce((sum, result) => sum + (result.requestAborted?.length || 0), 0),
      responseErrors: results.reduce((sum, result) => sum + (result.responseErrors?.length || 0), 0),
      pageErrors: results.reduce((sum, result) => sum + (result.pageErrors?.length || 0), 0),
      consoleErrors: results.reduce((sum, result) => sum + (result.consoleErrors?.length || 0), 0),
      durationMs: summarize(results.map((result) => result.durationMs || 0)),
    },
    apiSummary,
    cacheSummary: summarizeCacheDiagnostics(results),
    machineSummary: summarizeMachine(),
    findings,
    results: publicResults,
  }

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    ok: report.ok,
    reportPath: REPORT_PATH,
    artifactsDir: ARTIFACTS_DIR,
    summary: report.summary,
    apiSummary: report.apiSummary.slice(0, 12),
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
