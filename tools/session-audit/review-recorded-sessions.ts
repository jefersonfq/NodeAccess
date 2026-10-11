/** Read-only inventory/reconstruction review. Never connects to audited hosts. */
import { PrismaClient } from '@prisma/client'
import { readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildCommandTimeline, parsePreviewLine } from '../../apps/backend/src/modules/session-audit/session-audit-normalizer.js'
import type { SessionAuditPreviewEvent } from '@nodeaccess/shared'
const db = new PrismaClient()
const reportPath = process.env.AUDIT_REVIEW_REPORT ?? '/tmp/nodeaccess-recorded-audit-review.json'
async function main() {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL ?? '').hostname)) throw Error('This harness requires a local review database')
  const rows = await db.sessionAudit.findMany({ where: { commandCount: { gt: 5 } }, select: { sessionId: true, tenantId: true, commandCount: true, chunks: { orderBy: { seq: 'asc' }, select: { storageKey: true, seq: true } } }, orderBy: { sessionId: 'asc' } })
  const results = []
  for (const row of rows) {
    const events: SessionAuditPreviewEvent[] = []
    let missingChunks = 0, invalidLines = 0
    for (const chunk of row.chunks) {
      try {
        const bytes = await readFile(path.resolve(process.env.AUDIT_REVIEW_STORAGE_CWD ?? 'apps/backend', chunk.storageKey))
        const content = (chunk.storageKey.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')
        for (const line of content.split('\n')) { if (!line) continue; const event = parsePreviewLine(line); if (event) events.push(event); else invalidLines++ }
      } catch { missingChunks++ }
    }
    const commands = buildCommandTimeline(events)
    if (String(row.sessionId) === process.env.AUDIT_REVIEW_EXPORT_ID) {
      await writeFile(`/tmp/nodeaccess-audit-${row.sessionId}-review.json`, JSON.stringify({ events, commands }), { mode: 0o600 })
    }
    results.push({ sessionId: row.sessionId, tenantId: row.tenantId, storedCount: row.commandCount, reconstructedCount: commands.length, chunks: row.chunks.length, missingChunks, invalidLines,
      mysqlPrompt: events.some(e => e.type === 'stdout' && /mysql>|MariaDB \[/.test(e.text ?? '')),
      cursorEditing: events.some(e => e.type === 'stdin' && /\x1b\[[0-9;]*[CDHF]|[\x01\x05\x0b\x15\x17]/.test(e.text ?? '')),
      bracketedPaste: events.some(e => e.type === 'stdin' && /\x1b\[200~/.test(e.text ?? '')),
      lowConfidence: commands.filter(c => c.confidence === 'low').length,
      // Fingerprints allow before/after comparison without copying customer SQL/output into a report.
      digest: createHash('sha256').update(JSON.stringify(commands.map(c => [c.command, c.output]))).digest('hex'),
    })
  }
  const summary = { selected: results.length, readable: results.filter(r => r.chunks > 0 && !r.missingChunks).length, unavailable: results.filter(r => !r.chunks || r.missingChunks).length,
    mysql: results.filter(r => r.mysqlPrompt).length, edited: results.filter(r => r.cursorEditing).length, pasted: results.filter(r => r.bracketedPaste).length,
    countMismatch: results.filter(r => r.chunks && !r.missingChunks && r.storedCount !== r.reconstructedCount).length }
  await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ reportPath, ...summary }))
}
main().finally(() => db.$disconnect()).catch(error => { console.error(error.message); process.exitCode = 1 })
