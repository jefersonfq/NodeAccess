import { afterEach, describe, expect, it } from 'vitest'
import { trialLicenseData, isFullTrialProfile } from './trial-capabilities.js'
import { trialProfileSchema, trialProfileFromSnapshot } from './trial-contract.js'
import { assertTrialCapability, trialFeatureAvailable, assertTrialHostAccess, assertTrialHttpAccess, configureTrialPolicy, configureTrialProtectedAddresses } from './trial-policy.js'
const profile = trialProfileSchema.parse({ name: 'Full fixture', durationDays: 7, maxUsers: 3, maxHosts: 4, machineCount: 1, maxMachines: 1, allowCustomHosts: true, maxCustomHosts: 3, maxSessions: 2, templateId: 'fixture', networkCidr: '10.91.0.0/24', maxActiveTrials: 2, retentionDays: 30, privacyUrl: 'https://example.invalid/privacy', termsUrl: 'https://example.invalid/terms', privacyVersion: 'fixture', resources: ['ssh','sftp','sharing','audit'] })
afterEach(() => { configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([]) })
describe('full trial capabilities and compatibility', () => {
  it('does not silently upgrade old persisted profiles', () => {
    expect(isFullTrialProfile(profile)).toBe(false)
    expect(trialLicenseData(profile)).toMatchObject({ multiConnect: false, sessionAuditAiEnabled: false, integrationEntitlementsJson: {}, featureEntitlementsJson: { snippets: true, sharedSessions: true } })
  })
  it('grants tenant capabilities and intersects optional exclusions', () => {
    const data = trialLicenseData({ ...profile, experience: 'full', features: { mcp: false }, integrations: { ldap: false } })
    expect(data).toMatchObject({ multiConnect: true, sessionAuditEnabled: true, featureEntitlementsJson: { mcp: false, agents: true, secrets: true, localAi: true }, integrationEntitlementsJson: { ldap: false, jira: true } })
    expect(data.featureEntitlementsJson).not.toHaveProperty('ha')
  })
  it('enables only full tenant capabilities when installation flags are off and honors exclusions when flags are on', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    expect(await trialFeatureAvailable(1, false, 'mcp')).toBe(false)
    expect(await trialFeatureAvailable(1, true, 'mcp')).toBe(true)
    const trial = { status: 'ACTIVE', expiresAt: new Date(Date.now()+60000), profileJson: { ...profile, experience: 'full', features: { mcp: false } } }
    configureTrialPolicy(() => Promise.resolve(trial))
    expect(await trialFeatureAvailable(1, false, 'localAi')).toBe(true)
    expect(await trialFeatureAvailable(1, false, 'sessionAudit')).toBe(true)
    expect(await trialFeatureAvailable(1, true, 'mcp')).toBe(false)
    expect(await trialFeatureAvailable(1, false, 'mcp')).toBe(false)
  })
  it('accepts a final-day notice and preserves schema validation for runtime metadata', () => {
    expect(trialProfileSchema.parse({ ...profile, expiryNoticeHours: 24 }).expiryNoticeHours).toBe(24)
    expect(trialProfileFromSnapshot({ ...profile, experience: 'full', hostAddresses: ['10.91.0.5'], aiRequestsUsed: 2, aiRequestLeases: { fixture: 123 } })).toMatchObject({ experience: 'full' })
    expect(() => trialProfileSchema.parse({ ...profile, expiryNoticeHours: 25 })).toThrow()
  })
  it('blocks platform routes and expired/full-disabled capabilities', async () => {
    const trial = { status: 'ACTIVE', expiresAt: new Date(Date.now()+60000), profileJson: { ...profile, experience: 'full', features: { mcp: false } } }
    configureTrialPolicy(() => Promise.resolve(trial))
    await expect(assertTrialHttpAccess(1, 'PATCH', '/api/v1/settings/license')).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    await expect(assertTrialCapability(1, 'mcp')).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    trial.expiresAt = new Date(0)
    await expect(assertTrialCapability(1, 'agents')).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
  })
  it('permits full graphical/secret hosts but rejects protected destinations and second-hop bypass', async () => {
    configureTrialProtectedAddresses(['9.9.9.9'])
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now()+60000), profileJson: { ...profile, experience: 'full', hostAddresses: ['10.91.0.5'] } }))
    const host = { ip: '8.8.8.8', accessProtocol: 'RDP', connectionMode: 'DIRECT', passwordSecretId: 1 }
    await expect(assertTrialHostAccess(1, host)).resolves.toMatchObject({ status: 'ACTIVE' })
    for (const ip of ['9.9.9.9', '169.254.169.254', '10.91.0.6', 'localhost', '::1']) await expect(assertTrialHostAccess(1, { ...host, ip })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
    await expect(assertTrialHostAccess(1, { ...host, accessProtocol: 'SSH', ip: '192.168.50.10', connectionMode: 'AGENT_USER' }, true)).resolves.toMatchObject({ status: 'ACTIVE' })
    await expect(assertTrialHostAccess(1, { ...host, ip: '192.168.50.10', connectionMode: 'AUTO' }, true)).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
    await expect(assertTrialHostAccess(1, { ...host, ip: '192.168.50.10', connectionMode: 'AGENT_USER' })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
    await expect(assertTrialHostAccess(1, { ...host, bastion: { ip: '127.0.0.1' } })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
})
