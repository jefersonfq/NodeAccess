import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureTrialPolicy, configureTrialProtectedAddresses } from '../trials/trial-policy.js'
import { WebhookDispatcherService } from './webhook-dispatcher.service.js'
import { WebhookSignerService } from './webhook-signer.service.js'
vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  configureTrialPolicy(() => Promise.resolve(null))
  configureTrialProtectedAddresses([])
  vi.unstubAllGlobals()
})

function fixture(url = 'https://9.9.9.9/hook') {
  const repo = { claimDelivery: vi.fn().mockResolvedValue(true), updateDelivery: vi.fn(), updateSubscription: vi.fn() }
  const service = new WebhookDispatcherService(repo as never, new WebhookSignerService())
  const delivery = { id: 1, tenantId: 7, subscriptionId: 3, eventType: 'host.created', payloadJson: '{}', attemptCount: 0,
    subscription: { targetUrl: url, httpMethod: 'POST', timeoutMs: 1000, maxRetries: 3, secretEncrypted: null, secretIv: null } }
  const dispatch = () => (service as unknown as { dispatch: (input: unknown) => Promise<void> }).dispatch(delivery)
  return { repo, dispatch }
}

describe('webhook normal and trial transport selection with real destination guards', () => {
  it('blocks a trial-protected public address before calling the transport', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full' } }))
    configureTrialProtectedAddresses(['9.9.9.9'])
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await fixture().dispatch()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('normal tenant uses public webhook guard and keeps redirect rejection', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetcher)
    const { repo, dispatch } = fixture()
    await dispatch()
    expect(fetcher).toHaveBeenCalledWith('https://9.9.9.9/hook', expect.objectContaining({ redirect: 'error', dispatcher: expect.anything() as unknown }))
    expect(repo.updateDelivery).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'DELIVERED' }), expect.any(String))
  })

  it('normal tenant also rejects a private literal before calling the transport', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { repo, dispatch } = fixture('http://127.0.0.1/private')
    await dispatch()
    expect(fetcher).not.toHaveBeenCalled()
    expect(repo.updateDelivery).toHaveBeenCalledWith(1, expect.objectContaining({ lastErrorCode: 'SSRF_BLOCKED' }), expect.any(String))
  })
})
