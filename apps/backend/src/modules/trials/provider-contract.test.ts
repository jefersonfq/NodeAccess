import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpTrialProvisioner } from './trial-provisioner.js'
import { labSchema, trialProfileSchema, validNetwork, validateLab, type TrialProfile, type TrialLab } from './trial-contract.js'
const id = 'a1234567-1234-4234-8234-123456789abc'
const other = 'b1234567-1234-4234-8234-123456789abc'
const profile: TrialProfile = { name: 'Linux demo', resources: ['ssh', 'sftp', 'sharing'], durationDays: 7, expiryNoticeHours: 6, maxUsers: 2, maxHosts: 2, machineCount: 1,
  maxSessions: 2, templateId: 'linux-v1', networkCidr: '10.64.0.0/24', maxActiveTrials: 2, retentionDays: 30,
  privacyUrl: 'https://example.com/privacy', termsUrl: 'https://example.com/terms', privacyVersion: 'v1' }
const host = { name: 'Linux', ip: '10.64.0.10', port: 22, sshUser: 'demo', password: 'exclusive-disposable-password', fingerprint: `SHA256:${'a'.repeat(43)}` }
const lab: TrialLab = { trialId: id, state: 'ready', isolated: true, hosts: [host] }
function fixture(body: unknown = lab, status = 200) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
  vi.stubGlobal('fetch', fetch)
  return { fetch, provider: new HttpTrialProvisioner('https://internal.example.com/provision/', 'internal-disposable-token') }
}
afterEach(() => vi.unstubAllGlobals())

describe('trial profile and laboratory contracts', () => {
  it('accepts bounded profiles and rejects machines beyond host quota', () => {
    expect(trialProfileSchema.parse(profile)).toEqual(profile)
    expect(() => trialProfileSchema.parse({ ...profile, machineCount: 3 })).toThrow()
    expect(() => trialProfileSchema.parse({ ...profile, maxUsers: 11 })).toThrow()
    expect(() => trialProfileSchema.parse({ ...profile, durationDays: 0 })).toThrow()
    expect(() => trialProfileSchema.parse({ ...profile, url: 'https://attacker.example' })).toThrow()
  })
  it('rejects traversal template IDs and embedded URL credentials', () => {
    expect(() => trialProfileSchema.parse({ ...profile, templateId: '../../host' })).toThrow()
    expect(() => trialProfileSchema.parse({ ...profile, privacyUrl: 'https://u:p@example.com/privacy' })).toThrow()
  })
  it('requires an exact supported CIDR syntax', () => {
    expect(validNetwork('10.64.0.0/24')).toBe(true)
    for (const cidr of ['10.64.0.0/24/ignored', '10.64.0.0/15', '10.64.0.0/31', '10.64.0.0', '::1/24']) expect(validNetwork(cidr), cidr).toBe(false)
  })
  it('refuses loopback, link-local and multicast lab networks', () => {
    for (const cidr of ['127.0.0.0/24', '169.254.169.0/24', '224.0.0.0/24', '0.0.0.0/24']) expect(validNetwork(cidr), cidr).toBe(false)
  })
  it('checks ownership even for preparing/removed responses', () => {
    expect(() => validateLab(lab, other, profile)).toThrow('LAB_OWNERSHIP_MISMATCH')
    expect(() => validateLab({ ...lab, state: 'preparing', hosts: [] }, other, profile)).toThrow('LAB_OWNERSHIP_MISMATCH')
  })
  it('refuses unisolated responses, leaked extra fields and invalid fingerprints', () => {
    expect(() => labSchema.parse({ ...lab, isolated: false })).toThrow()
    expect(() => labSchema.parse({ ...lab, adminToken: 'should-not-be-returned' })).toThrow()
    expect(() => labSchema.parse({ ...lab, hosts: [{ ...host, fingerprint: 'unverified' }] })).toThrow()
  })
  it('checks host count, duplicate destinations and allowed subnet', () => {
    expect(() => validateLab(lab, id, profile)).not.toThrow()
    expect(() => validateLab({ ...lab, hosts: [] }, id, profile)).toThrow('LAB_DESTINATION_INVALID')
    expect(() => validateLab({ ...lab, hosts: [host, host] }, id, { ...profile, machineCount: 2 })).toThrow('LAB_DESTINATION_INVALID')
    expect(() => validateLab({ ...lab, hosts: [{ ...host, ip: '10.65.0.1' }] }, id, profile)).toThrow('LAB_DESTINATION_INVALID')
  })
  it('refuses network and broadcast destinations within approved subnet', () => {
    for (const ip of ['10.64.0.0', '10.64.0.255']) expect(() => validateLab({ ...lab, hosts: [{ ...host, ip }] }, id, profile)).toThrow('LAB_DESTINATION_INVALID')
  })
})

describe('internal provisioner transport', () => {
  it('uses fixed internal endpoint, idempotent PUT and safe profile subset', async () => {
    const { provider, fetch } = fixture()
    await expect(provider.ensure(id, profile)).resolves.toEqual(lab)
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://internal.example.com/provision/v1/labs/${id}`)
    expect(options.method).toBe('PUT'); expect(options.redirect).toBe('error')
    expect(options.headers).toMatchObject({ 'idempotency-key': id, authorization: 'Bearer internal-disposable-token' })
    expect(JSON.parse(options.body as string)).toEqual({ templateId: 'linux-v1', machineCount: 1, networkCidr: '10.64.0.0/24', maxSessions: 2 })
    expect(options.signal).toBeDefined()
  })
  for (const url of ['http://internal.example.com', 'https://u:p@internal.example.com', 'https://internal.example.com?token=private', 'https://internal.example.com#private']) {
    it(`rejects unsafe endpoint shape (${new URL(url).protocol})`, () => {
      expect(() => new HttpTrialProvisioner(url, 'private')).toThrow('INVALID_PROVISIONER_URL')
    })
  }
  it('rejects malformed IDs before invoking network', async () => {
    const { provider, fetch } = fixture()
    await expect(provider.ensure('../production', profile)).rejects.toThrow('INVALID_TRIAL_ID')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('does not trust ownership or invalid destination claims from provider', async () => {
    const f = fixture({ ...lab, trialId: other })
    await expect(f.provider.ensure(id, profile)).rejects.toThrow('LAB_OWNERSHIP_MISMATCH')
    f.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...lab, hosts: [{ ...host, ip: '169.254.169.254' }] })))
    await expect(f.provider.ensure(id, profile)).rejects.toThrow('LAB_DESTINATION_INVALID')
  })
  it('requires explicit matching destruction proof, not merely HTTP success', async () => {
    const { provider, fetch } = fixture({ ...lab, state: 'removed', hosts: [] })
    await expect(provider.remove(id)).resolves.toBeUndefined()
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...lab, state: 'ready' })))
    await expect(provider.remove(id)).rejects.toThrow('LAB_REMOVAL_NOT_CONFIRMED')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...lab, trialId: other, state: 'removed', hosts: [] })))
    await expect(provider.remove(id)).rejects.toThrow('LAB_REMOVAL_NOT_CONFIRMED')
  })
  it('returns sanitized transport status failures', async () => {
    const { provider } = fixture({ token: 'DO_NOT_EXPOSE' }, 503)
    await expect(provider.ensure(id, profile)).rejects.toThrow('PROVISIONER_UNAVAILABLE')
  })
  it('rejects oversized provider responses', async () => {
    const { provider, fetch } = fixture()
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: 'a'.repeat(32769) })))
    await expect(provider.ensure(id, profile)).rejects.toThrow('PROVISIONER_RESPONSE_LIMIT')
  })
  it('cancels an oversized streamed response before buffering the rest', async () => {
    const cancel = vi.fn()
    let pulls = 0
    const stream = new ReadableStream({ pull(controller) { pulls++; if (pulls > 100) controller.close(); else controller.enqueue(new Uint8Array(4096)) }, cancel })
    const { provider, fetch } = fixture()
    fetch.mockResolvedValueOnce(new Response(stream))
    await expect(provider.ensure(id, profile)).rejects.toThrow('PROVISIONER_RESPONSE_LIMIT')
    expect(cancel).toHaveBeenCalled()
    expect(pulls).toBeLessThan(20)
  })
})
