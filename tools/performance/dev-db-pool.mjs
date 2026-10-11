import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
if (process.env.RUN_DEV_RESOURCE_BENCH !== '1') throw Error('Opt-in required: RUN_DEV_RESOURCE_BENCH=1')
if (!['before', 'after'].includes(process.argv[2])) throw Error('Choose before (explicit URL) or after (dev defaults)')
const require = createRequire(root + '/package.json')
const { PrismaClient } = require('@prisma/client')
const { parse } = require('dotenv')
const { withDevelopmentPool } = await import(root + '/apps/backend/scripts/dev-runtime.mjs')
const local = parse(readFileSync(root + '/apps/backend/.env'))
if (local.NODE_ENV && local.NODE_ENV !== 'development') throw Error('Development environment required')
const url = process.argv[2] === 'before' ? local.DATABASE_URL : withDevelopmentPool(local).DATABASE_URL
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw Error('Local database required')
const clients = [0, 1].map(() => new PrismaClient({ datasources: { db: { url } }, log: [] }))
const rows = []
try {
  // No writes, no payloads in output. Exercises the same bounded indexed page.
  const query = client => client.host.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 12 })
  await Promise.all(clients.map(c => query(c)))
  for (const concurrency of [20, 50]) {
    for (let round = 0; round < 4; round++) {
      const times = [], errors = {}
      const start = performance.now()
      await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
        for (let i = 0; i < 10; i++) {
          const begin = performance.now()
          try { await query(clients[worker % 2]) }
          catch (error) { errors[error.code || 'unknown'] = (errors[error.code || 'unknown'] || 0) + 1 }
          times.push(performance.now() - begin)
        }
      }))
      times.sort((a,b) => a-b)
      rows.push({ concurrency, round, queries: times.length, elapsedMs: Math.round(performance.now() - start), p50Ms: +times[Math.ceil(times.length * .5)-1].toFixed(2), p95Ms: +times[Math.ceil(times.length * .95)-1].toFixed(2), errors })
    }
  }
  const report = { profile: process.argv[2], clients: 2, readOnly: true, urlLimit: new URL(url).searchParams.get('connection_limit') || 'Prisma default', rows }
  console.log(JSON.stringify(report))
  if (rows.some(r => Object.keys(r.errors).length)) process.exitCode = 1
} finally { await Promise.all(clients.map(c => c.$disconnect())) }
