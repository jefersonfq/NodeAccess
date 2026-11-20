import { describe, expect, it, vi } from 'vitest'
import { VaultExtensionConnectRequestSchema } from '@nodeaccess/shared'
import { extensionConsentRequest, extensionReturnUrl, fingerprint } from './vault-extension-consent'
import { createVaultDelivery } from './vault-delivery'
import type { VaultPortalIdentity, VaultTransport } from './vault-http'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const opaque = (c: string): string => c.repeat(43)
const query = { extensionId: EXT, redirectUri: `https://${EXT}.chromiumapp.org/`, state: 's'.repeat(32), codeChallenge: opaque('c'), codeChallengeMethod: 'S256', deviceJkt: opaque('d') }

describe('NA-0183 extension consent helpers', () => {
  it('accepts exactly the expected single-valued parameters', () => {
    expect(extensionConsentRequest(query, VaultExtensionConnectRequestSchema)).toEqual(query)
  })
  it.each([
    ['another extension redirect', { redirectUri: `https://${'p'.repeat(32)}.chromiumapp.org/` }],
    ['an arbitrary redirect', { redirectUri: 'https://evil.example/' }],
    ['plain PKCE', { codeChallengeMethod: 'plain' }],
    ['a short state', { state: 'x' }],
    ['a malformed extension id', { extensionId: 'A'.repeat(32), redirectUri: `https://${'A'.repeat(32)}.chromiumapp.org/` }],
    ['an extra parameter', { code: opaque('x') }],
    ['a repeated parameter', { state: ['a'.repeat(32), 'b'.repeat(32)] }],
  ])('rejects %s', (_name, patch) => {
    expect(extensionConsentRequest({ ...query, ...patch }, VaultExtensionConnectRequestSchema)).toBeNull()
  })
  it('builds the return URL on the exact redirect and renders a short fingerprint', () => {
    expect(extensionReturnUrl(query.redirectUri, { code: opaque('k'), state: query.state })).toBe(`https://${EXT}.chromiumapp.org/?code=${opaque('k')}&state=${query.state}`)
    expect(fingerprint('abcdEFGHijklMNOPqrst')).toBe('abcd-EFGH-ijkl-MNOP')
  })
})

describe('NA-0183 consent inside the unlocked vault session', () => {
  function fixture(code: unknown = opaque('k')) {
    const identity: VaultPortalIdentity = { userId: 41, tenantId: 7, accessToken: 'bearer', refreshToken: 'origin', origin: 'https://vault.example' }
    const serverNow = 2_000_000
    const post = vi.fn((path: string) => Promise.resolve(
      path === 'clients' ? { clientId: opaque('c'), expiresAt: serverNow + 1_800_000, serverNow }
        : path === 'sessions/challenges' ? { challengeId: opaque('h'), expiresAt: serverNow + 120_000, serverNow }
          : path === 'sessions/unlock' ? { sessionId: opaque('s'), idleUntil: serverNow + 300_000, expiresAt: serverNow + 1_800_000, serverNow }
            : path === 'extension/authorize' ? { code, expiresAt: serverNow + 60_000, serverNow } : {}))
    let mono = 1000
    const delivery = createVaultDelivery({ identity: () => identity, transport: { post } as unknown as VaultTransport, clock: { mono: () => mono, wall: () => mono } })
    return { delivery, post, advance: (ms: number) => { mono += ms } }
  }
  const consent = { extensionId: EXT, redirectUri: query.redirectUri, state: query.state, codeChallenge: query.codeChallenge, deviceJkt: query.deviceJkt }
  it('sends the consent with the session and locks again after receiving the code', async () => {
    const f = fixture()
    await f.delivery.unlock('pw', '123456')
    await expect(f.delivery.authorizeExtension(consent)).resolves.toBe(opaque('k'))
    expect(f.post).toHaveBeenCalledWith('extension/authorize', { ...consent, sessionId: opaque('s') }, expect.anything(), opaque('c'), expect.anything())
    expect(f.delivery.state.phase).toBe('locked')
  })
  it('does nothing while locked and refuses an expired step-up proof', async () => {
    const f = fixture()
    await expect(f.delivery.authorizeExtension(consent)).resolves.toBeNull()
    await f.delivery.unlock('pw', '123456')
    f.advance(61_000)
    await expect(f.delivery.authorizeExtension(consent)).resolves.toBeNull()
    expect(f.post).not.toHaveBeenCalledWith('extension/authorize', expect.anything(), expect.anything(), expect.anything(), expect.anything())
  })
  it('treats a malformed reply as a failure', async () => {
    const f = fixture('short')
    await f.delivery.unlock('pw', '123456')
    await expect(f.delivery.authorizeExtension(consent)).resolves.toBeNull()
    expect(f.delivery.state.error).toBe('unavailable')
  })
})
