/** Opt-in regression: dependency pruning must preserve signed-agent source identity. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { sourceDigest } from '../../apps/agent/installer/windows/artifacts.mjs'

if (process.env.RUN_RELEASE_SOURCE_REAL !== 'true') throw Error('Set RUN_RELEASE_SOURCE_REAL=true for the disposable build proof')
const root = resolve(import.meta.dirname, '../..')
const tag = `nodeaccess-source-proof:${randomBytes(8).toString('hex')}`
const docker = args => execFileSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 8 * 1024 * 1024 })
try {
  docker(['build', '-f', 'docker/backend.Dockerfile', '--target', 'builder', '-t', tag, '.'])
  const actual = docker(['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', tag,
    '--input-type=module', '-e', "import {sourceDigest} from './apps/agent/installer/windows/artifacts.mjs'; process.stdout.write(sourceDigest())"])
  assert.equal(actual, sourceDigest(root), 'Pruning changed the canonical signed-agent source identity')
  console.log('PASS: builder retains exact signed-agent source identity after pruning')
} finally {
  try { docker(['image', 'rm', tag]) } catch { /* Do not hide the original build/assertion failure. */ }
}
