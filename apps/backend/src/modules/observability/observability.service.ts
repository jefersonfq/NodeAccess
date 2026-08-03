import { execFile } from 'node:child_process'
import net from 'node:net'
import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import { env } from '../../config/env.js'

const execFileAsync = promisify(execFile)
const DEFAULT_TIMEOUT_MS = 2500
const DEFAULT_CACHE_TTL_MS = 5000
const DEFAULT_HISTORY_LIMIT = 60
const DEFAULT_CPU_WARNING_PERCENT = 85
const DEFAULT_MEMORY_WARNING_PERCENT = 85
const DEFAULT_DISK_WARNING_PERCENT = 90
const DEFAULT_BACKUP_MAX_AGE_HOURS = 30
const APP_VERSION = process.env.APP_VERSION || process.env.npm_package_version || '0.1.0'

export type ObservabilityStatus = 'ok' | 'degraded' | 'unavailable'

export interface HostDiskMetric {
  mount: string
  path: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usedPercent: number
}

export interface DockerContainerMetric {
  id?: string
  name: string
  cpuPercent: number | null
  memoryUsageBytes: number | null
  memoryLimitBytes: number | null
  memoryPercent: number | null
  networkInputBytes: number | null
  networkOutputBytes: number | null
  blockInputBytes: number | null
  blockOutputBytes: number | null
}

export interface ComponentHealthMetric {
  name: 'api' | 'gateway' | 'mysql' | 'redis' | 'guacd'
  status: ObservabilityStatus
  latencyMs: number
  message?: string
}

export interface BackupMetric {
  type: 'mysql' | 'session_audit'
  status: ObservabilityStatus
  directory: string
  latestFile: string | null
  latestModifiedAt: string | null
  ageHours: number | null
  message?: string
}

export interface ObservabilityHistoryPoint {
  timestamp: string
  status: ObservabilityStatus
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
  unavailableComponents: number
  unavailableBackups: number
  dockerStatus: ObservabilityStatus
}

export interface ObservabilityThresholds {
  cpuWarningPercent: number
  memoryWarningPercent: number
  diskWarningPercent: number
  backupMaxAgeHours: number
}

export interface ObservabilitySnapshot {
  status: ObservabilityStatus
  timestamp: string
  version: string
  cacheTtlMs: number
  host: {
    hostname: string
    platform: NodeJS.Platform
    arch: string
    uptimeSeconds: number
    cpu: {
      cores: number
      model: string | null
      loadAverage: {
        oneMinute: number
        fiveMinutes: number
        fifteenMinutes: number
      }
      loadPercentOfCores: number | null
    }
    memory: {
      totalBytes: number
      freeBytes: number
      usedBytes: number
      usedPercent: number
      processRssBytes: number
      processHeapUsedBytes: number
      processHeapTotalBytes: number
    }
    disks: HostDiskMetric[]
  }
  docker: {
    status: ObservabilityStatus
    containers: DockerContainerMetric[]
    message?: string
  }
  components: ComponentHealthMetric[]
  backups: BackupMetric[]
  scope: {
    kind: 'node'
    nodeId: string
    aggregation: 'local-only'
    note: string
  }
  thresholds: ObservabilityThresholds
  history: ObservabilityHistoryPoint[]
  warnings: string[]
}

interface CommandResult {
  stdout: string
  stderr: string
}

type CommandRunner = (file: string, args: string[], timeoutMs: number) => Promise<CommandResult>

export interface ObservabilityOptions {
  now?: () => Date
  commandRunner?: CommandRunner
  deps?: { db: PrismaClient; redis: Redis }
  timeoutMs?: number
  cacheTtlMs?: number
  diskPaths?: string[]
  backupDir?: string
  fetcher?: typeof fetch
  includeComponents?: boolean
  recordHistory?: boolean
}

let cachedSnapshot: { expiresAt: number; value: ObservabilitySnapshot } | null = null
let snapshotHistory: ObservabilityHistoryPoint[] = []

async function defaultCommandRunner(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  const result = await execFileAsync(file, args, {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function percent(used: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return round((used / total) * 100)
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean).map((item) => path.resolve(item))))
}

function defaultDiskPaths(): string[] {
  return uniquePaths([
    process.cwd(),
    env.SESSION_AUDIT_STORAGE_DIR,
    process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups'),
  ])
}

function backupDir(): string {
  return process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups')
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function observabilityThresholds(): ObservabilityThresholds {
  return {
    cpuWarningPercent: envNumber('OBSERVABILITY_CPU_WARNING_PERCENT', DEFAULT_CPU_WARNING_PERCENT),
    memoryWarningPercent: envNumber('OBSERVABILITY_MEMORY_WARNING_PERCENT', DEFAULT_MEMORY_WARNING_PERCENT),
    diskWarningPercent: envNumber('OBSERVABILITY_DISK_WARNING_PERCENT', DEFAULT_DISK_WARNING_PERCENT),
    backupMaxAgeHours: envNumber(
      'OBSERVABILITY_BACKUP_MAX_AGE_HOURS',
      envNumber('MAX_BACKUP_AGE_HOURS', DEFAULT_BACKUP_MAX_AGE_HOURS),
    ),
  }
}

function parsePercent(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Number(value.replace('%', '').trim().replace(',', '.'))
  return Number.isFinite(parsed) ? round(parsed) : null
}

function parseSizeToBytes(raw: string): number | null {
  const value = raw.trim()
  if (!value || value === '-') return null
  const match = value.match(/^([\d.,]+)\s*([kmgtp]?i?b|b)?$/i)
  const rawAmount = match?.[1]
  if (!rawAmount) return null
  const amount = Number(rawAmount.replace(',', '.'))
  if (!Number.isFinite(amount)) return null

  const unit = (match[2] || 'B').toLowerCase()
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    pb: 1000 ** 5,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    pib: 1024 ** 5,
  }

  return Math.round(amount * (multipliers[unit] ?? 1))
}

function parsePair(raw: unknown): { input: number | null; output: number | null } {
  if (typeof raw !== 'string') return { input: null, output: null }
  const [inputRaw, outputRaw] = raw.split('/').map((item) => item.trim())
  return {
    input: inputRaw ? parseSizeToBytes(inputRaw) : null,
    output: outputRaw ? parseSizeToBytes(outputRaw) : null,
  }
}

function parseDockerLine(line: string): DockerContainerMetric | null {
  if (!line.trim()) return null
  let row: Record<string, unknown>
  try {
    row = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }

  const memory = parsePair(row.MemUsage ?? row.Mem)
  const network = parsePair(row.NetIO)
  const block = parsePair(row.BlockIO)
  const name = String(row.Name ?? row.Container ?? row.ID ?? '').trim()
  if (!name) return null

  return {
    ...(typeof row.ID === 'string' ? { id: row.ID } : {}),
    name,
    cpuPercent: parsePercent(row.CPUPerc),
    memoryUsageBytes: memory.input,
    memoryLimitBytes: memory.output,
    memoryPercent: parsePercent(row.MemPerc),
    networkInputBytes: network.input,
    networkOutputBytes: network.output,
    blockInputBytes: block.input,
    blockOutputBytes: block.output,
  }
}

export function parseDockerStatsOutput(stdout: string): DockerContainerMetric[] {
  return stdout
    .split(/\r?\n/)
    .map(parseDockerLine)
    .filter((item): item is DockerContainerMetric => Boolean(item))
}

function parseDfOutput(stdout: string, targetPath: string): HostDiskMetric | null {
  const lines = stdout.trim().split(/\r?\n/)
  const row = lines.at(-1)
  if (!row) return null
  const columns = row.trim().split(/\s+/)
  if (columns.length < 6) return null

  const totalKb = Number(columns[1])
  const usedKb = Number(columns[2])
  const availableKb = Number(columns[3])
  if (![totalKb, usedKb, availableKb].every(Number.isFinite)) return null

  return {
    mount: columns.slice(5).join(' '),
    path: targetPath,
    totalBytes: totalKb * 1024,
    usedBytes: usedKb * 1024,
    availableBytes: availableKb * 1024,
    usedPercent: percent(usedKb, totalKb),
  }
}

async function collectDisks(paths: string[], commandRunner: CommandRunner, timeoutMs: number): Promise<HostDiskMetric[]> {
  const disks = await Promise.all(paths.map(async (targetPath) => {
    try {
      const result = await commandRunner('df', ['-Pk', targetPath], timeoutMs)
      return parseDfOutput(result.stdout, targetPath)
    } catch {
      return null
    }
  }))

  return disks.filter((item): item is HostDiskMetric => Boolean(item))
}

async function collectDocker(commandRunner: CommandRunner, timeoutMs: number): Promise<ObservabilitySnapshot['docker']> {
  try {
    const result = await commandRunner('docker', ['stats', '--no-stream', '--format', 'json'], timeoutMs)
    return {
      status: 'ok',
      containers: parseDockerStatsOutput(result.stdout),
    }
  } catch (error) {
    return {
      status: 'unavailable',
      containers: [],
      message: dockerUnavailableMessage(error),
    }
  }
}

function sanitizeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)
}

function dockerUnavailableMessage(error: unknown): string {
  const raw = sanitizeMessage(error).toLowerCase()
  if (raw.includes('permission') || raw.includes('eperm') || raw.includes('denied')) {
    return 'A API nao tem permissao para consultar o Docker deste no.'
  }
  if (raw.includes('not found') || raw.includes('enoent')) {
    return 'Comando docker nao encontrado no ambiente da API.'
  }
  if (raw.includes('timeout')) {
    return 'Consulta ao Docker excedeu o tempo limite.'
  }
  return 'Docker stats indisponivel neste no. Verifique se a API tem acesso ao Docker CLI/socket.'
}

async function runTimedHealth(
  name: ComponentHealthMetric['name'],
  action: () => Promise<void>,
): Promise<ComponentHealthMetric> {
  const started = Date.now()
  try {
    await action()
    return { name, status: 'ok', latencyMs: Date.now() - started }
  } catch (error) {
    return {
      name,
      status: 'unavailable',
      latencyMs: Date.now() - started,
      message: sanitizeMessage(error),
    }
  }
}

async function httpHealthCheck(url: string, fetcher: typeof fetch, timeoutMs: number): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } finally {
    clearTimeout(timer)
  }
}

async function tcpHealthCheck(host: string, port: number, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`timeout connecting to ${host}:${port}`))
    }, timeoutMs)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function collectComponents(options: ObservabilityOptions, timeoutMs: number): Promise<ComponentHealthMetric[]> {
  const fetcher = options.fetcher ?? fetch
  const checks: Promise<ComponentHealthMetric>[] = [
    runTimedHealth('api', async () => {
      await httpHealthCheck(`http://127.0.0.1:${env.APP_PORT_API}/health/ready`, fetcher, timeoutMs)
    }),
    runTimedHealth('gateway', async () => {
      await httpHealthCheck(`http://127.0.0.1:${env.APP_PORT_GATEWAY}/health/ready`, fetcher, timeoutMs)
    }),
    runTimedHealth('guacd', async () => {
      await tcpHealthCheck(env.GUACD_HOST, env.GUACD_PORT, timeoutMs)
    }),
  ]

  if (options.deps) {
    checks.push(
      runTimedHealth('mysql', async () => {
        await options.deps!.db.$queryRaw`SELECT 1`
      }),
      runTimedHealth('redis', async () => {
        const pong = await options.deps!.redis.ping()
        if (String(pong).toUpperCase() !== 'PONG') throw new Error(`unexpected ping response: ${pong}`)
      }),
    )
  }

  return Promise.all(checks)
}

async function latestBackupMetric(
  type: BackupMetric['type'],
  directory: string,
  patterns: RegExp[],
  now: Date,
): Promise<BackupMetric> {
  try {
    const entries = await readdir(directory)
    const candidates = await Promise.all(entries
      .filter((name) => patterns.some((pattern) => pattern.test(name)))
      .map(async (name) => {
        const fullPath = path.join(directory, name)
        const info = await stat(fullPath)
        return info.isFile() ? { name, fullPath, modifiedAt: info.mtime } : null
      }))
    const latest = candidates
      .filter((item): item is { name: string; fullPath: string; modifiedAt: Date } => Boolean(item))
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())[0]

    if (!latest) {
      return {
        type,
        status: 'unavailable',
        directory,
        latestFile: null,
        latestModifiedAt: null,
        ageHours: null,
        message: 'Backup não encontrado',
      }
    }

    return {
      type,
      status: 'ok',
      directory,
      latestFile: latest.fullPath,
      latestModifiedAt: latest.modifiedAt.toISOString(),
      ageHours: round((now.getTime() - latest.modifiedAt.getTime()) / 3_600_000),
    }
  } catch (error) {
    const raw = sanitizeMessage(error).toLowerCase()
    const message = raw.includes('no such file') || raw.includes('enoent')
      ? 'Diretorio de backups nao encontrado'
      : 'Nao foi possivel ler o diretorio de backups'
    return {
      type,
      status: 'unavailable',
      directory,
      latestFile: null,
      latestModifiedAt: null,
      ageHours: null,
      message,
    }
  }
}

function collectBackups(directory: string, now: Date): Promise<BackupMetric[]> {
  return Promise.all([
    latestBackupMetric('mysql', directory, [/^nodeaccess-mysql-.*\.(manifest\.json|sql\.gz)$/], now),
    latestBackupMetric('session_audit', directory, [/^nodeaccess-session-audit-.*\.(manifest\.json|tar\.gz)$/], now),
  ])
}

function historyLimit(): number {
  const configured = Number(process.env.OBSERVABILITY_HISTORY_LIMIT || DEFAULT_HISTORY_LIMIT)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_HISTORY_LIMIT
}

function latestDiskPercent(disks: HostDiskMetric[]): number | null {
  const highest = disks.reduce<HostDiskMetric | null>((current, disk) => {
    if (!current || disk.usedPercent > current.usedPercent) return disk
    return current
  }, null)
  return highest?.usedPercent ?? null
}

function applyBackupAgeThreshold(backups: BackupMetric[], maxAgeHours: number): BackupMetric[] {
  return backups.map((backup) => {
    if (backup.status !== 'ok' || backup.ageHours === null || backup.ageHours <= maxAgeHours) return backup
    return {
      ...backup,
      status: 'degraded',
      message: `Backup acima da idade recomendada (${backup.ageHours}h)`,
    }
  })
}

function recordHistoryPoint(point: ObservabilityHistoryPoint): ObservabilityHistoryPoint[] {
  snapshotHistory = [...snapshotHistory, point].slice(-historyLimit())
  return snapshotHistory.slice()
}

export async function buildObservabilitySnapshot(options: ObservabilityOptions = {}): Promise<ObservabilitySnapshot> {
  const now = options.now ?? (() => new Date())
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? Number(process.env.OBSERVABILITY_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS))
  const nowDate = now()
  const timestampMs = nowDate.getTime()
  if (!options.commandRunner && cachedSnapshot && cachedSnapshot.expiresAt > timestampMs) {
    return cachedSnapshot.value
  }

  const timeoutMs = options.timeoutMs ?? Number(process.env.OBSERVABILITY_COMMAND_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const commandRunner = options.commandRunner ?? defaultCommandRunner
  const thresholds = observabilityThresholds()
  const memoryUsage = process.memoryUsage()
  const totalMemory = os.totalmem()
  const freeMemory = os.freemem()
  const usedMemory = Math.max(0, totalMemory - freeMemory)
  const cpus = os.cpus()
  const loadAverage = os.loadavg()
  const diskPaths = uniquePaths(options.diskPaths ?? defaultDiskPaths())
  const resolvedBackupDir = options.backupDir ?? backupDir()

  const [disks, docker, components, rawBackups] = await Promise.all([
    collectDisks(diskPaths, commandRunner, timeoutMs),
    collectDocker(commandRunner, timeoutMs),
    options.includeComponents === false ? Promise.resolve([]) : collectComponents(options, timeoutMs),
    collectBackups(resolvedBackupDir, nowDate),
  ])
  const backups = applyBackupAgeThreshold(rawBackups, thresholds.backupMaxAgeHours)
  const cpuPercent = cpus.length > 0 ? percent(loadAverage[0] ?? 0, cpus.length) : null
  const memoryPercent = percent(usedMemory, totalMemory)
  const highestDiskPercent = latestDiskPercent(disks)

  const warnings: string[] = []
  if (docker.status !== 'ok') warnings.push('Docker stats indisponivel')
  if (disks.length === 0) warnings.push('Metricas de disco indisponiveis')
  if (cpuPercent !== null && cpuPercent >= thresholds.cpuWarningPercent) warnings.push(`CPU acima do limite (${cpuPercent}%)`)
  if (memoryPercent >= thresholds.memoryWarningPercent) warnings.push(`Memoria acima do limite (${memoryPercent}%)`)
  if (highestDiskPercent !== null && highestDiskPercent >= thresholds.diskWarningPercent) warnings.push(`Disco acima do limite (${highestDiskPercent}%)`)
  if (components.some((component) => component.status !== 'ok')) warnings.push('Um ou mais componentes estao indisponiveis')
  if (backups.some((backup) => backup.status === 'unavailable')) warnings.push('Um ou mais backups nao foram encontrados')
  if (backups.some((backup) => backup.status === 'degraded')) warnings.push('Um ou mais backups estao acima da idade recomendada')
  const status: ObservabilityStatus = warnings.length > 0 ? 'degraded' : 'ok'
  const currentHistoryPoint: ObservabilityHistoryPoint = {
    timestamp: nowDate.toISOString(),
    status,
    cpuPercent,
    memoryPercent,
    diskPercent: highestDiskPercent,
    unavailableComponents: components.filter((component) => component.status !== 'ok').length,
    unavailableBackups: backups.filter((backup) => backup.status !== 'ok').length,
    dockerStatus: docker.status,
  }
  const shouldRecordHistory = options.recordHistory ?? !options.commandRunner
  const history = shouldRecordHistory ? recordHistoryPoint(currentHistoryPoint) : [currentHistoryPoint]

  const snapshot: ObservabilitySnapshot = {
    status,
    timestamp: nowDate.toISOString(),
    version: APP_VERSION,
    cacheTtlMs,
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(os.uptime()),
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model ?? null,
        loadAverage: {
          oneMinute: round(loadAverage[0] ?? 0),
          fiveMinutes: round(loadAverage[1] ?? 0),
          fifteenMinutes: round(loadAverage[2] ?? 0),
        },
        loadPercentOfCores: cpuPercent,
      },
      memory: {
        totalBytes: totalMemory,
        freeBytes: freeMemory,
        usedBytes: usedMemory,
        usedPercent: memoryPercent,
        processRssBytes: memoryUsage.rss,
        processHeapUsedBytes: memoryUsage.heapUsed,
        processHeapTotalBytes: memoryUsage.heapTotal,
      },
      disks,
    },
    docker,
    components,
    backups,
    scope: {
      kind: 'node',
      nodeId: os.hostname(),
      aggregation: 'local-only',
      note: 'Snapshot local deste no. Em HA multi-maquina, use agregador para consolidar todos os nos.',
    },
    thresholds,
    history,
    warnings,
  }

  if (!options.commandRunner && cacheTtlMs > 0) {
    cachedSnapshot = { expiresAt: timestampMs + cacheTtlMs, value: snapshot }
  }

  return snapshot
}

export function clearObservabilityCache(): void {
  cachedSnapshot = null
  snapshotHistory = []
}
