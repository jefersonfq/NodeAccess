import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveExecutable } from '../shared/trusted-executable.cjs'

const root = resolve(import.meta.dirname, '../..')
test('ZAP Python driver contracts execute; tracing is enabled only by the aggregate', () => {
  assert.doesNotThrow(() => execFileSync(resolveExecutable('python3'), ['tools/security/zap-driver.test.py'], {
    cwd: root, env: process.env, timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: 'pipe',
  }))
})
