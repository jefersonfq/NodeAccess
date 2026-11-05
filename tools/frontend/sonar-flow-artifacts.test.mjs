import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
function run(output) {
  return spawnSync(process.execPath, [join(root, 'tools/frontend/sonar-flow-coverage.cjs')], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, SONAR_FLOW_OUTPUT: output, FRONTEND_BASE: 'http://127.0.0.1:1' },
  })
}
for (const kind of ['public-directory', 'directory-symlink', 'report-symlink']) {
  test(`flow executable rejects ${kind} before browser startup and preserves the target`, () => {
    const temporary = mkdtempSync(join(tmpdir(), 'nodeaccess-flow-artifacts-'))
    try {
      const target = join(temporary, 'target'), output = join(temporary, 'output')
      mkdirSync(target, { mode: 0o700 }); writeFileSync(join(target, 'canary'), 'unchanged')
      if (kind === 'directory-symlink') symlinkSync(target, output)
      else {
        mkdirSync(output, { mode: 0o700 })
        if (kind === 'public-directory') chmodSync(output, 0o755)
        else symlinkSync(join(target, 'canary'), join(output, 'report.json'))
      }
      const result = run(output)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Harness artifact (?:root|path)/)
      assert.doesNotMatch(result.stderr, /browserType\.launch|Executable doesn't exist/)
      assert.equal(readFileSync(join(target, 'canary'), 'utf8'), 'unchanged')
      assert.deepEqual(readdirSync(target), ['canary'])
      if (kind === 'public-directory') assert.equal(lstatSync(output).mode & 0o777, 0o755)
      if (kind === 'directory-symlink') assert.equal(lstatSync(output).isSymbolicLink(), true)
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  })
}
