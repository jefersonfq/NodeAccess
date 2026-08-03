#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const args = process.argv.slice(2)

function argValue(name, fallback) {
  const index = args.indexOf(name)
  if (index >= 0 && args[index + 1]) return args[index + 1]
  return fallback
}

function flagEnabled(name, fallback = false) {
  const value = process.env[name]
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function numberListEnv(name, fallback) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
  return parsed.length > 0 ? parsed : fallback
}

function latestJsonFile(directory) {
  if (!fs.existsSync(directory)) return null
  const files = fs.readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(directory, file)
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files[0]?.fullPath ?? null
}

function percentileSummary(summary, key) {
  return summary?.gatewaySummary?.[key] ?? { p50: 0, p95: 0, max: 0 }
}

function readReport(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function isHealthy(report, thresholds) {
  const gateway = report.gatewaySummary
  if (!gateway) return { ok: false, reasons: ['gateway-summary-missing'] }

  const reasons = []
  const failedRate = gateway.concurrency > 0 ? gateway.failed / gateway.concurrency : 1
  const cpuMax = report.machineSummary?.cpuPercent?.max ?? 0
  const memoryMax = report.machineSummary?.memoryUsedPercent?.max ?? 0
  const diskMax = Math.max(...(report.machineSummary?.disks || []).map((disk) => disk.usedPercent?.max ?? 0), 0)
  const containerCpuMax = Math.max(...(report.machineSummary?.containers?.containers || []).map((container) => container.cpuPercent?.max ?? 0), 0)
  const containerMemoryMax = Math.max(...(report.machineSummary?.containers?.containers || []).map((container) => container.memoryPercent?.max ?? 0), 0)
  const connectP95 = gateway.connectMs?.p95 ?? 0
  const firstOutputP95 = gateway.firstOutputMs?.p95 ?? 0
  const commandLatencyP95 = gateway.commandLatencyMs?.p95 ?? 0

  if (failedRate > thresholds.maxFailureRate) reasons.push(`failed-rate>${thresholds.maxFailureRate}`)
  if (connectP95 > thresholds.maxConnectP95Ms) reasons.push(`connect-p95>${thresholds.maxConnectP95Ms}`)
  if (firstOutputP95 > thresholds.maxFirstOutputP95Ms) reasons.push(`first-output-p95>${thresholds.maxFirstOutputP95Ms}`)
  if (commandLatencyP95 > thresholds.maxCommandLatencyP95Ms) reasons.push(`command-latency-p95>${thresholds.maxCommandLatencyP95Ms}`)
  if (cpuMax > thresholds.maxCpuPercent) reasons.push(`cpu-max>${thresholds.maxCpuPercent}`)
  if (memoryMax > thresholds.maxMemoryPercent) reasons.push(`memory-max>${thresholds.maxMemoryPercent}`)
  if (diskMax > thresholds.maxDiskPercent) reasons.push(`disk-max>${thresholds.maxDiskPercent}`)
  if (containerCpuMax > thresholds.maxContainerCpuPercent) reasons.push(`container-cpu-max>${thresholds.maxContainerCpuPercent}`)
  if (containerMemoryMax > thresholds.maxContainerMemoryPercent) reasons.push(`container-memory-max>${thresholds.maxContainerMemoryPercent}`)

  return { ok: reasons.length === 0, reasons }
}

function runCommand(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: 'inherit',
    })
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function seedLocal(hostCount, config) {
  const code = await runCommand(process.execPath, ['tools/load-tests/scripts/seed-local-loadtest.js'], {
    LOADTEST_HOST_COUNT: String(hostCount),
    LOADTEST_USER_COUNT: String(config.userCount),
    LOADTEST_PROFILE: config.profile,
    LOADTEST_MAX_ACTIVE_SESSIONS_TENANT: String(Math.max(...config.sessionCounts, 1000)),
    ...(config.commandSet ? { LOADTEST_COMMAND_SET: config.commandSet } : {}),
  })
  if (code !== 0) throw new Error(`seed-local-loadtest failed with exit code ${code}`)
}

async function runWave(hostCount, concurrency, config) {
  const reportsDir = path.join(config.reportsDir, `hosts-${hostCount}`, `sessions-${concurrency}`)
  fs.mkdirSync(reportsDir, { recursive: true })

  if (config.dryRun) {
    return {
      hostCount,
      concurrency,
      skipped: true,
      healthy: null,
      reasons: ['dry-run'],
      reportPath: null,
    }
  }

  const code = await runCommand(process.execPath, [
    'tools/load-tests/scripts/run-gateway-with-metrics.js',
    '--profile',
    config.profile,
    '--reports-dir',
    reportsDir,
  ], {
    CONCURRENCY: String(concurrency),
    HOLD_MS: String(config.holdMs),
    HOLD_JITTER_MS: String(config.holdJitterMs),
    COMMAND_INTERVAL_MS: String(config.commandIntervalMs),
    START_STAGGER_MS: String(config.startStaggerMs),
    METRICS_INTERVAL_MS: String(config.metricsIntervalMs),
    ...(config.metricsUrl ? { METRICS_URL: config.metricsUrl } : {}),
    ...(config.metricsUrls ? { METRICS_URLS: config.metricsUrls } : {}),
    ...(config.metricsToken ? { METRICS_TOKEN: config.metricsToken } : {}),
    ...(config.diskPaths ? { DISK_PATHS: config.diskPaths } : {}),
    ...(config.containerNames ? { CONTAINER_NAMES: config.containerNames } : {}),
    ...(config.containerNamePattern ? { CONTAINER_NAME_PATTERN: config.containerNamePattern } : {}),
    MAX_DISK_PERCENT: String(config.thresholds.maxDiskPercent),
    MAX_CONTAINER_CPU_PERCENT: String(config.thresholds.maxContainerCpuPercent),
    MAX_CONTAINER_MEMORY_PERCENT: String(config.thresholds.maxContainerMemoryPercent),
  })

  const reportPath = latestJsonFile(reportsDir)
  if (!reportPath) {
    return {
      hostCount,
      concurrency,
      exitCode: code,
      healthy: false,
      reasons: ['report-not-found'],
      reportPath: null,
    }
  }

  const report = readReport(reportPath)
  const health = isHealthy(report, config.thresholds)
  return {
    hostCount,
    concurrency,
    exitCode: code,
    healthy: health.ok && code === 0,
    reasons: code === 0 ? health.reasons : [`exit-code-${code}`, ...health.reasons],
    reportPath,
    connected: report.gatewaySummary?.connected ?? 0,
    failed: report.gatewaySummary?.failed ?? 0,
    commandsSent: report.gatewaySummary?.commandsSent ?? 0,
    bytesIn: report.gatewaySummary?.bytesIn ?? 0,
    connectMs: percentileSummary(report, 'connectMs'),
    firstOutputMs: percentileSummary(report, 'firstOutputMs'),
    commandLatencyMs: percentileSummary(report, 'commandLatencyMs'),
    cpuPercent: report.machineSummary?.cpuPercent ?? null,
    memoryUsedPercent: report.machineSummary?.memoryUsedPercent ?? null,
    disks: report.machineSummary?.disks ?? [],
    containers: report.machineSummary?.containers ?? null,
    tcpEstablished: report.machineSummary?.tcpEstablished ?? null,
    tcpTimeWait: report.machineSummary?.tcpTimeWait ?? null,
    tcpTotal: report.machineSummary?.tcpTotal ?? null,
    prometheusSummary: report.prometheusSummary ?? null,
    prometheusTargetsSummary: report.prometheusTargetsSummary ?? [],
    recommendations: report.recommendations ?? [],
  }
}

async function main() {
  const config = {
    profile: argValue('--profile', process.env.PROFILE_FILE || 'tools/load-tests/data/profile.local.json'),
    reportsDir: argValue('--reports-dir', process.env.REPORTS_DIR || 'tools/load-tests/reports/capacity-matrix'),
    hostCounts: numberListEnv('HOST_COUNTS', [100, 250, 500, 1000, 2000]),
    sessionCounts: numberListEnv('SESSION_COUNTS', [100, 200, 300, 500]),
    userCount: numberEnv('LOADTEST_USER_COUNT', 100),
    holdMs: numberEnv('HOLD_MS', 300_000),
    holdJitterMs: numberEnv('HOLD_JITTER_MS', 0),
    commandIntervalMs: numberEnv('COMMAND_INTERVAL_MS', 10_000),
    startStaggerMs: numberEnv('START_STAGGER_MS', 100),
    metricsIntervalMs: numberEnv('METRICS_INTERVAL_MS', 1000),
    metricsUrl: process.env.METRICS_URL || '',
    metricsUrls: process.env.METRICS_URLS || '',
    metricsToken: process.env.METRICS_TOKEN || '',
    diskPaths: process.env.DISK_PATHS || '',
    containerNames: process.env.CONTAINER_NAMES || '',
    containerNamePattern: process.env.CONTAINER_NAME_PATTERN || '',
    commandSet: process.env.LOADTEST_COMMAND_SET || '',
    seedLocal: flagEnabled('SEED_LOCAL', false),
    dryRun: flagEnabled('DRY_RUN', true),
    stopOnUnhealthy: flagEnabled('STOP_ON_UNHEALTHY', true),
    thresholds: {
      maxFailureRate: Number(process.env.MAX_FAILURE_RATE || 0.01),
      maxConnectP95Ms: numberEnv('MAX_CONNECT_P95_MS', 5000),
      maxFirstOutputP95Ms: numberEnv('MAX_FIRST_OUTPUT_P95_MS', 6000),
      maxCommandLatencyP95Ms: numberEnv('MAX_COMMAND_LATENCY_P95_MS', 3000),
      maxCpuPercent: numberEnv('MAX_CPU_PERCENT', 85),
      maxMemoryPercent: numberEnv('MAX_MEMORY_PERCENT', 85),
      maxDiskPercent: numberEnv('MAX_DISK_PERCENT', 90),
      maxContainerCpuPercent: numberEnv('MAX_CONTAINER_CPU_PERCENT', 200),
      maxContainerMemoryPercent: numberEnv('MAX_CONTAINER_MEMORY_PERCENT', 85),
    },
  }

  fs.mkdirSync(config.reportsDir, { recursive: true })

  const startedAt = new Date()
  const matrixResults = []

  for (const hostCount of config.hostCounts) {
    if (config.seedLocal && !config.dryRun) {
      await seedLocal(hostCount, config)
    }

    for (const concurrency of config.sessionCounts) {
      const result = await runWave(hostCount, concurrency, config)
      matrixResults.push(result)
      console.log(JSON.stringify(result, null, 2))

      if (config.stopOnUnhealthy && result.healthy === false) {
        break
      }
    }
  }

  const healthyWaves = matrixResults.filter((item) => item.healthy === true)
  const maxHealthySessions = healthyWaves.reduce((max, item) => Math.max(max, item.concurrency), 0)
  const recommendedSessionLimit = Math.floor(maxHealthySessions * 0.7)
  const summary = {
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    dryRun: config.dryRun,
    config,
    healthyLimit: {
      maxHealthySessions,
      recommendedSessionLimit,
      method: '70% da maior concorrencia saudavel medida',
    },
    results: matrixResults,
  }

  const summaryPath = path.join(config.reportsDir, `capacity-matrix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log(`\nCapacity matrix saved: ${summaryPath}`)

  if (matrixResults.some((item) => item.healthy === false)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
