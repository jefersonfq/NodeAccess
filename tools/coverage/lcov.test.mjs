import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseLcov, addedLines, diffCoverage } from './lcov.mjs'

const record = (file, counts = [1, 0], branches = true) => `TN:\nSF:${file}\n${counts.map((count, index) => `DA:${index + 1},${count}`).join('\n')}\nLF:${counts.length}\nLH:${counts.filter(Boolean).length}\n${branches ? 'BRDA:2,0,0,1\nBRDA:2,0,1,-\nBRF:2\nBRH:1' : 'BRF:0\nBRH:0'}\nend_of_record\n`
test('LCOV keeps missing branch execution as uncovered and verifies source/totals', () => {
  const data = parseLcov(record('tools/example.mjs'), '/project')
  assert.equal(data.get('tools/example.mjs').lines.get(2), 0)
  assert.equal(data.get('tools/example.mjs').branches.get('2:0:1').hits, 0)
  for (const bad of [record('../escape.mjs'), record('tools/a.mjs').replace('LF:2', 'LF:8'),
    record('tools/a.mjs') + record('tools/a.mjs'), record('tools/a.mjs').replace('end_of_record', ''),
    record('tools/a.mjs').replace('DA:1,1', 'DA:1,-1'), record('tools/a.mjs').replace('BRDA:2,0,1,-', 'BRDA:2,0,0,1')]) {
    assert.throws(() => parseLcov(bad, '/project'))
  }
})
test('added-line hunks do not count deletions or unchanged context', () => {
  assert.deepEqual([...addedLines('@@ -1,2 +1,0 @@\n@@ -9 +7,2 @@\n@@ -20 +19 @@ name')], [7, 8, 19])
})
test('diff gate counts actual executable additions, enforces 80%, detects missing files and supports untracked code', t => {
  const root = mkdtempSync(join(tmpdir(), 'na0090-diff-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.email', 'fixture@example.test']); git(['config', 'user.name', 'Coverage fixture'])
  mkdirSync(join(root, 'tools')); writeFileSync(join(root, 'tools/example.mjs'), 'old\n')
  git(['add', '.']); git(['commit', '-qm', 'fixture']); const base = git(['rev-parse', 'HEAD'])
  writeFileSync(join(root, 'tools/example.mjs'), 'old\nnew\n')
  const result = diffCoverage(root, base, undefined, record('tools/example.mjs'))
  assert.equal(result.percent, 100 / 3); assert.equal(result.status, 'failed'); assert.equal(result.lines, 1)
  assert.equal(diffCoverage(root, base, undefined, record('tools/example.mjs', [1, 1], false)).status, 'passed')
  writeFileSync(join(root, 'tools/untracked.mjs'), 'new\n')
  assert.deepEqual(diffCoverage(root, base, undefined, record('tools/example.mjs')).missing, ['tools/untracked.mjs'])
  git(['add', '.']); git(['commit', '-qm', 'next']); const head = git(['rev-parse', 'HEAD'])
  const passed = diffCoverage(root, base, head, record('tools/example.mjs', [1, 1], false) + record('tools/untracked.mjs', [1], false))
  assert.equal(passed.status, 'passed'); assert.equal(passed.includesWorkingTree, false)
  assert.throws(() => diffCoverage(root, '--unsafe', head, ''))
})

test('rejects malformed records instead of dropping unknown or duplicated measurements', () => {
  const valid = record('tools/a.mjs')
  const invalid = [
    '', 'DA:1,1\n', valid.replace('SF:tools/a.mjs', 'SF:.'),
    valid.replace('DA:1,1', 'SF:tools/b.mjs'),
    valid.replace('DA:1,1', 'DA:0,1'), valid.replace('DA:1,1', 'DA:9007199254740992,1'),
    valid.replace('DA:1,1', 'DA:1,1\nDA:1,1'), valid.replace('DA:1,1', 'DA:x,1'),
    valid.replace('DA:1,1', 'DA:1,x'), valid.replace('DA:1,1', 'DA:1,9007199254740992'),
    valid.replace('BRDA:2,0,0,1', 'BRDA:0,0,0,1'), valid.replace('BRDA:2,0,0,1', 'BRDA:2,x,0,1'),
    valid.replace('BRDA:2,0,0,1', 'BRDA:2,0,0'), valid.replace('BRDA:2,0,0,1', 'BRDA:2,0,0,-1'),
    valid.replace('LF:2', 'LF:x'), valid.replace('LF:2', 'LF:2\nLF:2'),
    valid.replace('LF:2', 'UNRECOGNIZED:2'), valid.replace('BRH:1', 'BRH:2'),
  ]
  for (const text of invalid) assert.throws(() => parseLcov(text, '/project'))
  assert.equal(parseLcov(valid.replace('LF:2', 'FN:1,name\nFNDA:1,name\nFNF:1\nFNH:1\nLF:2'), '/project').size, 1)
  assert.throws(() => addedLines('@@ -1 +9007199254740992,1 @@'), /Invalid/)
  assert.throws(() => addedLines('@@ -1 +1,9007199254740992 @@'), /Invalid/)
})
