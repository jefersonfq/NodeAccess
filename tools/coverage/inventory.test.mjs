import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { isSource, sourceInventory, nodeTestFiles, sourceFingerprint } from './inventory.mjs'

test('inventory includes every executable layer and distinguishes tests, declarations and data', t => {
  const root = mkdtempSync(join(tmpdir(), 'na0090-inventory-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const sources = ['apps/frontend/src/App.vue', 'apps/backend/src/a.ts', 'apps/backend/prisma/seed.ts',
    'apps/agent/src/a.js', 'packages/shared/src/a.mts', 'scripts/a.mjs', 'tools/a.cjs', 'docker/csp/document.js', 'apps/frontend/public/sw.js']
  const tests = ['apps/agent/src/a.test.js', 'scripts/a.spec.mjs', 'tools/a.test.cjs', 'docker/csp/document.test.mjs']
  const other = ['apps/backend/src/a.d.ts', 'apps/frontend/src/a.test.ts', 'tools/input.json', 'outside.js', 'docker/unrelated.js', 'apps/frontend/public/unrelated.js']
  for (const file of [...sources, ...tests, ...other]) {
    mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), 'fixture\n')
  }
  execFileSync('git', ['add', '.'], { cwd: root })
  rmSync(join(root, sources[0]))
  assert.deepEqual(sourceInventory(root), sources.slice(1).sort())
  assert.deepEqual(nodeTestFiles(root), tests.sort())
  for (const file of sources) assert.equal(isSource(file), true)
  for (const file of [...tests, ...other]) assert.equal(isSource(file), false)
  const before = sourceFingerprint(root, sourceInventory(root))
  writeFileSync(join(root, sources[1]), 'changed')
  assert.notEqual(sourceFingerprint(root, sourceInventory(root)), before)
  assert.equal(sourceFingerprint(root, sourceInventory(root)), sourceFingerprint(root, sourceInventory(root)))
})
