import { describe, expect, it, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { createExtensionClient, ExtensionError } from './client'
import { createDeviceKey, dpopProof, pkcePair, thumbprint } from './crypto'
import type { Authorization, DeviceKey } from './ports'
import { DpopNonces, DpopVerifier, pkceMatches } from '../../../backend/src/modules/vault-security/vault-extension-dpop'
import { manifest } from '../../manifest'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const PORTAL = 'https://vault.example.test'
const API = `${PORTAL}/api/v1/vault-security/extension`
const opaque = (): string => randomBytes(32).toString('base64url')

function stores() {
  let intent: unknown = null
  let tail: Promise<unknown> = Promise.resolve()
  let key: DeviceKey | null = null, auth: Authorization | null = null, recents: string[] = [], locale: string | null = null, portalProof: string | null = null
  return {
    keys: { load: () => Promise.resolve(key), save: (k: DeviceKey) => { key = k; return Promise.resolve() } },
    session: { get: () => Promise.resolve(auth), set: (a: Authorization) => { auth = a; return Promise.resolve() }, clear: () => { auth = null; recents = []; portalProof = null; intent = null; return Promise.resolve() },
      recents: () => Promise.resolve(recents), setRecents: (r: string[]) => { recents = r; return Promise.resolve() },
      locale: () => Promise.resolve(locale), setLocale: (l: string) => { locale = l; return Promise.resolve() },
      portalIntent: () => Promise.resolve(intent), setPortalIntent: (value: unknown) => { intent = value; return Promise.resolve() },
      portalLock: <T>(run: () => Promise<T>): Promise<T> => { const result = tail.then(run); tail = result.catch(() => {}); return result },
      portalProof: () => Promise.resolve(portalProof), setPortalProof: (r: string | null) => { portalProof = r; intent = null; return Promise.resolve() } },
    peek: () => ({ key, auth, recents, locale, portalProof }),
  }
}
/** Fake portal backed by the real backend DPoP verifier and PKCE check. */
function portal(options: { consent?: (url: URL) => string; nonceFirst?: boolean; itemsStatus?: number; writeError?: { status: number; code: string } } = {}) {
  const nonces = new DpopNonces('interop'), seen = new Set<string>()
  const verifier = new DpopVerifier(nonces, { claim: k => Promise.resolve(!seen.has(k) && !!seen.add(k)) })
  let consent: URL | null = null
  const access = opaque(), code = opaque()
  const calls: Array<{ url: string; init: RequestInit }> = []
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'DPoP-Nonce': nonces.issue(), ...headers } })
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : input.toString(), headers = init.headers as Record<string, string>
    calls.push({ url, init })
    const path = url.split('?')[0]!
    try {
      if (path === `${API}/token`) {
        const jkt = await verifier.verify(headers.DPoP, { method: 'POST', url: path })
        const body = JSON.parse(init.body as string) as { code: string; codeVerifier: string }
        if (!consent || body.code !== code || !pkceMatches(body.codeVerifier, consent.searchParams.get('codeChallenge')!) || jkt !== consent.searchParams.get('deviceJkt')) return reply(400, {})
        return reply(200, { accessToken: access, tokenType: 'DPoP', expiresAt: 1_800_000, serverNow: 0 })
      }
      const token = /^DPoP (.+)$/.exec(headers.Authorization ?? '')?.[1]
      await verifier.verify(headers.DPoP, { method: init.method === 'POST' ? 'POST' : 'GET', url: path, ...(token ? { accessToken: token } : {}) })
      if (token !== access) return reply(401, {}, { 'WWW-Authenticate': 'DPoP error="invalid_token"' })
      if (path === `${API}/write`) return options.writeError ? reply(options.writeError.status, { code: options.writeError.code }) : reply(200, { id: 8 })
      if (path === `${API}/hosts`) return reply(200, { hosts: [{ id: 10, name: 'Visible host' }], nextCursor: null })
      if (path === `${API}/items`) return options.itemsStatus ? reply(options.itemsStatus, {}) : reply(200, { items: [{ kind: 'secret', sourceId: 3, label: 'db', description: null, scope: 'shared', portalPath: '/vault?kind=secret&id=3' }], nextCursor: null })
      if (path === `${API}/capabilities`) return reply(200, { apiVersion: 1, minExtensionVersion: '0.1.0', kinds: ['secret', 'pem'], features: { reveal: false, copy: false, create: false }, portalOrigin: PORTAL, expiresAt: 1, serverNow: 0 })
      return reply(404, {})
    } catch (error) {
      const code = (error as { code?: string }).code
      return reply(401, {}, { 'WWW-Authenticate': code === 'EXTENSION_DPOP_NONCE' ? 'DPoP error="use_dpop_nonce"' : 'DPoP error="invalid_token"' })
    }
  })
  const flow = { redirectUri: () => `https://${EXT}.chromiumapp.org/`, launch: vi.fn((url: string) => {
    consent = new URL(url)
    return Promise.resolve(options.consent ? options.consent(consent) : `https://${EXT}.chromiumapp.org/?code=${code}&state=${consent.searchParams.get('state')}`)
  }) }
  return { fetcher, flow, calls, access, consentUrl: () => consent }
}
const T0 = Date.now()
function client(p: ReturnType<typeof portal>, s = stores(), now = () => T0) {
  return { s, c: createExtensionClient({ info: { id: EXT, version: '0.1.0', portalOrigin: PORTAL }, keys: s.keys, session: s.session, flow: p.flow, fetcher: p.fetcher, now }) }
}

describe('NA-0183 extension crypto', () => {
  it('creates a non-extractable P-256 key whose thumbprint matches RFC 7638', async () => {
    const key = await createDeviceKey()
    expect(key.privateKey.extractable).toBe(false)
    const canonical = JSON.stringify({ crv: 'P-256', kty: 'EC', x: key.publicJwk.x, y: key.publicJwk.y })
    expect(key.jkt).toBe(createHash('sha256').update(canonical).digest('base64url'))
    expect(await thumbprint(key.publicJwk)).toBe(key.jkt)
  })
  it('produces PKCE pairs and DPoP proofs that the backend verifier accepts', async () => {
    const { verifier, challenge } = await pkcePair()
    expect(pkceMatches(verifier, challenge)).toBe(true)
    const nonces = new DpopNonces('k'), key = await createDeviceKey()
    const backend = new DpopVerifier(nonces, { claim: () => Promise.resolve(true) })
    const proof = await dpopProof(key, 'GET', `${API}/items`, { nonce: nonces.issue(), accessToken: 'token-value' })
    await expect(backend.verify(proof, { method: 'GET', url: `${API}/items`, accessToken: 'token-value' })).resolves.toBe(key.jkt)
    expect(proof).not.toMatch(/"d"/)
  })
})

describe('NA-0183 extension client', () => {
  it('E3 sends writes with valid POST DPoP, validates locally and never persists submitted values', async () => {
    const p = portal(), { c, s } = client(p)
    await c.connect()
    await expect(c.write({ operation: 'create-secret', alias: 'mine', value: 'write-marker' })).resolves.toEqual({ id: 8 })
    const request = p.calls.find(call => call.url.endsWith('/write'))!
    expect(request.init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store' })
    expect(JSON.stringify(s.peek())).not.toContain('write-marker')
    const count = p.calls.length
    await expect(c.write({ operation: 'create-secret', alias: 'x', value: '' })).rejects.toMatchObject({ reason: 'writeInvalid' })
    expect(p.calls).toHaveLength(count)
  })
  it.each([[409, 'EXTENSION_WRITE_CONFLICT', 'writeConflict'], [400, 'EXTENSION_WRITE_INVALID', 'writeInvalid'], [409, 'EXTENSION_WRITE_UNAVAILABLE', 'writeUnavailable']] as const)('E3 maps write error %s without expiring authorization', async (status, code, reason) => {
    const p = portal({ writeError: { status, code } }), { c, s } = client(p)
    await c.connect()
    await expect(c.write({ operation: 'rotate-secret', id: 8, value: 'new' })).rejects.toMatchObject({ reason })
    expect(s.peek().auth).not.toBeNull()
  })
  it('connects through the consent page, retries for the nonce and searches with DPoP', async () => {
    const p = portal(), { c, s } = client(p)
    await c.connect()
    const consent = p.consentUrl()!
    expect(consent.origin + consent.pathname).toBe(`${PORTAL}/vault/extension/connect`)
    expect(consent.searchParams.get('codeChallengeMethod')).toBe('S256')
    expect(consent.searchParams.get('deviceJkt')).toBe(s.peek().key!.jkt)
    expect([...consent.searchParams.keys()].sort()).toEqual(['codeChallenge', 'codeChallengeMethod', 'deviceJkt', 'extensionId', 'redirectUri', 'state'])
    expect(s.peek().auth).toEqual({ accessToken: p.access, portalOrigin: PORTAL, expiresAt: T0 + 1_795_000 })
    const nonceRetries = p.calls.filter(call => call.url.endsWith('/token')).length
    expect(nonceRetries).toBe(2)
    await expect(c.search('db')).resolves.toMatchObject({ items: [{ label: 'db' }] })
    expect(p.calls.at(-1)!.url).toBe(`${API}/items?q=db`)
    await expect(c.hosts('secret', 3)).resolves.toEqual({ hosts: [{ id: 10, name: 'Visible host' }], nextCursor: null })
    expect(p.calls.at(-1)!.url).toBe(`${API}/hosts?kind=secret&sourceId=3`)
    expect(p.calls.at(-1)!.init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' })
    await expect(c.capabilities()).resolves.toMatchObject({ features: { reveal: false } })
    expect(await c.fingerprint()).toBe((s.peek().key!.jkt.slice(0, 16).match(/.{4}/g) ?? []).join('-'))
  })
  it('NA-0190: reports an unreachable portal as offline before opening the consent window', async () => {
    const p = portal(), base = p.fetcher.getMockImplementation()!
    p.fetcher.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => ((input instanceof Request ? input.url : input.toString()) === `${PORTAL}/` ? Promise.reject(new TypeError('Failed to fetch')) : base(input, init)))
    const { c } = client(p)
    await expect(c.connect()).rejects.toMatchObject({ reason: 'offline' })
    expect(p.flow.launch).not.toHaveBeenCalled()
    const [url, init] = p.fetcher.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${PORTAL}/`); expect(init.credentials).toBe('omit'); expect(init.method).toBe('GET')
  })
  it('NA-0190: a consent page that cannot load is offline; a closed window is cancelled', async () => {
    const p = portal(), { c } = client(p)
    p.flow.launch.mockRejectedValueOnce(new Error('Authorization page could not be loaded.'))
    await expect(c.connect()).rejects.toMatchObject({ reason: 'offline' })
    p.flow.launch.mockRejectedValueOnce(new Error('The user did not approve access.'))
    await expect(c.connect()).rejects.toMatchObject({ reason: 'cancelled' })
    p.flow.launch.mockRejectedValueOnce('closed')
    await expect(c.connect()).rejects.toMatchObject({ reason: 'cancelled' })
  })
  it('NA-0192: keeps the portal language returned with the code, only pt-BR or en', async () => {
    for (const [lang, expected] of [['en', 'en'], ['pt-BR', 'pt-BR'], ['fr', null], ['', null]] as const) {
      const p = portal(), base = p.flow.launch.getMockImplementation()!
      p.flow.launch.mockImplementation(async (url: string) => `${await base(url)}${lang ? `&lang=${lang}` : ''}`)
      const { c, s } = client(p)
      expect(await c.locale()).toBeNull()
      await c.connect()
      expect(await c.locale()).toBe(expected); expect(s.peek().locale).toBe(expected)
    }
  })
  const urls = (p: ReturnType<typeof portal>): string[] => p.fetcher.mock.calls.map(([u]) => (u instanceof Request ? u.url : u.toString()))
  const lastInit = (p: ReturnType<typeof portal>, suffix: string): RequestInit => p.fetcher.mock.calls.filter(([u]) => (u instanceof Request ? u.url : u.toString()).endsWith(suffix)).at(-1)![1]!
  it('NA-0193: renews a trusted device with its key and maps the server answers', async () => {
    const p = portal(), base = p.fetcher.getMockImplementation()!
    let answer: { status: number; code?: string } | null = null
    p.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === `${API}/renew` && answer) return new Response(JSON.stringify(answer.code ? { code: answer.code } : {}), { status: answer.status })
      if (url === `${API}/renew`) return new Response(JSON.stringify({ accessToken: 'R'.repeat(43), tokenType: 'DPoP', expiresAt: 1_800_000, serverNow: 0 }), { status: 200 })
      if (url === `${API}/forget`) return new Response(JSON.stringify({ state: 'FORGOTTEN' }), { status: 200 })
      return base(input, init)
    })
    const { c, s } = client(p)
    await expect(c.renew()).rejects.toMatchObject({ reason: 'expired' })
    expect(urls(p).some(u => u.endsWith('/renew'))).toBe(false)
    await c.connect(); await c.disconnect()
    expect(urls(p).some(u => u.endsWith('/forget'))).toBe(true); expect(s.peek().auth).toBeNull()
    expect(JSON.parse(lastInit(p, '/forget').body as string)).toEqual({ extensionId: EXT })
    expect((lastInit(p, '/forget').headers as Record<string, string>).Authorization).toBeUndefined()
    await c.renew()
    expect(s.peek().auth?.accessToken).toBe('R'.repeat(43))
    const sent = lastInit(p, '/renew')
    expect(JSON.parse(sent.body as string)).toEqual({ extensionId: EXT }); expect((sent.headers as Record<string, string>).DPoP).toBeTruthy()
    await c.renew('123456')
    expect(JSON.parse(lastInit(p, '/renew').body as string)).toEqual({ extensionId: EXT, otp: '123456' })
    await expect(c.renew('12')).rejects.toMatchObject({ reason: 'otpInvalid' })
    for (const [status, code, reason] of [[401, 'EXTENSION_REAUTH_REQUIRED', 'reauthRequired'], [403, 'VAULT_REAUTH_FAILED', 'otpInvalid'], [401, 'EXTENSION_UNAUTHORIZED', 'expired'], [403, undefined, 'denied']] as const) {
      answer = { status, ...(code ? { code } : {}) }
      await expect(c.renew('123456')).rejects.toMatchObject({ reason })
    }
    answer = null
    // With the authorization already gone, Disconnect still ends the trust by the device key.
    await s.session.clear(); await c.disconnect()
    expect(urls(p).filter(u => u.endsWith('/forget'))).toHaveLength(2)
  })
  it('NA-0200: asks for a portal confirmation, keeps only its id, and redeems it once approved', async () => {
    const p = portal(), base = p.fetcher.getMockImplementation()!, request = 'q'.repeat(43)
    let claim: () => Response = () => new Response(JSON.stringify({ state: 'PENDING' }), { status: 200 })
    let failMetadata = false, claims = 0
    let metadataGate: Promise<void> | null = null, metadataStarted: (() => void) | null = null
    let url = `${PORTAL}/vault/extension/confirm?request=${request}`
    p.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : input.toString()
      if (target === `${API}/proof-request`) return new Response(JSON.stringify({ request, url, expiresAt: 120_000, serverNow: 0 }), { status: 200 })
      if (target === `${API}/proof-claim`) { claims++; expect(JSON.parse(init!.body as string)).toEqual({ request }); return claim() }
      if (target.startsWith(`${API}/items?`) && metadataGate) { metadataStarted?.(); await metadataGate }
      if (target.startsWith(`${API}/items?`) && failMetadata) return new Response('{}', { status: 503 })
      return base(input, init)
    })
    const { c, s } = client(p)
    await c.connect()
    expect(await c.claimPortalProof()).toEqual({ state: 'none' })
    expect(await c.requestPortalProof()).toBe(url); expect(s.peek().portalProof).toBe(request)
    expect(await c.claimPortalProof()).toEqual({ state: 'pending' })
    claim = () => new Response(JSON.stringify({ state: 'APPROVED', proofUntil: 300_000, serverNow: 0 }), { status: 200 })
    expect(await c.claimPortalProof()).toEqual({ state: 'approved', proofUntil: T0 + 300_000 - 2_000 }); expect(s.peek().portalProof).toBeNull()
    await c.requestPortalProof({ sourceId: 3, action: 'copy' })
    expect(JSON.stringify(await s.session.portalIntent())).not.toContain(p.access)
    expect(await c.claimPortalProof()).toMatchObject({ resume: { item: { sourceId: 3, label: 'db' }, action: 'copy' } })
    expect(await s.session.portalIntent()).toBeNull()
    await c.requestPortalProof({ sourceId: 3, action: 'copy' })
    failMetadata = true
    await expect(c.claimPortalProof()).rejects.toMatchObject({ reason: 'unavailable' })
    expect(await s.session.portalIntent()).toHaveProperty('approvedUntil')
    const claimed = claims; failMetadata = false
    expect(await c.claimPortalProof()).toMatchObject({ resume: { item: { sourceId: 3 } } })
    expect(claims).toBe(claimed)
    await c.requestPortalProof({ sourceId: 3, action: 'reveal' })
    let finishMetadata!: () => void
    const started = new Promise<void>(resolve => { metadataStarted = resolve })
    metadataGate = new Promise<void>(resolve => { finishMetadata = resolve })
    const oldClaim = c.claimPortalProof(); await started
    const cancelled = c.cancelPortalProof(), newer = c.requestPortalProof({ sourceId: 3, action: 'copy' })
    finishMetadata(); await Promise.all([oldClaim, cancelled, newer]); metadataGate = null
    expect(await s.session.portalIntent()).toMatchObject({ action: 'copy' })
    expect(s.peek().portalProof).toBe(request)
    await c.requestPortalProof({ sourceId: 3, action: 'reveal' })
    const intent = await s.session.portalIntent() as Record<string, unknown>
    await s.session.setPortalIntent({ ...intent, binding: 'foreign-session' })
    expect(await c.claimPortalProof()).not.toHaveProperty('resume')
    await c.requestPortalProof({ sourceId: 3, action: 'reveal' })
    await s.session.setPortalIntent({ ...await s.session.portalIntent() as object, expiresAt: T0 - 1 })
    expect(await c.claimPortalProof()).not.toHaveProperty('resume')
    await c.requestPortalProof({ sourceId: 999, action: 'reveal' })
    expect(await c.claimPortalProof()).not.toHaveProperty('resume')
    await c.requestPortalProof({ sourceId: 3, action: 'copy' }); await c.cancelPortalProof()
    expect(await c.claimPortalProof()).toEqual({ state: 'none' }); expect(await s.session.portalIntent()).toBeNull()
    // An expired or foreign request is dropped.
    await c.requestPortalProof()
    claim = () => new Response(JSON.stringify({ code: 'EXTENSION_PROOF_UNAVAILABLE' }), { status: 409 })
    await expect(c.claimPortalProof()).rejects.toMatchObject({ reason: 'portalProofExpired' }); expect(s.peek().portalProof).toBeNull()
    // A limit keeps the request (it may already be approved) and explains itself.
    await c.requestPortalProof()
    claim = () => new Response('{}', { status: 429 })
    await expect(c.claimPortalProof()).rejects.toMatchObject({ reason: 'quota' }); expect(s.peek().portalProof).toBe(request)
    // Only the confirmation page of the configured portal is opened.
    url = 'https://evil.example/vault/extension/confirm?request=' + request
    await expect(c.requestPortalProof()).rejects.toMatchObject({ reason: 'unavailable' })
    url = `${PORTAL}/vault/extension/confirm?request=${request}`
    claim = () => new Response(JSON.stringify({ state: 'APPROVED', proofUntil: 300_000, serverNow: 0 }))
    await c.requestPortalProof({ sourceId: 3, action: 'copy' })
    const lookupStarted = new Promise<void>(resolve => { metadataStarted = resolve })
    metadataGate = new Promise<void>(resolve => { finishMetadata = resolve })
    const interrupted = c.claimPortalProof(); const rejected = expect(interrupted).rejects.toMatchObject({ reason: 'unavailable' })
    await lookupStarted; const logout = c.disconnect(); failMetadata = true; finishMetadata()
    await rejected; await logout
    expect(await s.session.get()).toBeNull(); expect(await s.session.portalIntent()).toBeNull()
  })
  it('NA-0195: unlocks with the code and opens a release sealed to an ephemeral key', async () => {
    const { CompactEncrypt, importJWK } = await import('jose')
    const p = portal(), base = p.fetcher.getMockImplementation()!
    let deliverAnswer: (body: { recipient: { kty: string; n: string; e: string }; secretId: number; action: string }) => Promise<Response> = () => Promise.resolve(new Response('{}', { status: 423 }))
    p.fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === `${API}/unlock`) {
        const { otp } = JSON.parse(init!.body as string) as { otp: string }
        return otp === '123456' ? new Response(JSON.stringify({ proofUntil: 300_000, serverNow: 0 }), { status: 200 }) : new Response(JSON.stringify({ code: 'VAULT_REAUTH_FAILED' }), { status: 403 })
      }
      if (url === `${API}/deliver`) return deliverAnswer(JSON.parse(init!.body as string) as { recipient: { kty: string; n: string; e: string }; secretId: number; action: string })
      return base(input, init)
    })
    const { c } = client(p)
    await c.connect()
    await expect(c.unlock('000000')).rejects.toMatchObject({ reason: 'otpInvalid' })
    await expect(c.unlock('12')).rejects.toMatchObject({ reason: 'otpInvalid' })
    expect(await c.unlock('123456')).toBe(T0 + 300_000 - 2_000)
    await expect(c.deliver(3, 'reveal')).rejects.toMatchObject({ reason: 'proofRequired' })
    const thumb = async (jwk: { e: string; kty: string; n: string }) => (await import('./envelope')).thumbprintOf(jwk)
    deliverAnswer = async body => {
      const context = { version: 1, operationId: 'o'.repeat(43), tenantId: 3, userId: 7, clientId: 'c'.repeat(64), action: body.action, itemRef: `secret:${body.secretId}`,
        recipientThumbprint: await thumb(body.recipient), policyVersion: 1, secretVersion: 'f'.repeat(64), expiresAt: 9, origin: PORTAL }
      const envelope = await new CompactEncrypt(new TextEncoder().encode('s3cret')).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context })
        .encrypt(await importJWK(body.recipient as never, 'RSA-OAEP-256'))
      return new Response(JSON.stringify({ envelope, context, serverNow: 0 }), { status: 200 })
    }
    expect(await c.deliver(3, 'reveal')).toBe('s3cret')
    const good = deliverAnswer
    deliverAnswer = async body => { const r = await (await good({ ...body, secretId: 9 })).json() as object; return new Response(JSON.stringify(r), { status: 200 }) }
    await expect(c.deliver(3, 'reveal')).rejects.toMatchObject({ reason: 'invalid' })
    deliverAnswer = () => Promise.resolve(new Response(JSON.stringify({ code: 'EXTENSION_ITEM_DENIED' }), { status: 403 }))
    await expect(c.deliver(3, 'copy')).rejects.toMatchObject({ reason: 'itemDenied' })
    deliverAnswer = () => Promise.resolve(new Response('{}', { status: 429 }))
    await expect(c.deliver(3, 'copy')).rejects.toMatchObject({ reason: 'quota' })
    await expect(c.deliver(0, 'copy')).rejects.toMatchObject({ reason: 'invalid' })
  })
  it('reuses one device key across connections', async () => {
    const s = stores()
    const first = portal(); await client(first, s).c.connect()
    const jkt = s.peek().key!.jkt
    const second = portal(); await client(second, s).c.connect()
    expect(second.consentUrl()!.searchParams.get('deviceJkt')).toBe(jkt)
  })
  it.each([
    ['a mismatched state', (_u: URL) => `https://${EXT}.chromiumapp.org/?code=${opaque()}&state=other`, 'invalid'],
    ['another redirect origin', (u: URL) => `https://evil.example/?code=${opaque()}&state=${u.searchParams.get('state')}`, 'invalid'],
    ['a denial', (u: URL) => `https://${EXT}.chromiumapp.org/?error=access_denied&state=${u.searchParams.get('state')}`, 'cancelled'],
    ['a malformed code', (u: URL) => `https://${EXT}.chromiumapp.org/?code=x&state=${u.searchParams.get('state')}`, 'invalid'],
    ['a code the server rejects', (u: URL) => `https://${EXT}.chromiumapp.org/?code=${opaque()}&state=${u.searchParams.get('state')}`, 'invalid'],
  ])('refuses %s and stores nothing', async (_name, consent, reason) => {
    const p = portal({ consent }), { c, s } = client(p)
    await expect(c.connect()).rejects.toMatchObject({ reason })
    expect(s.peek().auth).toBeNull()
  })
  it('treats a closed consent window as cancelled', async () => {
    const p = portal(), { c } = client(p)
    p.flow.launch.mockRejectedValueOnce(new Error('closed'))
    await expect(c.connect()).rejects.toMatchObject({ reason: 'cancelled' })
  })
  it('drops the authorization when it expires locally or the server refuses it', async () => {
    let now = Date.now()
    const p = portal(), { c, s } = client(p, stores(), () => now)
    await c.connect()
    now += 1_800_000
    await expect(c.search('')).rejects.toMatchObject({ reason: 'expired' })
    expect(s.peek().auth).toBeNull()
    const q = portal({ itemsStatus: 403 }), other = client(q)
    await other.c.connect()
    await expect(other.c.search('')).rejects.toMatchObject({ reason: 'denied' })
    expect(other.s.peek().auth).toBeNull()
    expect(await other.c.connected()).toBe(false)
  })
  it('maps upgrade and outage answers', async () => {
    const upgrade = portal({ itemsStatus: 426 }), u = client(upgrade)
    await u.c.connect()
    await expect(u.c.search('')).rejects.toMatchObject({ reason: 'upgrade' })
    expect(u.s.peek().auth).not.toBeNull()
    const down = portal(), d = client(down)
    await d.c.connect()
    down.fetcher.mockRejectedValueOnce(new TypeError('network'))
    await expect(d.c.search('')).rejects.toBeInstanceOf(ExtensionError)
  })
  it('opens only validated vault paths on the configured origin and keeps recents as IDs', async () => {
    const { c, s } = client(portal())
    expect(c.portalUrl('/vault?kind=pem&id=9')).toBe(`${PORTAL}/vault?kind=pem&id=9`)
    expect(c.portalUrl('/hosts?hostId=10')).toBe(`${PORTAL}/hosts?hostId=10`)
    expect(c.portalUrl('/hosts?hostId=10&connect=1')).toBe(`${PORTAL}/hosts?hostId=10&connect=1`)
    for (const bad of ['/hosts?hostId=10&connect=2', '/hosts?hostId=10&connect=1&tenantId=9']) expect(() => c.portalUrl(bad)).toThrow(ExtensionError)
    for (const bad of ['/hosts?hostId=0', '/hosts?hostId=10&tenantId=9', '/hosts?hostId=10#other', 'https://evil.example/hosts?hostId=10', 'https://user@vault.example.test/hosts?hostId=10']) expect(() => c.portalUrl(bad)).toThrow(ExtensionError)
    for (const bad of ['https://evil.example/vault?kind=pem&id=9', '//evil.example/x', '/admin', '/vault?kind=pem&id=9&x=1']) expect(() => c.portalUrl(bad)).toThrow(ExtensionError)
    for (let i = 0; i < 10; i++) await c.remember(`secret:${i}`)
    await c.remember('secret:3'); await c.remember('javascript:alert(1)')
    expect(await c.recents()).toEqual(['secret:3', 'secret:9', 'secret:8', 'secret:7', 'secret:6', 'secret:5', 'secret:4', 'secret:2'])
    await c.disconnect(); expect(s.peek().recents).toEqual([])
  })
})

describe('NA-0183 extension manifest', () => {
  it('requests gesture-scoped activeTab scripting and only the configured permanent origin', () => {
    const m = manifest(PORTAL, '0.1.0')
    expect(m.permissions).toEqual(['identity', 'storage', 'activeTab', 'scripting'])
    expect(m.host_permissions).toEqual([`${PORTAL}/*`])
    for (const forbidden of ['content_scripts', 'externally_connectable', 'web_accessible_resources', 'optional_permissions']) expect(m).not.toHaveProperty(forbidden)
    expect(JSON.stringify(m)).not.toMatch(/unsafe-eval|<all_urls>|\*:\/\//)
    expect(m).not.toHaveProperty('key')
    expect(manifest(PORTAL, '0.1.0', 'K'.repeat(120))).toMatchObject({ key: 'K'.repeat(120) })
  })
  it('NA-0207 describes reveal/copy and fill instead of metadata only, within the Chrome limit', () => {
    const description = String(manifest(PORTAL, '0.1.1').description)
    expect(description.length).toBeLessThanOrEqual(132)
    expect(description).not.toMatch(/somente metadados/i)
    expect(description).toMatch(/revela/)
    expect(description).toMatch(/preenche/)
  })
})
