import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { flowFailure, sanitizeFlowFailure, readFlowFailure } = createRequire(import.meta.url)('./sonar-flow-diagnostics.cjs')
test('diagnostics retain only known stage and error class, never raw error strings', () => {
  for (const [name, category] of [['AssertionError', 'ASSERTION'], ['TimeoutError', 'TIMEOUT'], ['TypeError', 'OTHER']]) assert.deepEqual(flowFailure('hosts-destination', { name, message: 'PRIVATE', stack: 'PRIVATE' }), { stage: 'hosts-destination', category })
  assert.deepEqual(flowFailure('PRIVATE', null), { stage: 'setup', category: 'OTHER' })
  assert.equal(sanitizeFlowFailure({ stage: 'PRIVATE', category: 'OTHER' }), undefined)
  assert.equal(sanitizeFlowFailure({ stage: 'setup', category: 'PRIVATE' }), undefined)
  assert.deepEqual(sanitizeFlowFailure({ stage: 'setup', category: 'OTHER', message: 'PRIVATE' }), { stage: 'setup', category: 'OTHER' })
})
test('report reader rejects absent, malformed, oversized and symlink artifacts', t => {
  const root = mkdtempSync(join(tmpdir(), 'flow-diagnostics-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'report.json')
  assert.equal(readFlowFailure(root), undefined)
  writeFileSync(file, '{'); assert.equal(readFlowFailure(root), undefined)
  writeFileSync(file, ' '.repeat(65537)); assert.equal(readFlowFailure(root), undefined)
  writeFileSync(file, JSON.stringify({ failure: { stage: 'jira', category: 'TIMEOUT', message: 'PRIVATE' } }))
  assert.deepEqual(readFlowFailure(root), { stage: 'jira', category: 'TIMEOUT' })
  const alias = root + '-alias'; symlinkSync(root, alias); t.after(() => rmSync(alias)); assert.equal(readFlowFailure(alias), undefined)
  const target = join(root, 'target'); writeFileSync(target, JSON.stringify({ failure: { stage: 'jira', category: 'TIMEOUT' } })); rmSync(file); symlinkSync(target, file); assert.equal(readFlowFailure(root), undefined)
})
