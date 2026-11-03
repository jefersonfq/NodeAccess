import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../..', import.meta.url))
const harness = resolve(root, 'tools/frontend/sonar-frontend-review.cjs')
test('all DOM fixtures bootstrap in an independent clone without local review branch objects', t => {
  const directory = mkdtempSync(join(tmpdir(), 'sonar-baseline-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const clone = join(directory, 'clone')
  execFileSync('/usr/bin/git', ['clone', '--no-local', '--single-branch', root, clone], { stdio: 'pipe', timeout: 30000 })
  assert.throws(() => execFileSync('/usr/bin/git', ['cat-file', '-e', '3aa551378^{commit}'], { cwd: clone, stdio: 'pipe' }))
  execFileSync('/usr/bin/git', ['merge-base', '--is-ancestor', 'f4a44b4b7ae87a8f688b1246d9e52a31f9a104bc', 'HEAD'], { cwd: clone, stdio: 'pipe' })
  const source = readFileSync(harness, 'utf8')
  const boundary = source.indexOf('async function main()')
  assert.ok(boundary > 0)
  const result = vm.runInNewContext(source.slice(0, boundary) + '\nJSON.stringify({labels:fixtures.length,native:nativeFixtures.length})', {
    require: createRequire(harness), __dirname: join(clone, 'tools/frontend'), process: { env: {} },
  }, { timeout: 10000 })
  assert.deepEqual(JSON.parse(result), { labels: 44, native: 10 })
})
