import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultClientError, type VaultPortalIdentity, type VaultTransport } from './vault-http'
import { createVaultDelivery } from './vault-delivery'
import { webauthnAssertion, webauthnAvailable, webauthnRegistration } from './vault-webauthn'

// NA-0198 — Windows Hello / passkey: browser format conversions and the delivery flows around them.
const clientId = 'c'.repeat(43), sessionId = 's'.repeat(43), challengeId = 'h'.repeat(43), serverNow = 2_000_000
const buf = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer
class FakeCredential { constructor(public id: string, public rawId: ArrayBuffer, public response: object, public authenticatorAttachment: string | null) {} }
function browser(result: () => Promise<unknown>) {
  const get = vi.fn(result), create = vi.fn(result)
  vi.stubGlobal('PublicKeyCredential', FakeCredential)
  vi.stubGlobal('navigator', { credentials: { get, create }, userAgent: 'Windows Chrome/1' })
  vi.stubGlobal('window', { isSecureContext: true, PublicKeyCredential: FakeCredential })
  return { get, create }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('NA-0198 browser ceremonies', () => {
  it('reports availability only on a secure page with the WebAuthn API', () => {
    browser(() => Promise.resolve(null)); expect(webauthnAvailable()).toBe(true)
    vi.stubGlobal('window', { isSecureContext: false, PublicKeyCredential: FakeCredential }); expect(webauthnAvailable()).toBe(false)
  })
  it('converts the request options and the assertion, always requiring user verification', async () => {
    const { get } = browser(() => Promise.resolve(new FakeCredential('Y3JlZA', buf(99, 114, 101, 100), {
      clientDataJSON: buf(1), authenticatorData: buf(2), signature: buf(3), userHandle: buf(4) }, 'platform')))
    const json = await webauthnAssertion({ challenge: 'AQID', rpId: 'localhost', allowCredentials: [{ id: 'Y3JlZA', type: 'public-key', transports: ['internal'] }], userVerification: 'preferred' }, new AbortController().signal)
    const call = get.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialRequestOptions }]
    expect(call[0].publicKey.userVerification).toBe('required'); expect(call[0].publicKey.rpId).toBe('localhost')
    expect([...new Uint8Array(call[0].publicKey.challenge as ArrayBuffer)]).toEqual([1, 2, 3])
    expect(json).toEqual({ id: 'Y3JlZA', rawId: 'Y3JlZA', type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw', userHandle: 'BA' } })
  })
  it('converts creation options and the attestation, keeping only known transports', async () => {
    const { create } = browser(() => Promise.resolve(new FakeCredential('Y3JlZA', buf(99, 114, 101, 100), {
      clientDataJSON: buf(1), attestationObject: buf(5), getTransports: () => ['internal', 'weird'] }, null)))
    const json = await webauthnRegistration({ challenge: 'AQID', rp: { id: 'localhost', name: 'NodeAccess' }, user: { id: 'AAEC', name: 'u@example.test' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }], excludeCredentials: [{ id: 'Y3JlZA' }], authenticatorSelection: { residentKey: 'preferred' } }, new AbortController().signal)
    const call = create.mock.calls[0] as unknown as [{ publicKey: PublicKeyCredentialCreationOptions }]
    expect(call[0].publicKey.attestation).toBe('none'); expect(call[0].publicKey.authenticatorSelection?.userVerification).toBe('required')
    expect(call[0].publicKey.excludeCredentials).toHaveLength(1)
    expect(json).toEqual({ id: 'Y3JlZA', rawId: 'Y3JlZA', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: 'AQ', attestationObject: 'BQ', transports: ['internal'] } })
  })
  it('maps a cancelled ceremony and malformed options to clear reasons', async () => {
    browser(() => Promise.reject(new DOMException('cancelled', 'NotAllowedError')))
    await expect(webauthnAssertion({ challenge: 'AQID', rpId: 'localhost' }, new AbortController().signal)).rejects.toMatchObject({ reason: 'webauthnCancelled' })
    browser(() => Promise.reject(new Error('other')))
    await expect(webauthnAssertion({ challenge: 'AQID', rpId: 'localhost' }, new AbortController().signal)).rejects.toMatchObject({ reason: 'webauthn' })
    await expect(webauthnAssertion({ challenge: 'not base64!', rpId: 'localhost' }, new AbortController().signal)).rejects.toMatchObject({ reason: 'unavailable' })
    await expect(webauthnRegistration({ challenge: 'AQID' }, new AbortController().signal)).rejects.toBeInstanceOf(VaultClientError)
  })
})

function fixture(credentials: unknown[] = [{ id: 'cred', name: 'Notebook', createdAt: 1, lastUsedAt: null }]) {
  let mono = 1000
  const identity: VaultPortalIdentity = { userId: 41, tenantId: 7, accessToken: 'a', refreshToken: 'r', origin: 'https://localhost' }
  const post = vi.fn(async (path: string, _body: Record<string, unknown>) => {
    await Promise.resolve()
    if (path === 'clients') return { clientId, expiresAt: serverNow + 1_800_000, serverNow }
    if (path === 'webauthn/credentials') return { supported: true, credentials }
    if (path === 'sessions/challenges') return { challengeId, expiresAt: serverNow + 120_000, serverNow, ...(credentials.length ? { webauthn: { challenge: 'AQID', rpId: 'localhost' } } : {}) }
    if (path === 'sessions/unlock-webauthn' || path === 'sessions/unlock') return { sessionId, idleUntil: serverNow + 300_000, expiresAt: serverNow + 1_800_000, serverNow }
    if (path === 'webauthn/registration/options') return { options: { challenge: 'AQID' } }
    if (path === 'webauthn/registration') return { id: 'cred-2' }
    if (path === 'webauthn/credentials/remove') return { state: 'REMOVED' }
    if (path === 'extension/proof-approve') return { state: 'APPROVED' }
    return { state: 'LOCKED' }
  })
  const ceremony = { available: vi.fn(() => true), assertion: vi.fn(() => Promise.resolve({ id: 'cred' })), registration: vi.fn(() => Promise.resolve({ id: 'cred-2' })) }
  const delivery = createVaultDelivery({ identity: () => identity, transport: { post } as unknown as VaultTransport, clock: { mono: () => mono, wall: () => mono }, webauthn: ceremony })
  return { delivery, post, ceremony, advance: (ms: number) => { mono += ms } }
}

describe('NA-0198 delivery with Windows Hello / passkey', () => {
  it('offers Windows Hello after prepare only when the user has a credential, and unlocks with the same challenge', async () => {
    const f = fixture()
    await f.delivery.prepare(); expect(f.delivery.state.webauthn).toBe(true)
    await f.delivery.unlockWithWebauthn()
    expect(f.delivery.state.phase).toBe('unlocked')
    expect(f.ceremony.assertion).toHaveBeenCalledWith({ challenge: 'AQID', rpId: 'localhost' }, expect.any(AbortSignal))
    expect(f.post).toHaveBeenCalledWith('sessions/unlock-webauthn', { challengeId, response: { id: 'cred' } }, expect.anything(), clientId, expect.any(AbortSignal))
    const none = fixture([]); await none.delivery.prepare(); expect(none.delivery.state.webauthn).toBe(false)
    const off = fixture(); off.ceremony.available.mockReturnValue(false); await off.delivery.prepare()
    expect(off.delivery.state.webauthn).toBe(false); expect(off.post.mock.calls.some(([p]) => p === 'webauthn/credentials')).toBe(false)
  })
  it('stays locked with a clear reason when the ceremony is cancelled or the server stopped offering it', async () => {
    const f = fixture(); await f.delivery.prepare()
    f.ceremony.assertion.mockRejectedValueOnce(new VaultClientError('webauthnCancelled'))
    await f.delivery.unlockWithWebauthn()
    expect(f.delivery.state.phase).toBe('locked'); expect(f.delivery.state.error).toBe('webauthnCancelled'); expect(f.delivery.state.providerPending).toBe(false)
    // The offer survives a refused attempt and a manual lock: the user can try again.
    expect(f.delivery.state.webauthn).toBe(true)
    f.delivery.lock(); await f.delivery.unlockWithWebauthn(); expect(f.delivery.state.phase).toBe('unlocked')
    const g = fixture([]); await g.delivery.unlockWithWebauthn()
    expect(g.delivery.state.phase).toBe('locked'); expect(g.delivery.state.error).toBe('webauthn'); expect(g.ceremony.assertion).not.toHaveBeenCalled()
  })
  it('registers and removes within a fresh session, and keeps the vault open when the ceremony is cancelled', async () => {
    const f = fixture()
    expect(await f.delivery.registerWebauthn('Notebook')).toBe(false)
    await f.delivery.unlock('pw', '123456')
    f.ceremony.registration.mockRejectedValueOnce(new VaultClientError('webauthnCancelled'))
    expect(await f.delivery.registerWebauthn('Notebook')).toBe(false)
    expect(f.delivery.state.phase).toBe('unlocked'); expect(f.delivery.state.error).toBe('webauthnCancelled')
    expect(await f.delivery.registerWebauthn('Notebook')).toBe(true)
    expect(f.post).toHaveBeenCalledWith('webauthn/registration/options', { name: 'Notebook', sessionId }, expect.anything(), clientId, expect.any(AbortSignal))
    expect(f.post).toHaveBeenCalledWith('webauthn/registration', { response: { id: 'cred-2' }, sessionId }, expect.anything(), clientId, expect.any(AbortSignal))
    expect(f.delivery.state.webauthn).toBe(true)
    expect(await f.delivery.removeWebauthn('cred')).toBe(true)
    // After a minute the authorization is no longer fresh.
    f.advance(61_000); f.delivery.tick()
    expect(await f.delivery.removeWebauthn('cred')).toBe(false)
    expect(await f.delivery.listWebauthn()).toMatchObject({ supported: true, credentials: [{ id: 'cred', name: 'Notebook' }] })
  })
})

describe('NA-0200 extension proof approval from the portal', () => {
  it('approves only inside a fresh session, with a well-formed request, and locks afterwards', async () => {
    const f = fixture()
    expect(await f.delivery.approveExtensionProof('q'.repeat(43))).toBe(false)
    await f.delivery.unlock('pw', '123456')
    expect(await f.delivery.approveExtensionProof('short')).toBe(false)
    expect(await f.delivery.approveExtensionProof('q'.repeat(43))).toBe(true)
    expect(f.post).toHaveBeenCalledWith('extension/proof-approve', { request: 'q'.repeat(43), sessionId }, expect.anything(), clientId, expect.any(AbortSignal))
    expect(f.delivery.state.phase).toBe('locked')
  })
})
