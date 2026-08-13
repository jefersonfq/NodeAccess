import { describe, expect, it, vi } from 'vitest'
import { SshSessionRuntimeRegistry } from './ssh-session-runtime.registry.js'

describe('SshSessionRuntimeRegistry', () => {
  it('tracks active sessions for graceful gateway draining', () => {
    const registry = new SshSessionRuntimeRegistry()
    registry.register(10, { close: vi.fn() })
    registry.register(11, { close: vi.fn() })
    expect(registry.activeCount()).toBe(2)
    registry.unregister(10)
    expect(registry.activeCount()).toBe(1)
    registry.unregister(11)
    expect(registry.activeCount()).toBe(0)
  })
})
