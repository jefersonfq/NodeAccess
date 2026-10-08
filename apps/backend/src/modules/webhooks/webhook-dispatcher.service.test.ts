import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookDispatcherService } from './webhook-dispatcher.service.js'
import { WebhookSignerService } from './webhook-signer.service.js'
import { decrypt } from '../../shared/crypto.js'
import { assertNotSsrfUrl } from '../../shared/ssrf-guard.js'
vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../shared/crypto.js', () => ({ decrypt: vi.fn(() => 'secret') }))
vi.mock('../../shared/ssrf-guard.js', () => ({ assertNotSsrfUrl: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })
function fixture(attemptCount = 0) {
  const repo = { claimDelivery: vi.fn().mockResolvedValue(true), updateDelivery: vi.fn(), updateSubscription: vi.fn() }
  const delivery = { id: 1, tenantId: 7, subscriptionId: 3, eventType: 'host.created', payloadJson: '{}', attemptCount,
    subscription: { targetUrl: 'https://receiver.example/hook', httpMethod: 'POST', timeoutMs: 10, maxRetries: 3, secretEncrypted: 'enc', secretIv: 'iv' } }
  const service = new WebhookDispatcherService(repo as never, new WebhookSignerService())
  // Exercise one queue item without starting the perpetual scheduler.
  const dispatch = () => (service as unknown as { dispatch: (delivery: unknown) => Promise<void> }).dispatch(delivery)
  return { repo, delivery, dispatch }
}
describe('outbound delivery resilience', () => {
  it.each([200, 204, 400, 401, 403, 404, 410, 422, 429, 500, 503])('handles HTTP %s', async status => {
    const { repo, dispatch } = fixture()
    const fetcher = vi.fn().mockResolvedValue({ status, body: null })
    vi.stubGlobal('fetch', fetcher)
    await dispatch()
    expect(repo.updateDelivery).toHaveBeenLastCalledWith(1, expect.objectContaining({
      status: status < 300 ? 'DELIVERED' : status === 429 || status >= 500 ? 'RETRY_SCHEDULED' : 'DEAD', attemptCount: 1,
    }), expect.any(String))
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ 'X-NodeAccess-Delivery': '1' }) }))
  })
  it('exhausts attempts on network failure', async () => {
    const { repo, dispatch } = fixture(2)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')))
    await dispatch()
    expect(repo.updateDelivery).toHaveBeenLastCalledWith(1, expect.objectContaining({ status: 'DEAD', nextAttemptAt: null, lastErrorCode: 'NETWORK_ERROR' }), expect.any(String))
  })
  it('does not contact a target blocked by SSRF validation', async () => {
    const { repo, dispatch } = fixture()
    vi.mocked(assertNotSsrfUrl).mockRejectedValueOnce(new Error('blocked'))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await dispatch()
    expect(fetcher).not.toHaveBeenCalled()
    expect(repo.updateDelivery).toHaveBeenLastCalledWith(1, expect.objectContaining({ status: 'DEAD', lastErrorCode: 'SSRF_BLOCKED' }), expect.any(String))
  })
  it('never sends unsigned when the configured signing secret cannot be decrypted', async () => {
    const { repo, dispatch } = fixture()
    vi.mocked(decrypt).mockImplementationOnce(() => { throw new Error('bad key') })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await dispatch()
    expect(fetcher).not.toHaveBeenCalled()
    expect(repo.updateDelivery).toHaveBeenLastCalledWith(1, expect.objectContaining({ status: 'DEAD', lastErrorCode: 'SECRET_DECRYPT_FAILED' }), expect.any(String))
  })
  it('aborts a response body that stalls after successful headers', async () => {
    vi.useFakeTimers()
    const { repo, dispatch } = fixture()
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({ status: 200, body: new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(new Error('timeout'))) } }) })))
    const pending = dispatch()
    await vi.advanceTimersByTimeAsync(20)
    await pending
    expect(repo.updateDelivery).toHaveBeenLastCalledWith(1, expect.objectContaining({ status: 'RETRY_SCHEDULED', lastErrorCode: 'NETWORK_ERROR' }), expect.any(String))
  })
})

 it('does not send the event if another consumer owns the claim', async () => {
  const { repo, dispatch } = fixture()
  repo.claimDelivery.mockResolvedValue(false)
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await dispatch()
  expect(fetcher).not.toHaveBeenCalled()
  expect(repo.updateDelivery).not.toHaveBeenCalled()
 })
 it('keeps a stable delivery identifier even when signing is not configured', async () => {
  const { delivery, dispatch } = fixture()
  Object.assign(delivery.subscription, { secretEncrypted: null, secretIv: null })
  const fetcher = vi.fn().mockResolvedValue({ status: 204, body: null })
  vi.stubGlobal('fetch', fetcher)
  await dispatch()
  expect(fetcher.mock.calls[0][1].headers['X-NodeAccess-Delivery']).toBe('1')
  expect(fetcher.mock.calls[0][1].headers['X-NodeAccess-Signature']).toBeUndefined()
 })
