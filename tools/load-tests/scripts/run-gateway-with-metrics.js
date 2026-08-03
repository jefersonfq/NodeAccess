#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
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

function parseDiskPaths() {
  const raw = process.env.DISK_PATHS || ''
  const paths = raw.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return paths.length > 0 ? [...new Set(paths)] : [process.cwd(), '/tmp']
}

function readDiskInfo() {
  return diskPaths.map((diskPath) => {
    try {
      const stats = fs.statfsSync(diskPath)
      const totalBytes = stats.blocks * stats.bsize
      const availableBytes = stats.bavail * stats.bsize
      const freeBytes = stats.bfree * stats.bsize
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
      return {
        path: diskPath,
        totalMb: 0,
        usedMb: 0,
        availableMb: 0,
        usedPercent: 0,
        ok: false,
        error: error.message,
      }
    }
  })
}

function parseContainerNames() {
  return (process.env.CONTAINER_NAMES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseDockerMemoryUsage(value) {
  const [usedRaw = '0'] = String(value || '').split('/')
  return parseSizeToMb(usedRaw.trim())
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

function parsePercent(value) {
  const number = Number(String(value || '').replace('%', '').trim())
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0
}

function shouldIncludeContainer(row) {
  const names = containerNames
  if (names.length > 0) return names.includes(row.Name)
  return containerNamePattern.test(row.Name || '')
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
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
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
  const procRoot = '/proc'
  const rows = []
  for (const pid of fs.readdirSync(procRoot)) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const cmdline = fs.readFileSync(path.join(procRoot, pid, 'cmdline'), 'utf8').replace(/\0/g, ' ').trim()
      if (!cmdline || !/(node|tsx|npm|nodeaccess|fastify)/i.test(cmdline)) continue
      const status = fs.readFileSync(path.join(procRoot, pid, 'status'), 'utf8')
      const rssMatch = status.match(/^VmRSS:\s+(\d+)/m)
      const threadsMatch = status.match(/^Threads:\s+(\d+)/m)
      let fdCount = 0
      try {
        fdCount = fs.readdirSync(path.join(procRoot, pid, 'fd')).length
      } catch {
        fdCount = 0
      }
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
  return rows.sort((a, b) => b.rssMb - a.rssMb).slice(0, 10)
}

function parseTcpTable(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const stateNames = {
    '01': 'established',
    '02': 'syn_sent',
    '03': 'syn_recv',
    '04': 'fin_wait1',
    '05': 'fin_wait2',
    '06': 'time_wait',
    '07': 'close',
    '08': 'close_wait',
    '09': 'last_ack',
    '0A': 'listen',
    '0B': 'closing',
  }
  const states = {}
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1)
  for (const line of lines) {
    const columns = line.trim().split(/\s+/)
    const state = stateNames[columns[3]] || columns[3] || 'unknown'
    states[state] = (states[state] || 0) + 1
  }
  return states
}

function readTcpSummary() {
  const tables = [parseTcpTable('/proc/net/tcp'), parseTcpTable('/proc/net/tcp6')]
  const summary = {}
  for (const table of tables) {
    for (const [state, count] of Object.entries(table)) {
      summary[state] = (summary[state] || 0) + count
    }
  }
  summary.total = Object.entries(summary)
    .filter(([state]) => state !== 'total')
    .reduce((sum, [, count]) => sum + count, 0)
  return summary
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

function summarizeContainers(samples) {
  const collectionSamples = samples.map((sample) => sample.containers).filter(Boolean)
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
    filter: containerNames.length > 0
      ? { type: 'names', value: containerNames }
      : { type: 'pattern', value: containerNamePattern.source },
    containers: [...byName.entries()].map(([name, rows]) => ({
      name,
      samples: rows.length,
      cpuPercent: summarize(rows.map((row) => row.cpuPercent)),
      memoryPercent: summarize(rows.map((row) => row.memoryPercent)),
      memoryUsedMb: summarize(rows.map((row) => row.memoryUsedMb)),
      pids: summarize(rows.map((row) => row.pids)),
      last: rows.at(-1) || null,
    })),
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

function parseMetricsTargets() {
  const raw = process.env.METRICS_URLS || ''
  if (raw.trim()) {
    return raw.split(',')
      .map((item, index) => {
        const trimmed = item.trim()
        if (!trimmed) return null
        const separator = trimmed.indexOf('=')
        if (separator > 0) {
          return {
            name: trimmed.slice(0, separator).trim() || `metrics-${index + 1}`,
            url: trimmed.slice(separator + 1).trim(),
          }
        }
        return { name: `metrics-${index + 1}`, url: trimmed }
      })
      .filter((item) => item && item.url)
  }

  if (process.env.METRICS_URL) return [{ name: 'default', url: process.env.METRICS_URL }]
  return []
}

async function scrapeMetricsTarget(target) {
  const headers = {}
  if (metricsToken) headers.Authorization = `Bearer ${metricsToken}`
  const startedAt = Date.now()
  try {
    const res = await fetch(target.url, { headers, signal: AbortSignal.timeout(3000) })
    const body = await res.text()
    return {
      at: new Date().toISOString(),
      target: target.name,
      url: target.url,
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - startedAt,
      values: res.ok ? parsePrometheusMetrics(body) : {},
    }
  } catch (error) {
    return {
      at: new Date().toISOString(),
      target: target.name,
      url: target.url,
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error.message,
      values: {},
    }
  }
}

async function scrapeMetrics() {
  if (metricsTargets.length === 0) return []
  return Promise.all(metricsTargets.map((target) => scrapeMetricsTarget(target)))
}

function metricsDelta(samples, name) {
  const values = samples
    .filter((sample) => sample.ok && typeof sample.values[name] === 'number')
    .map((sample) => sample.values[name])
  if (values.length < 2) return 0
  return Math.round((values.at(-1) - values[0]) * 1000) / 1000
}

function metricsMax(samples, name) {
  const values = samples
    .filter((sample) => sample.ok && typeof sample.values[name] === 'number')
    .map((sample) => sample.values[name])
  if (values.length === 0) return 0
  return Math.round(Math.max(...values) * 1000) / 1000
}

function samplesForTarget(samples, target) {
  return samples.filter((sample) => sample.target === target)
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
const maxDiskPercent = numberEnv('MAX_DISK_PERCENT', 90)
const maxContainerCpuPercent = numberEnv('MAX_CONTAINER_CPU_PERCENT', 200)
const maxContainerMemoryPercent = numberEnv('MAX_CONTAINER_MEMORY_PERCENT', 85)
const reportsDir = argValue('--reports-dir', 'tools/load-tests/reports')
const profile = argValue('--profile', process.env.PROFILE_FILE || 'tools/load-tests/data/profile.local.json')
const metricsTargets = parseMetricsTargets()
const metricsToken = process.env.METRICS_TOKEN || ''
const diskPaths = parseDiskPaths()
const containerNames = parseContainerNames()
const containerNamePattern = new RegExp(process.env.CONTAINER_NAME_PATTERN || 'nodeaccess', 'i')
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
    disks: readDiskInfo(),
    containers: readContainerStats(),
    tcp: readTcpSummary(),
    loadAverage: os.loadavg(),
    processes: sampleProcesses(),
  })

  const prometheusSampleBatch = await scrapeMetrics()
  prometheusSamples.push(...prometheusSampleBatch)
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

function buildRecommendations({ code, gatewaySummary, machineSamples, prometheusSamples, metricsTargets }) {
  const recommendations = []
  if (code !== 0) {
    recommendations.push('A onda terminou com exit code diferente de zero; priorize corrigir falhas de conexao antes de aumentar concorrencia.')
  }
  if (!gatewaySummary) {
    recommendations.push('Resumo do gateway nao foi parseado; verifique se o baseline emite JSON valido no final da execucao.')
    return recommendations
  }

  const failedRate = gatewaySummary.concurrency > 0 ? gatewaySummary.failed / gatewaySummary.concurrency : 1
  const cpuMax = Math.max(...machineSamples.map((sample) => sample.cpuPercent), 0)
  const memoryMax = Math.max(...machineSamples.map((sample) => sample.memory.usedPercent), 0)
  const diskMax = Math.max(...machineSamples.flatMap((sample) => (sample.disks || []).map((disk) => disk.usedPercent)), 0)
  const diskFailures = machineSamples
    .flatMap((sample) => sample.disks || [])
    .filter((disk) => !disk.ok)
  const containerStats = machineSamples.flatMap((sample) => sample.containers?.containers || [])
  const containerCpuMax = Math.max(...containerStats.map((container) => container.cpuPercent), 0)
  const containerMemoryMax = Math.max(...containerStats.map((container) => container.memoryPercent), 0)
  const containerCollectionErrors = machineSamples
    .map((sample) => sample.containers)
    .filter((containers) => containers && !containers.ok)
  const firstTcp = machineSamples[0]?.tcp || {}
  const lastTcp = machineSamples.at(-1)?.tcp || {}
  const tcpTimeWaitDelta = (lastTcp.time_wait || 0) - (firstTcp.time_wait || 0)
  const connectP95 = gatewaySummary.connectMs?.p95 ?? 0
  const firstOutputP95 = gatewaySummary.firstOutputMs?.p95 ?? 0
  const commandLatencyP95 = gatewaySummary.commandLatencyMs?.p95 ?? 0

  if (failedRate > 0) {
    recommendations.push(`Falhas de sessao detectadas (${gatewaySummary.failed}/${gatewaySummary.concurrency}); analise permissao, limites de licenca, gateway e SSH alvo.`)
  }
  if (connectP95 > 5000) {
    recommendations.push(`P95 de conexao alto (${connectP95}ms); investigue handshake SSH, bastion, resolucao de host e consultas de permissao.`)
  }
  if (firstOutputP95 > 6000) {
    recommendations.push(`P95 ate primeira saida alto (${firstOutputP95}ms); investigue latencia do shell remoto e backpressure no WebSocket.`)
  }
  if (commandLatencyP95 > 3000) {
    recommendations.push(`P95 de resposta por comando alto (${commandLatencyP95}ms); investigue backpressure, auditoria, CPU do gateway e latencia do alvo SSH.`)
  }
  if (cpuMax > 85) {
    recommendations.push(`CPU atingiu ${cpuMax}%; reduza concorrencia ou considere separar/escala horizontal do gateway.`)
  }
  if (memoryMax > 85) {
    recommendations.push(`Memoria atingiu ${memoryMax}%; acompanhe crescimento por sessao e possivel retencao de buffers/auditoria.`)
  }
  if (diskMax > maxDiskPercent) {
    recommendations.push(`Disco atingiu ${diskMax}%; acompanhe crescimento de relatorios, logs e auditoria antes de aumentar a duracao das ondas.`)
  }
  if (diskFailures.length > 0) {
    const paths = [...new Set(diskFailures.map((disk) => disk.path))].join(', ')
    recommendations.push(`Nao foi possivel coletar disco para: ${paths}. Confira DISK_PATHS.`)
  }
  if (containerCpuMax > maxContainerCpuPercent) {
    recommendations.push(`CPU de container atingiu ${containerCpuMax}%; compare com CPU da maquina para separar gargalo do NodeAccess versus ambiente WSL/notebook.`)
  }
  if (containerMemoryMax > maxContainerMemoryPercent) {
    recommendations.push(`Memoria de container atingiu ${containerMemoryMax}%; acompanhe limite do container e crescimento por sessao.`)
  }
  if (containerCollectionErrors.length > 0) {
    recommendations.push('Nao foi possivel coletar docker stats em algumas amostras; confirme Docker disponivel e permissao do usuario.')
  }
  if (tcpTimeWaitDelta > gatewaySummary.concurrency * 4) {
    recommendations.push(`TIME_WAIT TCP cresceu ${tcpTimeWaitDelta} durante a onda; em rampas maiores, avalie portas efemeras e intervalo entre ondas.`)
  }

  const gatewayTarget = metricsTargets.find((target) => target.name === 'gateway') || metricsTargets[0]
  const gatewayMetrics = gatewayTarget ? samplesForTarget(prometheusSamples, gatewayTarget.name) : []
  const okGatewayMetrics = gatewayMetrics.filter((sample) => sample.ok)
  if (metricsTargets.length > 0 && okGatewayMetrics.length === 0) {
    recommendations.push('Nenhuma amostra Prometheus valida foi coletada para o gateway; confirme METRICS_URLS e METRICS_TOKEN.')
  } else if (okGatewayMetrics.length > 1 && metricsDelta(okGatewayMetrics, 'nodeaccess_ssh_gateway_sessions_started_total') === 0 && gatewaySummary.connected > 0) {
    recommendations.push('Sessoes conectaram, mas a metrica nodeaccess_ssh_gateway_sessions_started_total nao variou; provavelmente o endpoint de metricas nao e do processo gateway.')
  }

  if (recommendations.length === 0) {
    recommendations.push('Onda saudavel nos limites atuais; proxima acao segura e aumentar concorrencia gradualmente mantendo a mesma duracao.')
  }
  return recommendations
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
      METRICS_URL: process.env.METRICS_URL || null,
      METRICS_URLS: process.env.METRICS_URLS || null,
      DISK_PATHS: process.env.DISK_PATHS || null,
      MAX_DISK_PERCENT: process.env.MAX_DISK_PERCENT || null,
      CONTAINER_NAMES: process.env.CONTAINER_NAMES || null,
      CONTAINER_NAME_PATTERN: process.env.CONTAINER_NAME_PATTERN || null,
      MAX_CONTAINER_CPU_PERCENT: process.env.MAX_CONTAINER_CPU_PERCENT || null,
      MAX_CONTAINER_MEMORY_PERCENT: process.env.MAX_CONTAINER_MEMORY_PERCENT || null,
    },
    gatewaySummary,
    machineSummary: {
      samples: machineSamples.length,
      cpuPercent: summarize(machineSamples.map((sample) => sample.cpuPercent)),
      memoryUsedPercent: summarize(machineSamples.map((sample) => sample.memory.usedPercent)),
      memoryUsedMb: summarize(machineSamples.map((sample) => sample.memory.usedMb)),
      disks: diskPaths.map((diskPath) => {
        const diskSamples = machineSamples
          .flatMap((sample) => sample.disks || [])
          .filter((disk) => disk.path === diskPath)
        return {
          path: diskPath,
          okSamples: diskSamples.filter((disk) => disk.ok).length,
          usedPercent: summarize(diskSamples.filter((disk) => disk.ok).map((disk) => disk.usedPercent)),
          usedMb: summarize(diskSamples.filter((disk) => disk.ok).map((disk) => disk.usedMb)),
          availableMb: summarize(diskSamples.filter((disk) => disk.ok).map((disk) => disk.availableMb)),
          last: diskSamples.at(-1) || null,
        }
      }),
      tcpEstablished: summarize(machineSamples.map((sample) => sample.tcp.established || 0)),
      tcpTimeWait: summarize(machineSamples.map((sample) => sample.tcp.time_wait || 0)),
      tcpTotal: summarize(machineSamples.map((sample) => sample.tcp.total || 0)),
      firstTcp: machineSamples[0]?.tcp || null,
      lastTcp: machineSamples.at(-1)?.tcp || null,
      lastProcesses: machineSamples.at(-1)?.processes || [],
      containers: summarizeContainers(machineSamples),
    },
    prometheusTargetsSummary: (() => {
      return metricsTargets.map((target) => {
        const targetSamples = samplesForTarget(prometheusSamples, target.name)
        const firstValues = pickValues(targetSamples.find((sample) => sample.ok)?.values || {})
        const lastValues = pickValues(targetSamples.findLast((sample) => sample.ok)?.values || {})
        const deltaValues = subtractValues(lastValues, firstValues)
        return {
          target: target.name,
          url: target.url,
          samples: targetSamples.length,
          okSamples: targetSamples.filter((sample) => sample.ok).length,
          chunksTotalDelta: metricsDelta(targetSamples, 'nodeaccess_session_audit_chunks_total'),
          rawBytesTotalDelta: metricsDelta(targetSamples, 'nodeaccess_session_audit_chunk_raw_bytes_total'),
          compressedBytesTotalDelta: metricsDelta(targetSamples, 'nodeaccess_session_audit_chunk_compressed_bytes_total'),
          sessionsStartedDelta: metricsDelta(targetSamples, 'nodeaccess_ssh_gateway_sessions_started_total'),
          activeConnectionsMax: metricsMax(targetSamples, 'nodeaccess_ssh_gateway_connections_active'),
          firstValues,
          lastValues,
          deltaValues,
        }
      })
    })(),
    prometheusSummary: (() => {
      const preferredTarget = metricsTargets.find((target) => target.name === 'gateway') || metricsTargets[0]
      const selectedSamples = preferredTarget ? samplesForTarget(prometheusSamples, preferredTarget.name) : prometheusSamples
      const firstValues = pickValues(selectedSamples.find((sample) => sample.ok)?.values || {})
      const lastValues = pickValues(selectedSamples.findLast((sample) => sample.ok)?.values || {})
      const deltaValues = subtractValues(lastValues, firstValues)
      return {
        target: preferredTarget?.name ?? null,
        samples: selectedSamples.length,
        okSamples: selectedSamples.filter((sample) => sample.ok).length,
        chunksTotalDelta: metricsDelta(selectedSamples, 'nodeaccess_session_audit_chunks_total'),
        rawBytesTotalDelta: metricsDelta(selectedSamples, 'nodeaccess_session_audit_chunk_raw_bytes_total'),
        compressedBytesTotalDelta: metricsDelta(selectedSamples, 'nodeaccess_session_audit_chunk_compressed_bytes_total'),
        sessionsStartedDelta: metricsDelta(selectedSamples, 'nodeaccess_ssh_gateway_sessions_started_total'),
        activeConnectionsMax: metricsMax(selectedSamples, 'nodeaccess_ssh_gateway_connections_active'),
        firstValues,
        lastValues,
        deltaValues,
      }
    })(),
    recommendations: buildRecommendations({
      code,
      gatewaySummary,
      machineSamples,
      prometheusSamples,
      metricsTargets,
    }),
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
