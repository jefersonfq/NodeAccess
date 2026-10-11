/** Local private corpus only; saves private TXT examples in /tmp, never in Git. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { reconstructAudit } from '../../apps/backend/src/modules/session-audit/session-audit-reconstruction.js'
import { terminalTranscript, commandTranscript } from '../../apps/backend/src/modules/session-audit/session-audit-text-export.js'
const folder = process.env.AUDIT_EXPORT_REVIEW_DIR
assert.ok(folder, 'AUDIT_EXPORT_REVIEW_DIR must point to private local fixtures')
const output = '/tmp/nodeaccess-readable-export-review'
mkdirSync(output, { recursive: true, mode: 0o700 })
const results = []
for (const [id, count] of [[136,14],[166,9],[183,7],[184,6]]) {
  const content = readFileSync(resolve(folder, `session-audit-${id}.jsonl`), 'utf8')
  const snapshot = reconstructAudit([{seq:1,content}], 'COMPLETED', 1)
  assert.equal(snapshot.commands.length, count)
  const original = JSON.stringify(snapshot)
  const terminal = await terminalTranscript(id!, snapshot)
  const commands = commandTranscript(id!, snapshot)
  assert.equal(JSON.stringify(snapshot), original)
  assert.ok(!terminal.includes('\x1b'))
  assert.ok(!terminal.includes('EVENTOS VÁLIDOS'))
  for (const command of snapshot.commands) assert.ok(commands.includes(command.command))
  const longCommands = snapshot.commands.filter(c => c.command.length > 100)
  for (const command of longCommands) assert.ok(terminal.includes(command.command), `Session ${id}: long command ${command.index} missing from rendered terminal`)
  writeFileSync(`${output}/session-${id}.txt`, terminal, {mode:0o600})
  writeFileSync(`${output}/session-${id}-commands.txt`, commands, {mode:0o600})
  results.push({id,events:snapshot.events.length,commands:count,terminalBytes:Buffer.byteLength(terminal),commandBytes:Buffer.byteLength(commands),longCommandsVerified:longCommands.length,sourceUnchanged:true})
}
const mobaPath = process.env.MOBAXTERM_REVIEW_LOG
if (mobaPath) {
  // The supplied sample uses a legacy single-byte encoding. This conversion is
  // only for the test import; existing NodeAccess JSONL stays Unicode unchanged.
  const raw = readFileSync(mobaPath)
  const text = new TextDecoder('windows-1252').decode(raw)
  const content = ['session_started','stdout','session_ended'].map((type,index)=>JSON.stringify({seq:index+1,ts:'2026-09-29T12:00:00Z',type,payload:{data:type==='stdout'?text:''}})).join('\n')
  const snapshot = reconstructAudit([{seq:1,content}],'COMPLETED',1)
  const rendered = await terminalTranscript(0,snapshot)
  for (const command of ['cd /var/log/','ls -lha','df -h','vim /etc/etc/my.cnf']) assert.ok(rendered.includes(command))
  assert.ok(rendered.includes('ATENÇÃO'))
  assert.ok(!rendered.includes('�'))
  writeFileSync(`${output}/mobaxterm-comparison.txt`,rendered,{mode:0o600})
  results.push({sample:'mobaxterm',bytes:raw.length,legacyDecoding:'windows-1252 (test import only)',commandsPreserved:true})
}
writeFileSync(`${output}/report.json`,JSON.stringify({ok:true,results},null,2),{mode:0o600})
console.log(JSON.stringify({ok:true,results}))
