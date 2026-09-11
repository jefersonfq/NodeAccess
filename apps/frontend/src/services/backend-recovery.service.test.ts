import { beforeEach, afterEach, it, expect, vi } from 'vitest'
vi.mock('naive-ui', () => ({ createDiscreteApi: () => ({ message: { warning: vi.fn() } }) }))
vi.mock('@/plugins/i18n', () => ({ i18n: { global: { t: (s: string) => s } } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ accessToken: 'test' }) }))
import { watchBackendRecovery, stopBackendRecoveryWatch, BACKEND_RECOVERED_EVENT } from './backend-recovery.service'
let dispatch: ReturnType<typeof vi.fn>, reload: ReturnType<typeof vi.fn>
beforeEach(() => {
 vi.useFakeTimers(); dispatch = vi.fn(); reload = vi.fn()
 vi.stubGlobal('window', { setTimeout, clearTimeout, dispatchEvent: dispatch, location: { reload }, sessionStorage: { removeItem: vi.fn() } })
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
})
afterEach(async () => { stopBackendRecoveryWatch(); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); vi.unstubAllGlobals() })
it('recovers through an event without reloading the document or duplicating probes', async () => {
 watchBackendRecovery(); watchBackendRecovery(); watchBackendRecovery()
 await vi.advanceTimersByTimeAsync(2000)
 expect(fetch).toHaveBeenCalledTimes(1)
 expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: BACKEND_RECOVERED_EVENT }))
 expect(reload).not.toHaveBeenCalled()
})
it.each([401, 403, 503])('does not interpret HTTP %s as recovery', async status => {
 vi.mocked(fetch).mockResolvedValue({ ok: false, status } as Response)
 watchBackendRecovery(); await vi.advanceTimersByTimeAsync(2000)
 expect(dispatch).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled()
})
it('ignores a late successful probe after cancellation', async () => {
 let resolve!: (r: Response) => void
 vi.mocked(fetch).mockImplementation(() => new Promise(r => { resolve = r }))
 watchBackendRecovery(); await vi.advanceTimersByTimeAsync(2000)
 stopBackendRecoveryWatch(); resolve({ ok: true } as Response); await Promise.resolve(); await Promise.resolve()
 expect(dispatch).not.toHaveBeenCalled()
})
it('bounds stalled probes and increases retry delay', async () => {
 vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) }))
 watchBackendRecovery(); await vi.advanceTimersByTimeAsync(7000)
 expect(fetch).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(2000); expect(fetch).toHaveBeenCalledTimes(2)
 expect(reload).not.toHaveBeenCalled()
})
