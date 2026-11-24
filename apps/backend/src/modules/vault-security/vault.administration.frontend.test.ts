import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// NA-0188 — HTTPS browser flow of the vault administration (managers, proposal validity, pending notices, UX checks).
const enabled = process.env.NODEACCESS_COVERAGE_COLLECT === '1' || process.env.RUN_VAULT_ADMINISTRATION === 'true'
const keys = ['TMPDIR', 'NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'PEM_ENCRYPTION_KEY', 'PEM_ENCRYPTION_PREVIOUS_KEYS']

it('importing the administration harness leaves environment, umask and exit status unchanged', async () => {
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]])), mask = process.umask(), exitCode = process.exitCode
  const imported = await import('../../../../../tools/vault-security/administration-harness.mts')
  expect(typeof imported.executeAdministrationHarness).toBe('function')
  expect(keys.every(key => process.env[key] === before[key])).toBe(true)
  expect(process.umask()).toBe(mask)
  expect(process.exitCode).toBe(exitCode)
})

describe.skipIf(!enabled)('Vault administration HTTPS browser flow', () => {
  it('promotes and removes managers by two managers, changes proposal validity and shows pending notices', async () => {
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]])), mask = process.umask()
    const { executeAdministrationHarness } = await import('../../../../../tools/vault-security/administration-harness.mts')
    const { report, evidence } = await executeAdministrationHarness()
    expect(report, `Private evidence: ${evidence}`).toMatchObject({ status: 'passed', cleanup: true })
    expect(report.flow).toMatchObject({ status: 'passed', count: 14, audit: { proposals: 8, applied: 8 } })
    expect(JSON.parse(readFileSync(evidence, 'utf8'))).toEqual(report)
    expect(keys.every(key => process.env[key] === before[key])).toBe(true)
    expect(process.umask()).toBe(mask)
  }, 900_000) // NA-0198: 14 scenarios; CI collects coverage (slower)
})
