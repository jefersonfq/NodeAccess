#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const os = require('node:os')

const args = process.argv.slice(2)

function argValue(name, fallback) {
  const index = args.indexOf(name)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  return fallback
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
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

function sampleProcesses() {
  const procRoot = '/proc'
  const rows = []
  for (const pid of fs.readdirSync(procRoot)) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const cmdline = fs.readFileSync(path.join(procRoot, pid, 'cmdline'), 'utf8').replace(/\0/g, ' ').trim()
      if (!cmdline || !/(node|tsx|npm|nodeaccess|fastify)/i.test(cmdline)) continue
      const status = fs.readFileSync(path.join(procRoot, pid, 'status'), 'utf8')
      const rssMatch = status.match(/^VmRSS:\s+(\d+)/m)
      rows.push({
        pid: Number(pid),
        rssMb: rssMatch ? Math.round(Number(rssMatch[1]) / 1024) : 0,
        command: cmdline.slice(0, 180),
      })
    } catch {
      // Process exited while sampling.
    }
  }
  return rows.sort((a, b) => b.rssMb - a.rssMb).slice(0, 10)
}

function summarize(values) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0 }
  const sum = values.reduce((acc, value) => acc + value, 0)
  return {
    min: Math.round(Math.min(...values) * 10) / 10,
    max: Math.round(Math.max(...values) * 10) / 10,
    avg: Math.round((sum / values.length) * 10) / 10,
  }
}

function parsePrometheusMetrics(text) {
  const values = {}
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i)
    if (!match) continue
    const name = match[1]
    const value = Number(match[2])
    if (!Number.isFinite(value)) continue
    values[name] = (values[name] || 0) + value
  }
  return values
}

async function scrapeMetrics() {
  if (!metricsUrl) return null
  const headers = {}
  if (metricsToken) headers.Authorization = `Bearer ${metricsToken}`
  const startedAt = Date.now()
  try {
    const res = await fetch(metricsUrl, { headers, signal: AbortSignal.timeout(3000) })
    const body = await res.text()
    return {
      at: new Date().toISOString(),
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      values: res.ok ? parsePrometheusMetrics(body) : {},
    }
  } catch (error) {
    return {
      at: new Date().toISOString(),
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error.message,
      values: {},
    }
  }
}

function metricsDelta(samples, name) {
  const values = samples
    .filter((sample) => sample.ok && typeof sample.values[name] === 'number')
    .map((sample) => sample.values[name])
  if (values.length < 2) return 0
  return Math.round((values.at(-1) - values[0]) * 1000) / 1000
}

const trackedPrometheusMetrics = [
  'nodeaccess_ssh_gateway_sessions_started_total',
  'nodeaccess_ssh_gateway_connections_active',
  'nodeaccess_session_audit_chunks_total',
  'nodeaccess_session_audit_chunk_raw_bytes_total',
  'nodeaccess_session_audit_chunk_compressed_bytes_total',
  'nodeaccess_session_audit_buffered_sessions',
  'nodeaccess_session_audit_policy_cache_hits_total',
  'nodeaccess_session_audit_policy_cache_misses_total',
  'nodeaccess_session_audit_policy_cache_errors_total',
  'nodeaccess_ssh_gateway_connect_duration_ms_count',
  'nodeaccess_ssh_gateway_connect_duration_ms_sum',
  'nodeaccess_session_audit_chunk_flush_duration_ms_count',
  'nodeaccess_session_audit_chunk_flush_duration_ms_sum',
]

function pickValues(values, names = trackedPrometheusMetrics) {
  return Object.fromEntries(
    names.map((name) => [name, typeof values[name] === 'number' ? values[name] : 0]),
  )
}

function subtractValues(lastValues, firstValues) {
  const names = [...new Set([...Object.keys(firstValues), ...Object.keys(lastValues)])]
  return Object.fromEntries(
    names.map((name) => [name, Math.round(((lastValues[name] || 0) - (firstValues[name] || 0)) * 1000) / 1000]),
  )
}

const sampleIntervalMs = numberEnv('METRICS_INTERVAL_MS', 1000)
const reportsDir = argValue('--reports-dir', 'tools/load-tests/reports')
const profile = argValue('--profile', process.env.PROFILE_FILE || 'tools/load-tests/data/profile.local.json')
const metricsUrl = process.env.METRICS_URL || ''
const metricsToken = process.env.METRICS_TOKEN || ''
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const reportPath = path.join(reportsDir, `gateway-load-${timestamp}.json`)
const gatewayScript = path.resolve(process.cwd(), 'tools/load-tests/ws/baseline-gateway.js')
const testArgs = [gatewayScript, '--profile', profile]

if (!fs.existsSync(path.resolve(process.cwd(), profile))) {
  console.error(`Profile not found: ${profile}`)
  console.error('Create it with: cp tools/load-tests/data/profile.model.json tools/load-tests/data/profile.local.json')
  process.exit(1)
}

let previousCpu = readCpuStat()
const machineSamples = []
const prometheusSamples = []
let stdout = ''
let stderr = ''
let timer = null

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
    loadAverage: os.loadavg(),
    processes: sampleProcesses(),
  })

  const prometheusSample = await scrapeMetrics()
  if (prometheusSample) prometheusSamples.push(prometheusSample)
}

function startSampler() {
  timer = setInterval(() => {
    sampleOnce().catch(() => {
      // Sampling must never fail the load test.
    })
  }, sampleIntervalMs)
}

function stopSampler() {
  if (timer) clearInterval(timer)
}

function writeReport(code) {
  stopSampler()

  let gatewaySummary = null
  try {
    const jsonStart = stdout.lastIndexOf('\n{')
    const rawJson = jsonStart >= 0 ? stdout.slice(jsonStart + 1) : stdout
    gatewaySummary = JSON.parse(rawJson)
  } catch {
    gatewaySummary = null
  }

  const report = {
    createdAt: new Date().toISOString(),
    command: `${process.execPath} ${testArgs.join(' ')}`,
    exitCode: code,
    environment: {
      WS_BASE_URL: process.env.WS_BASE_URL || null,
      CONCURRENCY: process.env.CONCURRENCY || null,
      HOLD_MS: process.env.HOLD_MS || null,
      COMMAND_INTERVAL_MS: process.env.COMMAND_INTERVAL_MS || null,
      METRICS_INTERVAL_MS: process.env.METRICS_INTERVAL_MS || null,
      METRICS_URL: metricsUrl || null,
    },
    gatewaySummary,
    machineSummary: {
      samples: machineSamples.length,
      cpuPercent: summarize(machineSamples.map((sample) => sample.cpuPercent)),
      memoryUsedPercent: summarize(machineSamples.map((sample) => sample.memory.usedPercent)),
      memoryUsedMb: summarize(machineSamples.map((sample) => sample.memory.usedMb)),
      lastProcesses: machineSamples.at(-1)?.processes || [],
    },
    prometheusSummary: (() => {
      const firstValues = pickValues(prometheusSamples.find((sample) => sample.ok)?.values || {})
      const lastValues = pickValues(prometheusSamples.findLast((sample) => sample.ok)?.values || {})
      const deltaValues = subtractValues(lastValues, firstValues)
      return {
      samples: prometheusSamples.length,
      okSamples: prometheusSamples.filter((sample) => sample.ok).length,
      chunksTotalDelta: metricsDelta(prometheusSamples, 'nodeaccess_session_audit_chunks_total'),
      rawBytesTotalDelta: metricsDelta(prometheusSamples, 'nodeaccess_session_audit_chunk_raw_bytes_total'),
      compressedBytesTotalDelta: metricsDelta(prometheusSamples, 'nodeaccess_session_audit_chunk_compressed_bytes_total'),
      sessionsStartedDelta: metricsDelta(prometheusSamples, 'nodeaccess_ssh_gateway_sessions_started_total'),
        firstValues,
        lastValues,
        deltaValues,
      }
    })(),
    machineSamples,
    prometheusSamples,
    stderr: stderr.trim(),
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport saved: ${reportPath}`)
  process.exitCode = code || 0
}

async function main() {
  fs.mkdirSync(reportsDir, { recursive: true })

  await sampleOnce()
  startSampler()

  const child = spawn(process.execPath, testArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    stdout += text
    process.stdout.write(text)
  })

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    stderr += text
    process.stderr.write(text)
  })

  child.on('close', (code) => {
    void sampleOnce().finally(() => writeReport(code))
  })
}

main().catch((error) => {
  stopSampler()
  console.error(error)
  process.exit(1)
})
