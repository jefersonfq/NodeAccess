import { describe, expect, it } from 'vitest'
import { GatewayDrainState, waitForGatewayDrain } from './gateway-drain.js'

describe('gateway draining', () => {
  it('changes state immediately and waits for active sessions to finish', async () => {
    const state = new GatewayDrainState()
    expect(state.isDraining()).toBe(false)
    const release = state.enter()
    expect(release).not.toBeNull()
    expect(state.activeCount()).toBe(1)
    state.begin()
    expect(state.isDraining()).toBe(true)
    expect(state.enter()).toBeNull()

    setTimeout(() => release?.(), 5)
    await expect(waitForGatewayDrain(() => state.activeCount(), 100, 2)).resolves.toBe(0)
  })

  it('returns remaining sessions when the drain timeout expires', async () => {
    await expect(waitForGatewayDrain(() => 2, 5, 1)).resolves.toBe(2)
  })
})
