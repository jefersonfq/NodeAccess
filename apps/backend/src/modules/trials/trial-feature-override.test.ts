import { afterEach, describe, expect, it } from 'vitest'
import { configureTrialPolicy, trialFeatureAvailable } from './trial-policy.js'

afterEach(() => configureTrialPolicy(() => Promise.resolve(null)))
describe('tenant-scoped feature override independently of installation switches', () => {
  it.each([false, true])('preserves ordinary tenant switch %s', async enabled => {
    configureTrialPolicy(() => Promise.resolve(null))
    expect(await trialFeatureAvailable(123, enabled, 'mcp')).toBe(enabled)
  })
  it.each(['mcp', 'localAi', 'sessionAudit'])('explicit full profile enables %s while installation stays disabled', async capability => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full', resources: ['audit'] } }))
    expect(await trialFeatureAvailable(123, false, capability)).toBe(true)
  })
  it.each([false, true])('explicit full capability denial wins over installation %s', async enabled => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full', features: { mcp: false, localAi: false, sessionAudit: false }, resources: ['audit'] } }))
    for (const capability of ['mcp', 'localAi', 'sessionAudit']) expect(await trialFeatureAvailable(123, enabled, capability)).toBe(false)
  })
  it('guided profile does not gain an installation override', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { resources: ['audit'] } }))
    expect(await trialFeatureAvailable(123, false, 'mcp')).toBe(false)
  })
  it('audit resource denial wins even if the installation switch is enabled', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full', resources: ['ssh'] } }))
    expect(await trialFeatureAvailable(123, true, 'sessionAudit')).toBe(false)
  })
  it.each([false, true])('expired full metadata cannot bypass switch %s', async enabled => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() - 1), profileJson: { experience: 'full' } }))
    await expect(trialFeatureAvailable(123, enabled, 'mcp')).rejects.toMatchObject({ statusCode: 403 })
  })
})
