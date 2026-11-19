import { describe, expect, it, vi } from 'vitest'
import { googleStepUpNonce, VaultProviderStepUp } from './vault-provider.js'

const identity = { userId: 42, tenantId: 7, sessionVersion: 3 }
const now = 1_800_000_000_000
const seconds = (ms: number): number => Math.floor(ms / 1000)

function fixture(patch: { claims?: Record<string, unknown>; startedAt?: number; tenantId?: number; mfa?: boolean; linked?: number | null; revoked?: boolean } = {}) {
  const oidc = {
    beginStepUp: vi.fn().mockResolvedValue({ authorizationUrl: 'https://idp.example.test/authorize?state=s' }),
    completeStepUp: vi.fn().mockResolvedValue({
      tenantId: patch.tenantId ?? 7, issuer: 'https://idp.example.test', startedAt: patch.startedAt ?? now - 60_000,
      identity: { subject: 'subject-1', claims: patch.claims ?? { auth_time: seconds(now - 30_000) } },
      mfaAssurance: { satisfied: patch.mfa ?? true },
    }),
  }
  const links = {
    findUser: vi.fn().mockResolvedValue(patch.linked === null ? null : { id: patch.linked ?? 42 }),
    isRevoked: vi.fn().mockResolvedValue(patch.revoked ?? false),
  }
  const google = {
    config: vi.fn().mockResolvedValue({ clientId: 'google-client', domain: 'example.test' }),
    verify: vi.fn().mockResolvedValue({ sub: 'google-sub', hd: 'example.test', nonce: googleStepUpNonce('binding'), iat: String(seconds(now - 10_000)) }),
    userIdByGoogleId: vi.fn().mockResolvedValue(42),
  }
  const provider = new VaultProviderStepUp(oidc, links, google, () => 'https://portal.example.test/auth/oidc/callback', () => now)
  return { provider, oidc, links, google }
}

describe('vault provider step-up: OIDC', () => {
  it('forces a bound re-authentication on the registered callback', async () => {
    const f = fixture()
    await expect(f.provider.begin(identity, 'oidc', 'binding')).resolves.toEqual({ kind: 'redirect', authorizationUrl: 'https://idp.example.test/authorize?state=s' })
    expect(f.oidc.beginStepUp).toHaveBeenCalledWith(7, 'https://portal.example.test/auth/oidc/callback', 'binding')
  })
  it.each([true, false])('accepts a recent login of the same linked identity and reports provider MFA=%s', async mfa => {
    const f = fixture({ mfa })
    await expect(f.provider.complete(identity, 'oidc', 'binding', { state: 'state-value-123456', code: 'code' })).resolves.toEqual({ mfa })
    expect(f.oidc.completeStepUp).toHaveBeenCalledWith('state-value-123456', 'code', 'binding')
    expect(f.links.findUser).toHaveBeenCalledWith(7, 'https://idp.example.test', 'subject-1')
  })
  it.each([
    ['missing state', {}, { code: 'code' }],
    ['missing code', {}, { state: 'state-value-123456' }],
    ['other tenant', { tenantId: 8 }, undefined],
    ['old login', { claims: { auth_time: seconds(now - 6 * 60_000) } }, undefined],
    ['future login', { claims: { auth_time: seconds(now + 5 * 60_000) } }, undefined],
    ['no auth_time', { claims: {} }, undefined],
    ['login reused from before the step-up started', { claims: { auth_time: seconds(now - 3 * 60_000) }, startedAt: now - 30_000 }, undefined],
    ['non numeric auth_time', { claims: { auth_time: 'recent' } }, undefined],
    ['revoked identity', { revoked: true }, undefined],
    ['other user', { linked: 43 }, undefined],
    ['unlinked identity', { linked: null }, undefined],
  ] as const)('denies %s', async (_label, patch, input) => {
    const f = fixture(patch)
    await expect(f.provider.complete(identity, 'oidc', 'binding', input ?? { state: 'state-value-123456', code: 'code' })).rejects.toMatchObject({ status: 403 })
  })
  it('propagates provider failures as a rejected proof', async () => {
    const f = fixture(); f.oidc.completeStepUp.mockRejectedValue(new Error('Transação OIDC inválida'))
    await expect(f.provider.complete(identity, 'oidc', 'binding', { state: 'state-value-123456', code: 'code' })).rejects.toThrow()
  })
})

describe('vault provider step-up: Google', () => {
  it('returns the tenant client and a nonce derived from the challenge binding', async () => {
    const f = fixture()
    await expect(f.provider.begin(identity, 'google', 'binding')).resolves.toEqual({ kind: 'google', clientId: 'google-client', nonce: googleStepUpNonce('binding') })
    expect(googleStepUpNonce('binding')).not.toBe(googleStepUpNonce('other'))
  })
  it('accepts a fresh bound token of the linked Google account and always requires TOTP', async () => {
    const f = fixture()
    await expect(f.provider.complete(identity, 'google', 'binding', { idToken: 'google-id-token' })).resolves.toEqual({ mfa: false })
    expect(f.google.verify).toHaveBeenCalledWith('google-id-token', 'google-client', 7)
    expect(f.google.userIdByGoogleId).toHaveBeenCalledWith('google-sub', 7)
  })
  it.each([
    ['missing token', f => f, {}],
    ['missing config', f => { f.google.config.mockResolvedValue(null) }, undefined],
    ['other domain', f => { f.google.verify.mockResolvedValue({ sub: 'google-sub', hd: 'other.test', nonce: googleStepUpNonce('binding'), iat: String(seconds(now)) }) }, undefined],
    ['other challenge nonce', f => { f.google.verify.mockResolvedValue({ sub: 'google-sub', hd: 'example.test', nonce: googleStepUpNonce('other'), iat: String(seconds(now)) }) }, undefined],
    ['no nonce', f => { f.google.verify.mockResolvedValue({ sub: 'google-sub', hd: 'example.test', iat: String(seconds(now)) }) }, undefined],
    ['old token', f => { f.google.verify.mockResolvedValue({ sub: 'google-sub', hd: 'example.test', nonce: googleStepUpNonce('binding'), iat: String(seconds(now - 10 * 60_000)) }) }, undefined],
    ['other user', f => { f.google.userIdByGoogleId.mockResolvedValue(43) }, undefined],
    ['unlinked account', f => { f.google.userIdByGoogleId.mockResolvedValue(null) }, undefined],
  ] as Array<[string, (f: ReturnType<typeof fixture>) => unknown, object | undefined]>)('denies %s', async (_label, mutate, input) => {
    const f = fixture(); mutate(f)
    await expect(f.provider.complete(identity, 'google', 'binding', input ?? { idToken: 'google-id-token' })).rejects.toMatchObject({ status: 403 })
  })
})
