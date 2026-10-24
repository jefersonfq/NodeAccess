import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureTrialHostReader, configureTrialPolicy, configureTrialUserReader, monitorTrialAccess } from './trial-policy.js'
describe('live trial host revocation monitor', () => {
  afterEach(() => { vi.useRealTimers(); configureTrialPolicy(() => Promise.resolve(null)); configureTrialUserReader(() => Promise.resolve(true)); configureTrialHostReader(() => Promise.resolve(true)) })
  for (const reason of ['deleted host','changed address or port','database failure']) it(`closes an active transport after ${reason}`, async () => {
    vi.useFakeTimers()
    const trial = { status: 'ACTIVE', expiresAt: new Date(Date.now()+60000), profileJson: {} }
    configureTrialPolicy(() => Promise.resolve(trial))
    const reader = vi.fn(() => reason === 'database failure' ? Promise.reject(Error('unavailable')) : Promise.resolve(false))
    configureTrialHostReader(reader)
    const close = vi.fn(), identity = { id: 4, ip: '8.8.8.8', port: 22 }
    const stop = monitorTrialAccess(2, trial, close, { id: 3 }, identity)
    await vi.advanceTimersByTimeAsync(5000)
    expect(reader).toHaveBeenCalledWith(2, identity)
    expect(close).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(close).toHaveBeenCalledTimes(1)
    stop()
  })
  it('retains the hard deadline while the host lookup hangs', async () => {
    vi.useFakeTimers()
    const trial = { status: 'ACTIVE', expiresAt: new Date(Date.now()+6000), profileJson: {} }
    configureTrialPolicy(() => Promise.resolve(trial)); configureTrialHostReader(() => new Promise(() => {}))
    const close=vi.fn()
    const stop=monitorTrialAccess(2,trial,close,undefined,{id:4,ip:'8.8.8.8',port:22})
    await vi.advanceTimersByTimeAsync(6000)
    expect(close).toHaveBeenCalledTimes(1);stop()
  })
  it('does not poll or close ordinary tenants', async () => {
    vi.useFakeTimers();const reader=vi.fn(()=>Promise.resolve(false));configureTrialHostReader(reader)
    const close=vi.fn(); const stop=monitorTrialAccess(2,null,close,undefined,{id:4,ip:'8.8.8.8',port:22})
    await vi.advanceTimersByTimeAsync(60000)
    expect(reader).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();stop()
  })
})
