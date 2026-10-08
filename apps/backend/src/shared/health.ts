import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PrismaClient } from '@prisma/client'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Redis } from 'ioredis'
import { env } from '../config/env.js'

export type HealthStatus = 'ok' | 'degraded' | 'down'
export type HealthMode = 'api' | 'gateway'
export type HealthCheckName = 'process' | 'mysql' | 'redis' | 'migrations' | 'session_audit_storage'

export interface HealthCheckResult {
  name: HealthCheckName
  status: HealthStatus
  latencyMs: number
  message?: string
}

export interface HealthReport {
  status: HealthStatus
  mode: HealthMode
  version: string
  timestamp: string
  checks: HealthCheckResult[]
}

type HealthDepth = 'live' | 'ready' | 'deep'
type HealthRouteApp = {
  get(path: string, handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>): void
}

const HEALTH_TIMEOUT_MS = 2500
const APP_VERSION = process.env.APP_VERSION || process.env.npm_package_version || '0.1.0'

function statusCode(status: HealthStatus) {
  if (status === 'ok') return 200
  if (status === 'degraded') return 200
  return 503
}

function aggregateStatus(checks: HealthCheckResult[]): HealthStatus {
  if (checks.some((check) => check.status === 'down')) return 'down'
  if (checks.some((check) => check.status === 'degraded')) return 'degraded'
  return 'ok'
}

function sanitizeError(error: unknown) {
  return error instanceof Error && error.message.startsWith('timeout after ') ? 'DEPENDENCY_TIMEOUT' : 'DEPENDENCY_UNAVAILABLE'
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = HEALTH_TIMEOUT_MS): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function runCheck(name: HealthCheckName, action: () => Promise<void>): Promise<HealthCheckResult> {
  const started = Date.now()
  try {
    await withTimeout(action())
    return { name, status: 'ok', latencyMs: Date.now() - started }
  } catch (error) {
    return {
      name,
      status: 'down',
      latencyMs: Date.now() - started,
      message: sanitizeError(error),
    }
  }
}

function processCheck(): HealthCheckResult {
  return { name: 'process', status: 'ok', latencyMs: 0 }
}

function mysqlCheck(db: PrismaClient): Promise<HealthCheckResult> {
  return runCheck('mysql', async () => {
    await db.$queryRaw`SELECT 1`
  })
}

function redisCheck(redis: Redis): Promise<HealthCheckResult> {
  return runCheck('redis', async () => {
    const pong = await redis.ping()
    if (String(pong).toUpperCase() !== 'PONG') throw new Error(`unexpected ping response: ${pong}`)
  })
}

type MigrationRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }
const migrationChecks = new WeakMap<PrismaClient, { expiresAt: number; result: Promise<HealthCheckResult> }>()
let expectedMigrations: Promise<string[]> | undefined

export function assertMigrationsCurrent(rows: MigrationRow[], expected: string[]): void {
  const applied = new Set(rows.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name))
  if (!expected.length || rows.some(row => !row.finished_at && !row.rolled_back_at) || expected.some(name => !applied.has(name))) {
    throw new Error('MIGRATIONS_NOT_CURRENT')
  }
}

function migrationsCheck(db: PrismaClient, force = false): Promise<HealthCheckResult> {
  const cached = migrationChecks.get(db)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.result
  const result = runCheck('migrations', async () => {
    expectedMigrations ??= readdir(new URL('../../prisma/migrations/', import.meta.url), { withFileTypes: true })
      .then(items => items.filter(item => item.isDirectory()).map(item => item.name))
      .catch(error => { expectedMigrations = undefined; throw error })
    const rows = await db.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`
    assertMigrationsCurrent(rows, await expectedMigrations)
  })
  migrationChecks.set(db, { expiresAt: Date.now() + 10_000, result })
  return result
}

async function storageProbe(): Promise<void> {
  const dir = env.SESSION_AUDIT_STORAGE_DIR
  await mkdir(dir, { recursive: true })
  const info = await stat(dir)
  if (!info.isDirectory()) throw new Error('session audit storage path is not a directory')
  const filePath = path.join(dir, `.nodeaccess-health-${process.pid}-${randomUUID()}.tmp`)
  await writeFile(filePath, 'nodeaccess-health', { encoding: 'utf8', flag: 'wx' })
  const content = await readFile(filePath, 'utf8')
  if (content !== 'nodeaccess-health') throw new Error('session audit storage readback mismatch')
  await rm(filePath, { force: true })
}

function sessionAuditStorageCheck(): Promise<HealthCheckResult> {
  return runCheck('session_audit_storage', storageProbe)
}

export async function buildHealthReport(
  mode: HealthMode,
  depth: HealthDepth,
  deps: { db: PrismaClient; redis: Redis },
): Promise<HealthReport> {
  const checks: HealthCheckResult[] = [processCheck()]
  if (depth === 'ready' || depth === 'deep') {
    checks.push(
      await mysqlCheck(deps.db),
      await redisCheck(deps.redis),
      await sessionAuditStorageCheck(),
      await migrationsCheck(deps.db, depth === 'deep'),
    )
  }

  return {
    status: aggregateStatus(checks),
    mode,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    checks,
  }
}

export function registerHealthRoutes(
  app: HealthRouteApp,
  mode: HealthMode,
  deps: { db: PrismaClient; redis: Redis },
  options: { isDraining?: () => boolean } = {},
): void {
  async function send(depth: HealthDepth, reply: FastifyReply) {
    const report = await buildHealthReport(mode, depth, deps)
    return reply.status(statusCode(report.status)).send(report)
  }

  app.get('/health', async (_request, reply) => send('live', reply))
  app.get('/health/live', async (_request, reply) => send('live', reply))
  app.get('/health/ready', async (_request, reply) => {
    if (options.isDraining?.()) {
      return reply.status(503).send({
        status: 'down', mode, version: APP_VERSION, timestamp: new Date().toISOString(),
        checks: [{ name: 'process', status: 'down', latencyMs: 0, message: 'gateway draining' }],
      })
    }
    return send('ready', reply)
  })
  app.get('/health/deep', async (_request, reply) => send('deep', reply))
}
