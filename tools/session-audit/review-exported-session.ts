/** Read-only inspection of user-provided JSONL exports. Raw content stays in a private local artifact. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildCommandTimeline, parsePreviewLine } from '../../apps/backend/src/modules/session-audit/session-audit-normalizer.js'
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const events = lines.map(parsePreviewLine).filter(e => e !== null)
  const commands = buildCommandTimeline(events)
  const id = file.match(/session-audit-(\d+)/)?.[1] ?? 'export'
  const artifact = `/tmp/nodeaccess-audit-${id}-review.json`
  writeFileSync(artifact, JSON.stringify({ events, commands }), { mode: 0o600 })
  console.log(JSON.stringify({ file, artifact, events: events.length, invalidLines: lines.length - events.length, commandCount: commands.length, commands: commands.map(c => ({ index: c.index, verb: c.command.split(/\s/)[0], length: c.command.length, outputLength: c.output.length, confidence: c.confidence, warnings: c.reconstructionWarnings?.length ?? 0, digest: createHash('sha256').update(c.command).digest('hex') })) }))
}
