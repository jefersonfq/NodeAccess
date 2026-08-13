import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  if (error instanceof Error) return error.message.slice(0, 180)
  return String(error).slice(0, 180)
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

function migrationsCheck(db: PrismaClient): Promise<HealthCheckResult> {
  return runCheck('migrations', async () => {
    await db.$queryRaw`SELECT COUNT(*) AS count FROM _prisma_migrations`
  })
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
    )
  }
  if (depth === 'deep') {
    checks.push(await migrationsCheck(deps.db))
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
