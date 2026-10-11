import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const url = process.env.HARDENING_DATABASE_URL
if (!url?.startsWith('mysql://root:hardening-test-only@127.0.0.1:3308/hardening')) throw new Error('Disposable DB required')
Object.assign(process.env, { DATABASE_URL: url, REDIS_URL: 'redis://127.0.0.1:6383', JWT_SECRET: 'hardening-test-jwt-secret-at-least-thirty-two-characters', PEM_ENCRYPTION_KEY: '1'.repeat(64), NODE_ENV: 'test' })
const { encrypt } = await import('../../apps/backend/src/shared/crypto.js')
const db = new PrismaClient({ datasources: { db: { url } } })
let received!: () => void
const remoteStarted = new Promise<void>(resolve => { received = resolve })
let calls = 0
const receiver = createServer((_req, res) => { calls++; received(); setTimeout(() => { res.writeHead(204); res.end() }, 8000) })
await new Promise<void>(resolve => receiver.listen(3189, '127.0.0.1', resolve))
const tenant = await db.tenant.create({ data: { name: 'Shutdown lab', slug: `shutdown-${randomUUID()}` } })
const secret = encrypt('disposable-jira-token')
await db.integration.create({ data: { tenantId: tenant.id, provider: 'jira', enabled: true, config: JSON.stringify({ authMode: 'api_token', baseUrl: 'http://127.0.0.1:3189', serviceAccountEmail: 'lab@example.invalid', apiTokenEncrypted: secret.encrypted, apiTokenIv: secret.iv }) } })
const event = await db.jiraOutboxEvent.create({ data: { tenantId: tenant.id, interactionId: randomUUID(), action: 'COMMENT_END', idempotencyKey: randomUUID(), payloadJson: { ticketKey: 'LAB-1' } } })
let logs = ''
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/backend/src/server.ts'], { env: { ...process.env, APP_MODE: 'api', APP_PORT_API: '3188', FEATURE_SESSION_AUDIT_AI_SUMMARY: 'false', FEATURE_NATIVE_SSH_GATEWAY: 'false', TRUST_PROXY: 'false', SESSION_AUDIT_STORAGE_DIR: '/tmp/nodeaccess-hardening-audit', GOOGLE_DIRECTORY_SYNC_INITIAL_DELAY_MS: '300000' }, stdio: ['ignore', 'pipe', 'pipe'] })
child.stdout.on('data', data => { logs += String(data) }); child.stderr.on('data', data => { logs += String(data) })
const exit = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))
try {
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error('API exited before ready')
    try { ready = (await fetch('http://127.0.0.1:3188/health/ready')).ok } catch { /* startup */ }
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert(ready, 'Real API startup deadline')
  await Promise.race([remoteStarted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Jira did not start with AI summary disabled')), 30000))])
  const start = Date.now(); child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 300))
  const readiness = await fetch('http://127.0.0.1:3188/health/ready')
  assert.equal(readiness.status, 503)
  const code = await Promise.race([exit, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Shutdown deadline exceeded')), 45000))])
  assert.equal(code, 0)
  assert.equal(calls, 1)
  assert.equal((await db.jiraOutboxEvent.findUniqueOrThrow({ where: { id: event.id } })).status, 'COMPLETED')
  const result = { success: true, realApi: true, aiSummaryDisabled: true, jiraCalls: calls, shutdownMs: Date.now() - start, readinessDuringDrain: readiness.status, eventPersistedBeforeExit: true }
  await writeFile('docs/reviews/evidence/2026-10-05-engineering-hardening/api-shutdown.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  if (child.exitCode === null) child.kill('SIGKILL')
  receiver.closeAllConnections(); await new Promise<void>(resolve => receiver.close(() => resolve()))
  await db.$disconnect()
  await writeFile('docs/reviews/evidence/2026-10-05-engineering-hardening/api-shutdown.log', logs)
}
