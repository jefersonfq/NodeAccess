import { promises as dns } from 'node:dns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertTrialOutboundAddress, trialOutboundFetch, trialOutboundLookup, trialLdapTarget, trialAiFetch, assertTrialIntegration } from './trial-outbound.js'
import { configureTrialPolicy, configureTrialProtectedAddresses } from './trial-policy.js'

beforeEach(() => {
  configureTrialProtectedAddresses(['8.8.4.4'])
  configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full' } }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); configureTrialPolicy(() => Promise.resolve(null)); configureTrialProtectedAddresses([]) })
function resolve(host: string): Promise<string> {
  return new Promise((accept, reject) => {
    trialOutboundLookup(host, {}, (error, value) => {
      if (error) reject(error)
      else if (typeof value === 'string') accept(value)
      else reject(new Error('Unexpected lookup result'))
    })
  })
}
describe('trial outbound socket policy', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:8.8.4.4', '8.8.4.4'])('rejects protected destination %s', address => {
    expect(() => assertTrialOutboundAddress(address)).toThrow()
  })
  it('validates every DNS answer rather than choosing a safe-looking first address', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '9.9.9.9', family: 4 }, { address: '127.0.0.1', family: 4 }])
    await expect(resolve('external.test')).rejects.toThrow()
  })
  it('uses the checked IP from the socket lookup and checks subsequent connections again', async () => {
    const lookup = vi.spyOn(dns, 'lookup').mockResolvedValueOnce([{ address: '9.9.9.9', family: 4 }]).mockResolvedValueOnce([{ address: '8.8.4.4', family: 4 }])
    await expect(resolve('external.test')).resolves.toBe('9.9.9.9')
    await expect(resolve('external.test')).rejects.toThrow()
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('LDAP pins the IP and keeps the certificate hostname', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '9.9.9.9', family: 4 }])
    await expect(trialLdapTarget(12, 'ldaps://directory.test:636')).resolves.toEqual({ url: 'ldaps://9.9.9.9:636', servername: 'directory.test' })
  })
  it('rejects cleartext trial HTTP before sending credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher)
    await expect(trialOutboundFetch(12, 'http://9.9.9.9', { headers: { Authorization: 'Bearer synthetic' } })).rejects.toMatchObject({ code: 'TRIAL_HTTPS_REQUIRED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('denies disabled provider even if the full feature is enabled', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full', integrations: { jira: false } } }))
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher)
    await expect(assertTrialIntegration(12, 'jira')).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('IA remains independent from the integration master flag', async () => {
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), profileJson: { experience: 'full', features: { integrations: false, localAi: true } } }))
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('ok')))
    expect(await (await trialAiFetch(12, 'https://9.9.9.9')).text()).toBe('ok')
  })
  it('ordinary tenant fetch keeps existing routing options', async () => {
    configureTrialPolicy(() => Promise.resolve(null))
    const response = new Response('normal')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response); vi.stubGlobal('fetch', fetcher)
    const init = { redirect: 'follow' as const }
    await expect(trialOutboundFetch(12, 'http://localhost/private', init)).resolves.toBe(response)
    expect(fetcher).toHaveBeenCalledWith('http://localhost/private', init)
  })
  it('expired trial and missing protected configuration never reach fetch', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher)
    configureTrialProtectedAddresses([])
    await expect(trialOutboundFetch(12, 'https://9.9.9.9')).rejects.toThrow()
    configureTrialPolicy(() => Promise.resolve({ status: 'ACTIVE', expiresAt: new Date(0), profileJson: { experience: 'full' } }))
    await expect(trialOutboundFetch(12, 'https://9.9.9.9')).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('forces redirect rejection and releases a fully consumed response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok')); vi.stubGlobal('fetch', fetcher)
    const response = await trialOutboundFetch(12, 'https://9.9.9.9', { redirect: 'follow' })
    expect(await response.text()).toBe('ok')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://9.9.9.9')
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error')
    expect(fetcher.mock.calls[0]?.[1]?.dispatcher).toBeDefined()
  })
})
