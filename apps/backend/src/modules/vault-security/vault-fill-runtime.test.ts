import { describe, expect, it, vi } from 'vitest'
import { VaultFillRuntime } from './vault-fill-runtime.js'

describe('persistent fill startup barrier', () => {
  it('keeps fill unavailable until rotation commits and rotates only once per runtime', async () => {
    let release!: () => void
    const rotate = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const runtime = new VaultFillRuntime(rotate)
    expect(runtime.ready()).toBe(false)
    const starting = runtime.initialize()
    expect(runtime.ready()).toBe(false)
    expect(await runtime.initialize()).toBe(false)
    release(); expect(await starting).toBe(true)
    expect(await runtime.initialize()).toBe(true); expect(rotate).toHaveBeenCalledTimes(1)
  })
  it('does not reopen delivery after failed startup; a new runtime must rotate successfully', async () => {
    const rotate = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined)
    const failed = new VaultFillRuntime(rotate)
    expect(await failed.initialize()).toBe(false)
    expect(await failed.initialize()).toBe(false); expect(failed.ready()).toBe(false)
    const restarted = new VaultFillRuntime(rotate)
    expect(await restarted.initialize()).toBe(true); expect(rotate).toHaveBeenCalledTimes(2)
  })
  it('bounds startup and never reopens fill when a timed-out rotation completes late', async () => {
    vi.useFakeTimers()
    try {
      let release!: () => void
      const runtime = new VaultFillRuntime(() => new Promise<void>(resolve => { release = resolve }), 40)
      const starting = runtime.initialize()
      await vi.advanceTimersByTimeAsync(40)
      expect(await starting).toBe(false)
      release(); await Promise.resolve()
      expect(runtime.ready()).toBe(false); expect(await runtime.initialize()).toBe(false)
    } finally { vi.useRealTimers() }
  })
})
