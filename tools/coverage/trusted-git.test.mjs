import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { sourceInventory } from './inventory.mjs'
import { diffCoverage } from './lcov.mjs'
import { runCoverage } from './run.mjs'
import { validate } from '../sonarqube/validate.mjs'

test('coverage inventory/diff/run and validation use system Git even with a hostile PATH', async t => {
  const root = mkdtempSync(join(tmpdir(), 'na0115-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim()
  git(['init', '-q']); git(['config', 'user.email', 'fixture@example.test']); git(['config', 'user.name', 'Fixture'])
  mkdirSync(join(root, 'tools/sonarqube'), { recursive: true }); mkdirSync(join(root, 'docs/sonarqube'), { recursive: true })
  writeFileSync(join(root, 'tools/example.mjs'), 'export const fixture = 1\n')
  writeFileSync(join(root, 'docs/sonarqube/accepted-findings.json'), JSON.stringify({ schemaVersion: 1, findings: [] }))
  git(['add', '.']); git(['commit', '-qm', 'fixture']); const base = git(['rev-parse', 'HEAD'])
  const fakeBin = join(root, 'fake-bin'), marker = join(root, 'unexpected-git')
  mkdirSync(fakeBin); writeFileSync(join(fakeBin, 'git'), `#!/bin/sh\necho invoked > '${marker}'\nexit 73\n`, { mode: 0o700 })
  const originalPath = process.env.PATH
  process.env.PATH = fakeBin
  try {
    assert.deepEqual(sourceInventory(root), ['tools/example.mjs'])
    const lcov = 'SF:tools/example.mjs\nDA:1,1\nLF:1\nLH:1\nBRF:0\nBRH:0\nend_of_record\n'
    assert.equal(diffCoverage(root, base, base, lcov).status, 'passed')
    const coverage = await runCoverage({ root, base, execute: () => { throw new Error('fixture collector reached') } })
    assert.equal(coverage.head, base); assert.equal(coverage.resolvedBase, base)
    assert.equal(coverage.error, 'fixture collector reached')
    await assert.rejects(validate({ root, env: { SONAR_HOST_URL: 'http://127.0.0.1:9000', SONAR_TOKEN: 'synthetic-analysis', SONAR_REVIEW_TOKEN: 'synthetic-review', SONAR_BASE_SHA: base }, execute: () => { throw new Error('fixture validation reached') } }), /fixture validation reached/)
    assert.equal(existsSync(marker), false)
  } finally { if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath }
})
