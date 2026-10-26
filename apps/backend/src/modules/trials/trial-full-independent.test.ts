import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertTrialAccess, assertTrialHttpAccess, configureTrialPolicy,
  configureTrialProtectedAddresses, monitorTrialAccess, type TrialAccess,
} from './trial-policy.js'

const now = new Date('2026-10-25T12:00:00Z')
function trial(experience?: 'full' | 'guided'): TrialAccess {
  return {
    status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000),
    profileJson: { ...(experience ? { experience } : {}), resources: ['ssh', 'sftp', 'sharing', 'audit'] },
  }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => { configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([]); vi.useRealTimers() })

const tenantOperations = [
  ['POST', '/api/v1/users'], ['POST', '/api/v1/hosts'],
  ['POST', '/api/v1/snippets'], ['GET', '/api/v1/secrets'],
  ['POST', '/api/v1/forwardings'], ['GET', '/api/v1/mcp'],
  ['POST', '/api/v1/local-ai/chat'],
] as const

describe('NA0074 independent full/guided boundary', () => {
  it.each(tenantOperations)('full reaches ordinary tenant authorization: %s %s', async (method, path) => {
    configureTrialPolicy(() => Promise.resolve(trial('full')))
    await expect(assertTrialHttpAccess(18, method, path)).resolves.toBeUndefined()
  })
  it.each(tenantOperations)('legacy snapshot does not silently acquire capability: %s %s', async (method, path) => {
    configureTrialPolicy(() => Promise.resolve(trial()))
    await expect(assertTrialHttpAccess(18, method, path)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
  it.each(['full', 'guided'] as const)('expiry applies to %s before tenant capability', async experience => {
    configureTrialPolicy(() => Promise.resolve({ ...trial(experience), expiresAt: now }))
    await expect(assertTrialHttpAccess(18, 'GET', '/api/v1/hosts')).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
  })
  it.each(['full', 'guided'] as const)('local deadline closes %s transport without worker', async experience => {
    const initial = trial(experience)
    configureTrialPolicy(() => Promise.resolve(initial))
    const close = vi.fn()
    const stop = monitorTrialAccess(18, initial, close)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(close).toHaveBeenCalledTimes(1)
    stop()
  })
  it('missing metadata remains an ordinary tenant, never inferred from signup configuration', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    await expect(assertTrialAccess(19)).resolves.toBeNull()
    await expect(assertTrialHttpAccess(19, 'POST', '/api/v1/hosts')).resolves.toBeUndefined()
  })
  it('full does not swallow a metadata lookup failure', async () => {
    configureTrialPolicy(() => Promise.reject(new Error('unavailable')))
    await expect(assertTrialHttpAccess(18, 'POST', '/api/v1/users')).rejects.toThrow('unavailable')
  })
})
