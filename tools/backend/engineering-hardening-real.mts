import { fork } from 'node:child_process'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { JiraInteractionRepository } from '../../apps/backend/src/modules/integrations/jira-interaction.repository.js'
import { JiraOutboxWorker } from '../../apps/backend/src/modules/integrations/jira-outbox.worker.js'
import { WebhookRepository } from '../../apps/backend/src/modules/webhooks/webhook.repository.js'

const url = process.env.HARDENING_DATABASE_URL
if (!url || !url.startsWith('mysql://root:hardening-test-only@127.0.0.1:3308/hardening')) throw new Error('Disposable hardening MySQL on port 3308 required')
const db = new PrismaClient({ datasources: { db: { url } } })
const checks: string[] = []
const suffix = randomUUID()
try {
  const tenant = await db.tenant.create({ data: { name: 'Hardening lab', slug: `lab-${suffix}` } })
  const user = await db.user.create({ data: { name: 'Lab', email: `lab-${suffix}@example.invalid`, tenantId: tenant.id } })
  const sub = await db.webhookSubscription.create({ data: { tenantId: tenant.id, name: 'lab', targetUrl: 'https://example.invalid/hook', subscribedEventsJson: '[]', createdByUserId: user.id } })
  const jira = new JiraInteractionRepository(db)
  const webhooks = new WebhookRepository(db)
  const makeJira = () => jira.enqueue({ tenantId: tenant.id, interactionId: suffix, action: 'COMMENT_END', idempotencyKey: randomUUID(), payload: { ticketKey: 'LAB-1' } })
  const event = await makeJira()
  const wins = await Promise.all(Array.from({ length: 30 }, () => jira.claimOutbox(event.id, randomUUID())))
  assert.equal(wins.filter(Boolean).length, 1); checks.push('Jira: 30 concurrent consumers, exactly one claim')
  await db.jiraOutboxEvent.update({ where: { id: event.id }, data: { leaseUntil: new Date(0), claimToken: 'stale' } })
  assert.equal(await jira.claimOutbox(event.id, 'replacement'), true)
  assert.equal((await jira.completeOutbox(event.id, 'stale')).count, 0)
  assert.equal((await jira.completeOutbox(event.id, 'replacement')).count, 1)
  checks.push('Jira: crash recovery and stale-owner fencing')
  const failing = await makeJira(); await jira.claimOutbox(failing.id, 'failure')
  await jira.retryOutbox(failing.id, 8, 'HTTP 503', 'failure')
  assert.equal((await db.jiraOutboxEvent.findUniqueOrThrow({ where: { id: failing.id } })).status, 'FAILED')
  checks.push('Jira: exhausted attempts terminate')
  const payload = { subscriptionId: sub.id, tenantId: tenant.id, eventId: suffix, eventType: 'host.created', eventVersion: 1, resourceType: 'host', resourceId: '1', payloadJson: '{}', idempotencyKey: randomUUID(), nextAttemptAt: new Date() }
  const deliveries = await Promise.all(Array.from({ length: 20 }, () => webhooks.createDelivery({ ...payload, eventId: randomUUID() })))
  assert.equal(new Set(deliveries.map(d => d.id)).size, 1)
  checks.push('Webhooks: 20 concurrent inserts deduplicate into one delivery')
  const delivery = deliveries[0]
  const webhookWins = await Promise.all(Array.from({ length: 30 }, () => webhooks.claimDelivery(delivery.id, randomUUID(), 30_000)))
  assert.equal(webhookWins.filter(Boolean).length, 1)
  await db.webhookDelivery.update({ where: { id: delivery.id }, data: { leaseUntil: new Date(0), claimToken: 'stale' } })
  assert.equal(await webhooks.claimDelivery(delivery.id, 'replacement', 30_000), true)
  await webhooks.updateDelivery(delivery.id, { status: 'DELIVERED' }, 'stale')
  assert.equal((await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, 'PROCESSING')
  await webhooks.updateDelivery(delivery.id, { status: 'DELIVERED' }, 'replacement')
  assert.equal((await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, 'DELIVERED')
  checks.push('Webhooks: concurrent claim, expired lease recovery, stale-owner fencing')
  const legacy = await db.webhookDelivery.create({ data: { ...payload, deduplicationKey: null, status: 'PROCESSING', leaseUntil: null } })
  assert.equal(await webhooks.claimDelivery(legacy.id, 'legacy-recovery', 30_000), true)
  await webhooks.updateDelivery(legacy.id, { status: 'DEAD' }, 'legacy-recovery')
  checks.push('Webhooks: legacy PROCESSING rows recover without a lease')
  assert.equal((await webhooks.retryDelivery(legacy.id, tenant.id + 9999, sub.id)).count, 0)
  assert.equal((await webhooks.retryDelivery(legacy.id, tenant.id, sub.id + 9999)).count, 0)
  assert.equal((await webhooks.retryDelivery(delivery.id, tenant.id, sub.id)).count, 0)
  assert.equal((await webhooks.retryDelivery(legacy.id, tenant.id, sub.id)).count, 1)
  await db.webhookDelivery.update({ where: { id: legacy.id }, data: { status: 'DEAD', lastErrorCode: 'LEGACY_DUPLICATE' } })
  assert.equal((await webhooks.retryDelivery(legacy.id, tenant.id, sub.id)).count, 0)
  checks.push('Webhooks: retry isolates tenant/subscription and refuses successful or legacy duplicate delivery')

  let calls = 0
  for (let i = 0; i < 100; i++) await makeJira()
  const integrations = { findByProvider: async () => ({ enabled: true, config: '{}' }) }
  const remote = { buildBasicAuthorization: () => 'test', normalizeBaseUrl: () => 'https://jira.invalid', addComment: async () => { calls++; await new Promise(r => setTimeout(r, 2)) } }
  const workers = Array.from({ length: 10 }, () => new JiraOutboxWorker(jira, integrations as never, remote as never))
  for (let round = 0; round < 5; round++) await Promise.all(workers.map(w => w.tick()))
  assert.equal(calls, 100)
  assert.equal(await db.jiraOutboxEvent.count({ where: { tenantId: tenant.id, status: 'PENDING' } }), 0)
  checks.push('Jira: 100 events across 10 real concurrent workers, 100 remote effects')
  async function killConsumer(kind: string, row: number) {
    const child = fork('tools/backend/engineering-queue-crash-child.mts', [kind, String(row)], { execArgv: ['--import', 'tsx'], env: process.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Claim child timeout')) }, 15000)
      child.once('message', () => { clearTimeout(timer); resolve() })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(`Claim child exited ${code}`)) })
    })
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    child.kill('SIGKILL'); await exited
  }
  const crashEvent = await makeJira()
  await killConsumer('jira', crashEvent.id)
  assert.equal((await db.jiraOutboxEvent.findUniqueOrThrow({ where: { id: crashEvent.id } })).status, 'PROCESSING')
  await db.jiraOutboxEvent.update({ where: { id: crashEvent.id }, data: { leaseUntil: new Date(0) } })
  assert.equal(await jira.claimOutbox(crashEvent.id, 'after-sigkill'), true)
  await jira.completeOutbox(crashEvent.id, 'after-sigkill')
  const crashDelivery = await webhooks.createDelivery({ ...payload, idempotencyKey: randomUUID() })
  await killConsumer('webhook', crashDelivery.id)
  assert.equal((await db.webhookDelivery.findUniqueOrThrow({ where: { id: crashDelivery.id } })).status, 'PROCESSING')
  await db.webhookDelivery.update({ where: { id: crashDelivery.id }, data: { leaseUntil: new Date(0) } })
  assert.equal(await webhooks.claimDelivery(crashDelivery.id, 'after-sigkill', 30000), true)
  await webhooks.updateDelivery(crashDelivery.id, { status: 'DELIVERED' }, 'after-sigkill')
  checks.push('Actual SIGKILL of Jira and webhook consumer subprocesses: persistent state recovered after accelerated lease expiry')
  await db.$executeRawUnsafe('CREATE DATABASE hardening_migration')
  const migrationDb = new PrismaClient({ datasources: { db: { url: url.replace('/hardening', '/hardening_migration') } } })
  try {
    await migrationDb.$executeRawUnsafe('CREATE TABLE jira_outbox_events (id INT PRIMARY KEY, status VARCHAR(24), next_attempt_at DATETIME(3))')
    await migrationDb.$executeRawUnsafe('CREATE TABLE webhook_deliveries (id INT PRIMARY KEY, idempotency_key VARCHAR(128), status VARCHAR(24), last_error_code VARCHAR(64), last_error_message VARCHAR(512))')
    await migrationDb.$executeRawUnsafe("INSERT INTO webhook_deliveries (id,idempotency_key,status) VALUES (1, 'duplicate', 'DELIVERED'), (2, 'duplicate', 'PENDING'), (3, 'distinct', 'PROCESSING'), (4, 'delivered-later', 'PENDING'), (5, 'delivered-later', 'DELIVERED'), (6, 'all-pending', 'PENDING'), (7, 'all-pending', 'PENDING')")
    const sql = await readFile('apps/backend/prisma/migrations/20261005160000_engineering_queue_leases/migration.sql', 'utf8')
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter(s => s.trim())) await migrationDb.$executeRawUnsafe(statement)
    const rows = await migrationDb.$queryRawUnsafe<Array<{ id: number; deduplication_key: string | null; status: string }>>('SELECT id,deduplication_key,status FROM webhook_deliveries ORDER BY id')
    assert.equal(rows.length, 7); assert.equal(rows[0].deduplication_key, 'duplicate'); assert.equal(rows[1].deduplication_key, null); assert.equal(rows[1].status, 'DEAD'); assert.equal(rows[0].status, 'DELIVERED')
    assert.equal(rows[3].status, 'DEAD'); assert.equal(rows[3].deduplication_key, null); assert.equal(rows[4].deduplication_key, 'delivered-later'); assert.equal(rows[4].status, 'DELIVERED')
    assert.equal(rows[5].deduplication_key, 'all-pending'); assert.equal(rows[5].status, 'PENDING'); assert.equal(rows[6].status, 'DEAD')
    checks.push('Migration: history preserved, delivered winner preferred, otherwise oldest pending wins')
  } finally { await migrationDb.$disconnect(); await db.$executeRawUnsafe('DROP DATABASE hardening_migration') }
  await writeFile('docs/reviews/evidence/2026-10-05-engineering-hardening/mysql-real.json', JSON.stringify({ success: true, mysql: '8.4 disposable', checks }, null, 2))
  console.log(JSON.stringify({ success: true, checks }, null, 2))
} finally { await db.$disconnect() }
