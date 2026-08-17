import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./api', () => ({ default: { get } }))

import { FEATURES_UPDATED_EVENT, featuresService } from './features.service'

describe('featuresService license synchronization', () => {
  beforeEach(() => {
    get.mockReset()
    featuresService.clear()
  })

  it('invalidates the cached snapshot and emits the reactive update event', async () => {
    const first = { localAiLicensed: false }
    const second = { localAiLicensed: true }
    get.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: second })
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })

    await expect(featuresService.get()).resolves.toBe(first)
    await expect(featuresService.get()).resolves.toBe(first)
    expect(get).toHaveBeenCalledOnce()

    featuresService.notifyUpdated()

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: FEATURES_UPDATED_EVENT }))
    await expect(featuresService.get()).resolves.toBe(second)
    expect(get).toHaveBeenCalledTimes(2)
  })
})
