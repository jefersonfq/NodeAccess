import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { auditHistorySecrets, GITLEAKS_IMAGE } from './history-secrets.mjs'

function fixture(t, { findings = [], scanStatus = findings.length ? 1 : 0, shallow = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'history-secret-test-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const output = join(cwd, 'reports')
  const calls = []
  const run = (command, args) => {
    calls.push({ command, args })
    if (args.includes('--is-shallow-repository')) return { status: 0, stdout: `${shallow}\n` }
    if (args[0] === 'clone') return { status: 0, stdout: '' }
    if (args.includes('HEAD')) return { status: 0, stdout: 'a'.repeat(40) }
    if (args.includes('--count')) return { status: 0, stdout: '143\n' }
    if (command === 'docker') {
      writeFileSync(join(output, 'gitleaks-history-redacted.json'), JSON.stringify(findings))
      return { status: scanStatus, stdout: '', stderr: 'private diagnostic sentinel' }
    }
    throw new Error('Unexpected command')
  }
  return { cwd, output, run, calls }
}

test('scans all refs in isolated mirror without network, with full redaction and pinned scanner', t => {
  const setup = fixture(t)
  const result = auditHistorySecrets(setup)
  assert.equal(result.exitCode, 0)
  assert.equal(result.summary.commits, 143)
  const clone = setup.calls.find(call => call.args[0] === 'clone')
  assert.deepEqual(clone.args.slice(0, 4), ['clone', '--mirror', '--no-local', '--'])
  const scan = setup.calls.find(call => call.command === 'docker').args
  for (const required of ['none', '--log-opts=--all', '--redact=100', GITLEAKS_IMAGE]) assert.ok(scan.includes(required))
  assert.ok(scan.some(arg => arg.endsWith(':/src:ro')))
  assert.equal(statSync(setup.output).mode & 0o777, 0o700)
  assert.equal(statSync(join(setup.output, 'gitleaks-history-redacted.json')).mode & 0o777, 0o600)
})

test('findings always require review; public summary excludes paths, matches and diagnostic text', t => {
  const setup = fixture(t, { findings: [{ RuleID: 'private-key', Secret: 'REDACTED', File: 'sensitive-path', Match: 'sensitive-context' }] })
  const result = auditHistorySecrets(setup)
  assert.equal(result.exitCode, 1)
  assert.equal(result.summary.status, 'review-required')
  assert.equal(result.summary.findings, 1)
  assert.doesNotMatch(JSON.stringify(result), /sensitive-|private diagnostic sentinel/)
})

test('shallow history fails closed before scanning', t => {
  const setup = fixture(t, { shallow: true })
  assert.equal(auditHistorySecrets(setup).exitCode, 2)
  assert.equal(setup.calls.length, 1)
})

for (const [name, options] of [
  ['scanner failure', { scanStatus: 2 }],
  ['non-redacted findings', { findings: [{ RuleID: 'generic-api-key', Secret: 'sentinel' }] }],
  ['inconsistent success with findings', { scanStatus: 0, findings: [{ RuleID: 'generic-api-key', Secret: 'REDACTED' }] }],
]) test(`${name} fails closed`, t => {
  const result = auditHistorySecrets(fixture(t, options))
  assert.equal(result.exitCode, 2)
  assert.equal(result.summary.passed, false)
  assert.doesNotMatch(JSON.stringify(result), /sentinel/)
})

test('failed rerun cannot leave an earlier passing summary or raw report', t => {
  const setup = fixture(t, { shallow: true })
  mkdirSync(setup.output)
  writeFileSync(join(setup.output, 'history-summary.json'), '{"passed":true}')
  writeFileSync(join(setup.output, 'gitleaks-history-redacted.json'), '[]')
  auditHistorySecrets(setup)
  assert.equal(JSON.parse(readFileSync(join(setup.output, 'history-summary.json'))).passed, false)
  assert.throws(() => statSync(join(setup.output, 'gitleaks-history-redacted.json')))
})
