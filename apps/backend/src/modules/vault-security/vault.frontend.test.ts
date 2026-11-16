import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const enabled = process.env.NODEACCESS_COVERAGE_COLLECT === '1' || process.env.RUN_VAULT_FRONTEND === 'true'
const keys = ['BROWSER_COVERAGE_DIR', 'BROWSER_COVERAGE_RUN_ID', 'TMPDIR', 'NODE_ENV', 'DATABASE_URL', 'REDIS_URL',
  'JWT_SECRET', 'PEM_ENCRYPTION_KEY', 'PEM_ENCRYPTION_PREVIOUS_KEYS', 'VAULT_REVIEW_OUTPUT']

it('importing the harness leaves environment, umask and exit status unchanged', async () => {
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]])), mask = process.umask(), exitCode = process.exitCode
  const imported = await import('../../../../../tools/vault-security/frontend-harness.mts')
  expect(typeof imported.executeFrontendHarness).toBe('function')
  expect(keys.every(key => process.env[key] === before[key])).toBe(true)
  expect(process.umask()).toBe(mask)
  expect(process.exitCode).toBe(exitCode)
})

describe.skipIf(!enabled)('Vault HTTPS browser integration with real backend and JWE', () => {
  it('reveals and copies only authorized values, discards late responses, and preserves catalogue/terminal flows', async () => {
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]])), mask = process.umask(), exitCode = process.exitCode
    const head = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const { executeFrontendHarness } = await import('../../../../../tools/vault-security/frontend-harness.mts')
    expect(keys.every(key => process.env[key] === before[key])).toBe(true)
    const { report, evidence } = await executeFrontendHarness()
    expect(report, `Private evidence: ${evidence}`).toMatchObject({ status: 'passed', head, cleanup: true, sourcesUnchanged: true })
    expect(report.flow).toMatchObject({ status: 'passed', count: 19 })
    expect(report.httpBoundary).toEqual({ status: 'passed', reasonVisible: true, revealDisabled: true, copyDisabled: true, vaultRequests: 0 })
    expect(report.catalogue).toMatchObject({ status: 'passed' })
    expect(report.catalogue).toHaveProperty('scenarios.length', 14)
    expect(report.terminal).toEqual({ exitCode: 0, timedOut: false })
    expect(report.terminalSnippets).toMatchObject({ refreshedOnOpen: true, transientFailureRecovered: true })
    expect(report.fingerprintAfter).toBe(report.fingerprintBefore)
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toEqual(report)
    expect(keys.every(key => process.env[key] === before[key])).toBe(true)
    expect(process.umask()).toBe(mask)
    expect(process.exitCode).toBe(exitCode)
  }, 420000)
})
