/** Synthetic data only. Run after reconstruction-mysql-integration.mts on its disposable database. */
import { Prisma, PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { SessionAuditReconstructionRepository } from '../../apps/backend/src/modules/session-audit/session-audit-reconstruction.repository.js'
import { reconstructAudit } from '../../apps/backend/src/modules/session-audit/session-audit-reconstruction.js'

const db = new PrismaClient({
  datasources: { db: { url: 'mysql://root@127.0.0.1:13319/audit_reconstruction_test' } },
  log: [{ emit: 'event', level: 'query' }],
})
const queries: string[] = []
db.$on('query', event => queries.push(event.query))
const repo = new SessionAuditReconstructionRepository(db)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function snapshot(session: number, version: number, count: number, command = 'SELECT monthly_report FROM reports;') {
  const content = [
    { seq: 1, type: 'session_started', data: '' },
    { seq: 2, type: 'stdin', data: command + '\r' },
    { seq: 3, type: 'stdout', data: 'resultado ação 🔎\r\n' },
    { seq: 4, type: 'session_ended', data: '' },
  ].map(e => JSON.stringify({ seq: e.seq, ts: '2026-09-29T12:00:00Z', type: e.type, payload: { data: e.data } })).join('\n')
  const result = reconstructAudit([{ seq: 1, content }], 'COMPLETED', 1)
  result.metadata.id = hash(`${session}:${version}`)
  result.metadata.sourceFingerprint = hash(`source:${session}:${version}`)
  result.commands = Array.from({ length: count }, (_, index) => ({ ...result.commands[0]!, index: index + 1 }))
  result.metadata.commandCount = count
  return result
}
async function count(table: 'session_audit_reconstructions' | 'session_audit_derived_commands', session: number) {
  const result = table === 'session_audit_reconstructions'
    ? await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM session_audit_reconstructions WHERE session_id=${session}`
    : await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM session_audit_derived_commands c JOIN session_audit_reconstructions r ON r.id=c.run_id WHERE r.session_id=${session}`
  return Number(result[0]!.n)
}
function walk(value: unknown, predicate: (value: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [...(predicate(record) ? [record] : []), ...Object.values(record).flatMap(item => walk(item, predicate))]
}
async function explain(query: Prisma.Sql) {
  const rows = await db.$queryRaw<Array<Record<string, string>>>(Prisma.sql`EXPLAIN FORMAT=JSON ${query}`)
  return JSON.parse(Object.values(rows[0]!)[0]!) as unknown
}
async function main() {
  const checks: string[] = []
  // This script is rerunnable and only removes its own synthetic session range.
  await db.$executeRaw`DELETE FROM session_audits WHERE session_id BETWEEN 1000 AND 1099`
  const sessions = Array.from({ length: 50 }, (_, i) => Prisma.sql`(${1000 + i},${i % 2 + 1},'COMPLETED')`)
  await db.$executeRaw(Prisma.sql`INSERT INTO session_audits VALUES ${Prisma.join(sessions)}`)

  const empty = snapshot(1000, 0, 0)
  await repo.save(1, 1000, empty)
  assert.deepEqual(await repo.commands(1, 1000, empty.metadata.id), [])
  assert.equal(await repo.commands(2, 1000, empty.metadata.id), null)
  assert.equal(await repo.commands(1, 1002, empty.metadata.id), null)
  assert.equal(await repo.commands(1, 1000, 'f'.repeat(64)), null)
  checks.push('empty version differs from missing/foreign session/foreign tenant')

  const injection = "SELECT 'ação 🔎', '\\path', '\"'; DROP TABLE session_audits; --"
  const literal = snapshot(1000, 1, 1, injection)
  await repo.save(1, 1000, literal)
  assert.equal((await repo.commands(1, 1000, literal.metadata.id))?.[0]?.command, injection)
  assert.equal(await repo.commands(1, 1000, "' OR 1=1 --"), null)
  const sessionCount = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM session_audits WHERE session_id BETWEEN 1000 AND 1099`
  assert.equal(Number(sessionCount[0]!.n), 50)
  checks.push('SQL-like payload, quotes, backslashes and Unicode round-trip as data')

  const upgraded = structuredClone(literal)
  upgraded.metadata.id = hash('1000:processor-upgrade')
  upgraded.metadata.processorVersion = 'test-next-processor'
  upgraded.commands.forEach(c => { c.processorVersion = upgraded.metadata.processorVersion })
  await repo.save(1, 1000, upgraded)
  assert.equal((await repo.commands(1, 1000, literal.metadata.id))?.[0]?.processorVersion, literal.metadata.processorVersion)
  assert.equal((await repo.commands(1, 1000, upgraded.metadata.id))?.[0]?.processorVersion, 'test-next-processor')
  const duplicateKey = structuredClone(upgraded)
  duplicateKey.metadata.id = hash('inconsistent-identity')
  await assert.rejects(() => repo.save(1, 1000, duplicateKey))
  assert.equal(await count('session_audit_reconstructions', 1000), 3)
  checks.push('processor upgrade preserves prior commands; conflicting source/version identity cannot add rows')

  await assert.rejects(() => repo.save(2, 1000, snapshot(1000, 2, 1)))
  await assert.rejects(() => repo.save(1, 999999, snapshot(999999, 0, 1)))
  for (const status of ['RUNNING', 'PURGED']) {
    await db.$executeRaw`UPDATE session_audits SET status=${status} WHERE session_id=1002`
    await assert.rejects(() => repo.save(1, 1002, snapshot(1002, 0, 1)))
    assert.equal(await count('session_audit_reconstructions', 1002), 0)
  }
  await db.$executeRaw`UPDATE session_audits SET status='FAILED' WHERE session_id=1002`
  await repo.save(1, 1002, snapshot(1002, 0, 1))
  checks.push('writes enforce tenant, existing session and terminal status; FAILED accepted')

  const rollback = snapshot(1004, 0, 205)
  rollback.commands[204]!.index = 1 // Fails in third batch, after two successful INSERTs.
  const startRollback = queries.length
  await assert.rejects(() => repo.save(1, 1004, rollback))
  assert.ok(queries.slice(startRollback).filter(q => q.startsWith('INSERT INTO session_audit_derived_commands')).length >= 3)
  assert.equal(await count('session_audit_reconstructions', 1004), 0)
  assert.equal(await count('session_audit_derived_commands', 1004), 0)
  checks.push('third-batch constraint failure rolls back metadata and preceding batches')

  const large = snapshot(1004, 1, 600)
  const startWrite = queries.length
  const writeAt = performance.now()
  await Promise.all(Array.from({ length: 12 }, () => repo.save(1, 1004, large)))
  const writeMs = Math.round(performance.now() - writeAt)
  assert.equal(await count('session_audit_reconstructions', 1004), 1)
  assert.equal(await count('session_audit_derived_commands', 1004), 600)
  assert.equal(queries.slice(startWrite).filter(q => q.startsWith('INSERT INTO session_audit_derived_commands')).length, 6)
  const startRead = queries.length
  const readAt = performance.now()
  const commands = await repo.commands(1, 1004, large.metadata.id)
  const readMs = Math.round(performance.now() - readAt)
  assert.equal(queries.length - startRead, 1, 'one SQL statement for authorization and command data')
  assert.deepEqual(commands?.map(c => c.index), Array.from({ length: 600 }, (_, i) => i + 1))
  checks.push('12 concurrent saves: one version, six batches, 600 ordered commands, one read query')

  const wide = snapshot(1006, 0, 5)
  wide.commands.forEach(c => { c.output = 'ç'.repeat(300000) })
  const startWide = queries.length
  await repo.save(1, 1006, wide)
  assert.equal(queries.slice(startWide).filter(q => q.startsWith('INSERT INTO session_audit_derived_commands')).length, 5)
  assert.deepEqual((await repo.commands(1, 1006, wide.metadata.id))?.map(c => c.output), wide.commands.map(c => c.output))
  checks.push('UTF-8 byte budget splits wide outputs before row-count limit without truncation')

  // Populate enough sessions/versions to make indexed access meaningful.
  for (let session = 1010; session < 1050; session++) {
    for (let version = 0; version < 5; version++) await repo.save(session % 2 + 1, session, snapshot(session, version, 50))
  }
  for (let version = 0; version < 25; version++) await repo.save(1, 1008, snapshot(1008, version, 1))
  await db.$executeRaw`UPDATE session_audit_reconstructions SET created_at='2026-09-29 12:00:00.000' WHERE session_id=1008`
  const history = await repo.history(1, 1008)
  assert.equal(history.length, 20)
  assert.deepEqual(history.map(r => r.id), Array.from({ length: 25 }, (_, v) => hash(`1008:${v}`)).sort().reverse().slice(0, 20))
  checks.push('history bounded to 20 with deterministic order for equal timestamps')

  await db.$queryRawUnsafe('ANALYZE TABLE session_audit_reconstructions, session_audit_derived_commands')
  const historyPlan = await explain(Prisma.sql`SELECT r.metadata FROM session_audit_reconstructions r FORCE INDEX (audit_reconstruction_tenant_session_idx)
    JOIN session_audits a ON a.session_id=r.session_id AND a.tenant_id=r.tenant_id
    WHERE r.tenant_id=1 AND r.session_id=1008 AND a.status <> 'PURGED' ORDER BY r.created_at DESC,r.id DESC LIMIT 20`)
  const commandsPlan = await explain(Prisma.sql`SELECT c.command_text,c.payload FROM session_audit_reconstructions r
    JOIN session_audits a ON a.session_id=r.session_id AND a.tenant_id=r.tenant_id
    JOIN session_audit_derived_commands c ON c.run_id=r.id AND c.tenant_id=r.tenant_id
    WHERE r.id=${large.metadata.id} AND r.tenant_id=1 AND r.session_id=1004 AND a.status <> 'PURGED' ORDER BY c.command_index ASC`)
  const searchQuery = Prisma.sql`SELECT run_id FROM session_audit_derived_commands WHERE tenant_id=1 AND MATCH(command_text) AGAINST (${'monthly_report'} IN NATURAL LANGUAGE MODE)`
  const searchPlan = await explain(searchQuery)
  writeFileSync('/tmp/nodeaccess-audit-reconstruction-sql-plans.json', JSON.stringify({historyPlan,commandsPlan,searchPlan},null,2))
  for (const plan of [historyPlan, commandsPlan]) {
    assert.equal(walk(plan, o => o.access_type === 'ALL').length, 0, 'no full table scans')
    assert.equal(walk(plan, o => o.using_filesort === true).length, 0, 'index satisfies ordering')
  }
  assert.ok(walk(historyPlan, o => o.key === 'audit_reconstruction_tenant_session_idx').length)
  assert.ok(walk(commandsPlan, o => o.table_name === 'c' && ['ref', 'range'].includes(String(o.access_type))).length)
  assert.ok(walk(searchPlan, o => o.access_type === 'fulltext' && o.key === 'audit_derived_command_search_idx').length)
  const matches = await db.$queryRaw<Array<{ run_id: string }>>(searchQuery)
  const foreign = new Set((await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM session_audit_reconstructions WHERE tenant_id=2`).map(r => r.id))
  assert.ok(matches.length > 5000)
  assert.ok(matches.every(r => !foreign.has(r.run_id)))
  checks.push('EXPLAIN: indexed history and commands without filesort/table scans; FULLTEXT with tenant filter')

  await db.$executeRaw`UPDATE session_audits SET status='PURGED' WHERE session_id=1004`
  assert.equal(await repo.commands(1, 1004, large.metadata.id), null)
  assert.deepEqual(await repo.history(1, 1004), [])
  await db.$executeRaw`DELETE FROM session_audits WHERE session_id=1004`
  assert.equal(await count('session_audit_reconstructions', 1004), 0)
  const orphan = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM session_audit_derived_commands WHERE run_id=${large.metadata.id}`
  assert.equal(Number(orphan[0]!.n), 0)
  assert.equal((await repo.history(2, 1011)).length, 5)
  checks.push('retention denies reads and physical deletion cascades without affecting another tenant')

  const result = { ok: true, checks, syntheticSessions: 50, scaleCommands: 10000, write600ConcurrentMs: writeMs, read600Ms: readMs, plans: { history: historyPlan, commands: commandsPlan, search: searchPlan } }
  writeFileSync('/tmp/nodeaccess-audit-reconstruction-sql-review.json', JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, plans: 'saved in report' }))
}
main().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1 })
