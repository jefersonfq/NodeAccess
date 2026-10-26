import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }))
import { runTrialOnePassword } from './trial-onepassword.js'
import { configureTrialPolicy, configureTrialProtectedAddresses } from './trial-policy.js'
const token = `ops_${Buffer.from(JSON.stringify({ signInAddress: 'my.1password.com' })).toString('base64url')}`
function childFixture(): EventEmitter & { stdin: PassThrough; stdout: PassThrough; kill: ReturnType<typeof vi.fn> } {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() })
  child.kill.mockImplementation(() => { child.emit('close', null); return true })
  return child
}
beforeEach(() => {
  vi.useFakeTimers(); mocked.spawn.mockReset()
  configureTrialProtectedAddresses(['8.8.4.4'])
  configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full' } }))
})
afterEach(() => { vi.useRealTimers(); configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([]) })
describe('trial SDK subprocess lifecycle', () => {
  it('kills a stalled SDK at30seconds and sends credentials only through stdin', async () => {
    const child = childFixture(); mocked.spawn.mockReturnValue(child)
    const result = runTrialOnePassword(1, token, 'op://synthetic')
    const rejection = expect(result).rejects.toMatchObject({ code: 'TRIAL_ONEPASSWORD_FAILED' })
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    const call: unknown[] = mocked.spawn.mock.calls[0] ?? []
    expect(JSON.stringify(call)).not.toContain(token)
    expect(call[2]).toEqual({ stdio: ['pipe', 'pipe', 'ignore'], env: { NODE_ENV: 'production' } })
  })
  it('kills the SDK at persisted expiry before the hard timeout', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 1000), profileJson: { experience: 'full' } }))
    const child = childFixture(); mocked.spawn.mockReturnValue(child)
    const result = runTrialOnePassword(1, token)
    const rejection = expect(result).rejects.toMatchObject({ code: 'TRIAL_ONEPASSWORD_FAILED' })
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('preserves a Unicode secret split across stdout chunks', async () => {
    const child = childFixture(); mocked.spawn.mockReturnValue(child)
    const result = runTrialOnePassword(1, token)
    await vi.advanceTimersByTimeAsync(0)
    const data = Buffer.from(JSON.stringify({ ok: true, value: 'synthetic-ção-🔐' }))
    for (const byte of data) child.stdout.write(Buffer.from([byte]))
    child.emit('close', 0)
    await expect(result).resolves.toBe('synthetic-ção-🔐')
  })
  it('rejects oversized stdout without returning partial secret content', async () => {
    const child = childFixture(); mocked.spawn.mockReturnValue(child)
    const result = runTrialOnePassword(1, token)
    const rejection = expect(result).rejects.toMatchObject({ code: 'TRIAL_ONEPASSWORD_FAILED' })
    await vi.advanceTimersByTimeAsync(0)
    child.stdout.write(Buffer.alloc(1024 * 1024 + 1, 'x'))
    await rejection
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
