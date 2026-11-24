import {
  VaultExtensionCapabilitiesSchema, VaultExtensionItemsReplySchema, VaultExtensionTokenReplySchema, VaultExtensionUnlockReplySchema,
  type VaultExtensionCapabilities, type VaultExtensionItemsReply, type VaultItemKind,
} from '@nodeaccess/shared'
import { createDeviceKey, dpopProof, pkcePair, randomToken } from './crypto'
import { assertContext, createRecipient, openEnvelope } from './envelope'
import type { AuthFlow, Authorization, DeviceKey, DeviceKeyStore, ExtensionInfo, SessionStore } from './ports'

/** `offline` (NA-0190): the portal did not answer at all (down, wrong origin, network).
 * `reauthRequired` / `otpInvalid` (NA-0193): the trusted device needs the authenticator code / the code was wrong.
 * `proofRequired` / `itemDenied` / `quota` (NA-0195): reveal/copy needs a fresh code / item or grant refused / limit reached. */
export type ExtensionFailure = 'denied' | 'cancelled' | 'expired' | 'upgrade' | 'unavailable' | 'invalid' | 'offline' | 'reauthRequired' | 'otpInvalid'
  | 'proofRequired' | 'itemDenied' | 'quota' | 'portalProofExpired' | 'portalProofUnavailable'
export class ExtensionError extends Error {
  constructor(public readonly reason: ExtensionFailure) { super(reason) }
}
const API = '/api/v1/vault-security/extension'
const MAX_BODY = 256 * 1024

interface Deps { info: ExtensionInfo; keys: DeviceKeyStore; session: SessionStore; flow: AuthFlow; fetcher?: typeof fetch; now?: () => number }
export interface ExtensionClient {
  connect(): Promise<void>
  connected(): Promise<boolean>
  disconnect(): Promise<void>
  capabilities(): Promise<VaultExtensionCapabilities>
  search(q: string, kind?: VaultItemKind, cursor?: string): Promise<VaultExtensionItemsReply>
  remember(key: string): Promise<void>
  recents(): Promise<string[]>
  portalUrl(path: string): string
  /** Short device fingerprint, identical to the one the consent page shows. */
  fingerprint(): Promise<string>
  /** NA-0192: portal language from the last connection, when known. */
  locale(): Promise<'pt-BR' | 'en' | null>
  /** NA-0193: reconnect this trusted device — automatically, or with the authenticator code. Never creates a device key. */
  renew(otp?: string): Promise<void>
  /** NA-0195: authenticator-code proof for reveal/copy; resolves with the local deadline of the proof. */
  unlock(otp: string): Promise<number>
  /** NA-0200: asks for a proof confirmed in the portal (Windows Hello or password + code); returns the page to open. */
  requestPortalProof(): Promise<string>
  /** NA-0200: redeems the stored request: `approved` (with the local proof deadline), `pending` or `none`. */
  claimPortalProof(): Promise<{ state: 'none' | 'pending' } | { state: 'approved'; proofUntil: number }>
  /** NA-0195: one reveal/copy release, opened in memory with an ephemeral key; nothing is stored. */
  deliver(secretId: number, action: 'reveal' | 'copy'): Promise<string>
}
/** Connection, DPoP-signed calls and metadata search. Holds the authorization only in the session store. */
export function createExtensionClient(deps: Deps): ExtensionClient {
  const fetcher = deps.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => globalThis.fetch(input, init))
  const now = deps.now ?? Date.now
  let nonce: string | undefined
  async function deviceKey(): Promise<DeviceKey> {
    const existing = await deps.keys.load()
    if (existing) return existing
    const created = await createDeviceKey()
    await deps.keys.save(created)
    return created
  }
  async function readJson(response: Response): Promise<unknown> {
    const text = await response.text()
    if (text.length > MAX_BODY) throw new ExtensionError('unavailable')
    try { return JSON.parse(text) } catch { throw new ExtensionError('unavailable') }
  }
  function failure(status: number, code: string | null = null): ExtensionError {
    if (status === 401 && code === 'EXTENSION_REAUTH_REQUIRED') return new ExtensionError('reauthRequired')
    if (status === 403 && code === 'VAULT_REAUTH_FAILED') return new ExtensionError('otpInvalid')
    if (status === 403 && code === 'EXTENSION_ITEM_DENIED') return new ExtensionError('itemDenied')
    if (status === 409 && code === 'EXTENSION_PROOF_UNAVAILABLE') return new ExtensionError('portalProofUnavailable')
    if (status === 423) return new ExtensionError('proofRequired')
    if (status === 429) return new ExtensionError('quota')
    if (status === 401) return new ExtensionError('expired')
    if (status === 403) return new ExtensionError('denied')
    if (status === 426) return new ExtensionError('upgrade')
    if (status === 400) return new ExtensionError('invalid')
    return new ExtensionError('unavailable')
  }
  /** One retry when the server asks for (or rotates) the DPoP nonce. */
  async function signed(method: 'GET' | 'POST', path: string, init: { body?: object; accessToken?: string; query?: URLSearchParams } = {}): Promise<unknown> {
    const key = await deviceKey()
    const url = `${deps.info.portalOrigin}${API}${path}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const proof = await dpopProof(key, method, url, { ...(nonce ? { nonce } : {}), ...(init.accessToken ? { accessToken: init.accessToken } : {}), now: now() })
      let response: Response
      try {
        response = await fetcher(init.query?.size ? `${url}?${init.query.toString()}` : url, {
          method, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
          headers: { DPoP: proof, 'X-Extension-Version': deps.info.version, ...(init.accessToken ? { Authorization: `DPoP ${init.accessToken}` } : {}),
            ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
          ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        })
      } catch { throw new ExtensionError('unavailable') }
      const issued = response.headers.get('DPoP-Nonce')
      if (issued && /^[0-9a-z]{1,12}\.[A-Za-z0-9_-]{32}$/.test(issued)) nonce = issued
      if (response.ok) return readJson(response)
      if (response.status === 401 && attempt === 0 && /use_dpop_nonce/.test(response.headers.get('WWW-Authenticate') ?? '')) continue
      let code: string | null = null
      try { const body = await readJson(response) as { code?: unknown }; code = typeof body.code === 'string' ? body.code : null } catch { code = null }
      throw failure(response.status, code)
    }
    throw new ExtensionError('unavailable')
  }
  async function authorization(): Promise<Authorization> {
    const current = await deps.session.get()
    if (!current || current.expiresAt <= now() || current.portalOrigin !== deps.info.portalOrigin) {
      await deps.session.clear()
      throw new ExtensionError('expired')
    }
    return current
  }
  async function guarded<T>(run: (auth: Authorization) => Promise<T>): Promise<T> {
    const auth = await authorization()
    try { return await run(auth) } catch (error) {
      if (error instanceof ExtensionError && (error.reason === 'expired' || error.reason === 'denied')) await deps.session.clear()
      throw error
    }
  }
  /** Keeps a token reply in session memory; local deadline from the server's remaining lifetime, never over 30 minutes. */
  async function keep(answer: unknown, started: number): Promise<void> {
    const reply = VaultExtensionTokenReplySchema.safeParse(answer)
    if (!reply.success) throw new ExtensionError('unavailable')
    const ttl = Math.min(reply.data.expiresAt - reply.data.serverNow, 1_800_000) - 5_000
    if (ttl <= 0) throw new ExtensionError('expired')
    await deps.session.set({ accessToken: reply.data.accessToken, portalOrigin: deps.info.portalOrigin, expiresAt: started + ttl })
  }
  /** NA-0190: any HTTP answer from the portal origin within 5 s proves it is up; no credentials, nothing read. */
  async function reachable(): Promise<void> {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5_000)
    try {
      await fetcher(new URL('/', deps.info.portalOrigin).toString(), { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'manual', referrerPolicy: 'no-referrer', signal: abort.signal })
    } catch { throw new ExtensionError('offline') } finally { clearTimeout(timer) }
  }
  return {
    /** Opens the portal consent page; on success keeps only the 30-minute authorization in session memory. */
    async connect(): Promise<void> {
      const key = await deviceKey()
      const { verifier, challenge } = await pkcePair()
      const state = randomToken(24), redirectUri = deps.flow.redirectUri()
      if (redirectUri !== `https://${deps.info.id}.chromiumapp.org/`) throw new ExtensionError('invalid')
      const consent = new URL('/vault/extension/connect', deps.info.portalOrigin)
      for (const [name, value] of Object.entries({ extensionId: deps.info.id, redirectUri, state, codeChallenge: challenge, codeChallengeMethod: 'S256', deviceJkt: key.jkt })) consent.searchParams.set(name, value)
      await reachable()
      let returned: URL
      try { returned = new URL(await deps.flow.launch(consent.toString())) } catch (error) {
        // Chromium rejects with "Authorization page could not be loaded" when the portal goes away meanwhile.
        throw new ExtensionError(error instanceof Error && /could not be loaded/i.test(error.message) ? 'offline' : 'cancelled')
      }
      if (`${returned.origin}/` !== redirectUri || returned.searchParams.get('state') !== state) throw new ExtensionError('invalid')
      if (returned.searchParams.get('error')) throw new ExtensionError(returned.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'denied')
      const code = returned.searchParams.get('code')
      if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new ExtensionError('invalid')
      const started = now()
      await keep(await signed('POST', '/token', { body: { code, codeVerifier: verifier, redirectUri, extensionId: deps.info.id } }), started)
      // NA-0192: the consent page tells which language the portal was using; only the two known codes are kept.
      const lang = returned.searchParams.get('lang')
      if (lang === 'pt-BR' || lang === 'en') await deps.session.setLocale(lang)
    },
    async connected(): Promise<boolean> {
      try { await authorization(); return true } catch { return false }
    },
    /** NA-0193: also ends this device's trust on the server, proven by the device key alone (works with an expired
     * authorization); best effort when the portal is unreachable. The next connection is a full consent. */
    async disconnect(): Promise<void> {
      if (await deps.keys.load().catch(() => null)) await signed('POST', '/forget', { body: { extensionId: deps.info.id } }).catch(() => undefined)
      await deps.session.clear()
    },
    capabilities(): Promise<VaultExtensionCapabilities> {
      return guarded(async auth => {
        const parsed = VaultExtensionCapabilitiesSchema.safeParse(await signed('GET', '/capabilities', { accessToken: auth.accessToken }))
        if (!parsed.success || parsed.data.portalOrigin !== deps.info.portalOrigin) throw new ExtensionError('unavailable')
        return parsed.data
      })
    },
    search(q: string, kind?: VaultItemKind, cursor?: string): Promise<VaultExtensionItemsReply> {
      return guarded(async auth => {
        const query = new URLSearchParams()
        if (q.trim()) query.set('q', q.trim().slice(0, 100))
        if (kind) query.set('kind', kind)
        if (cursor) query.set('cursor', cursor)
        const parsed = VaultExtensionItemsReplySchema.safeParse(await signed('GET', '/items', { accessToken: auth.accessToken, query }))
        if (!parsed.success) throw new ExtensionError('unavailable')
        return parsed.data
      })
    },
    async fingerprint(): Promise<string> {
      const { jkt } = await deviceKey()
      return (jkt.slice(0, 16).match(/.{1,4}/g) ?? []).join('-')
    },
    /** Recently opened items: only `kind:id` keys, in session memory, at most 8. */
    async remember(key: string): Promise<void> {
      if (!/^(secret|pem):\d{1,9}$/.test(key)) return
      const list = (await deps.session.recents()).filter(k => k !== key)
      await deps.session.setRecents([key, ...list].slice(0, 8))
    },
    recents(): Promise<string[]> { return deps.session.recents() },
    /** Portal URL for an item; only server-validated relative paths on the configured origin. */
    requestPortalProof(): Promise<string> {
      return guarded(async auth => {
        const reply = await signed('POST', '/proof-request', { accessToken: auth.accessToken, body: {} }) as { request?: unknown; url?: unknown } | null
        const request = reply?.request
        if (typeof request !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request)) throw new ExtensionError('unavailable')
        // Only the confirmation page of the configured portal, for this very request.
        const url = `${deps.info.portalOrigin}/vault/extension/confirm?request=${request}`
        if (reply?.url !== url) throw new ExtensionError('unavailable')
        await deps.session.setPortalProof(request)
        return url
      })
    },
    async claimPortalProof(): Promise<{ state: 'none' | 'pending' } | { state: 'approved'; proofUntil: number }> {
      const request = await deps.session.portalProof()
      if (!request) return { state: 'none' }
      try {
        return await guarded(async auth => {
          const started = now()
          const reply = await signed('POST', '/proof-claim', { accessToken: auth.accessToken, body: { request } }) as { state?: unknown; proofUntil?: unknown; serverNow?: unknown } | null
          if (reply?.state === 'PENDING') return { state: 'pending' as const }
          if (reply?.state !== 'APPROVED' || typeof reply.proofUntil !== 'number' || typeof reply.serverNow !== 'number') throw new ExtensionError('unavailable')
          await deps.session.setPortalProof(null)
          return { state: 'approved' as const, proofUntil: started + Math.max(0, reply.proofUntil - reply.serverNow) - 2_000 }
        })
      } catch (failure) {
        // Only an expired, redeemed or foreign request (409) is dropped; other failures keep it and explain themselves.
        if (failure instanceof ExtensionError && failure.reason === 'portalProofUnavailable') {
          await deps.session.setPortalProof(null)
          throw new ExtensionError('portalProofExpired')
        }
        throw failure
      }
    },
    unlock(otp: string): Promise<number> {
      return guarded(async auth => {
        if (!/^\d{6}$/.test(otp)) throw new ExtensionError('otpInvalid')
        const started = now()
        const reply = VaultExtensionUnlockReplySchema.safeParse(await signed('POST', '/unlock', { accessToken: auth.accessToken, body: { otp } }))
        if (!reply.success) throw new ExtensionError('unavailable')
        return started + Math.max(0, reply.data.proofUntil - reply.data.serverNow) - 2_000
      })
    },
    deliver(secretId: number, action: 'reveal' | 'copy'): Promise<string> {
      return guarded(async auth => {
        if (!Number.isSafeInteger(secretId) || secretId <= 0) throw new ExtensionError('invalid')
        const recipient = await createRecipient()
        const reply = await signed('POST', '/deliver', { accessToken: auth.accessToken, body: { secretId, action, recipient: recipient.publicJwk } }) as { envelope?: unknown; context?: unknown; serverNow?: unknown } | null
        try {
          if (typeof reply?.serverNow !== 'number') throw new Error('serverNow')
          assertContext(reply.context, { itemRef: `secret:${secretId}`, action, thumbprint: recipient.thumbprint, origin: deps.info.portalOrigin, serverNow: reply.serverNow })
          return await openEnvelope(reply?.envelope, recipient, reply.context)
        } catch { throw new ExtensionError('invalid') }
      })
    },
    async renew(otp?: string): Promise<void> {
      if (otp !== undefined && !/^\d{6}$/.test(otp)) throw new ExtensionError('otpInvalid')
      // A browser without a device key was never trusted: the portal consent is the only way in.
      if (!await deps.keys.load()) throw new ExtensionError('expired')
      const started = now()
      await keep(await signed('POST', '/renew', { body: { extensionId: deps.info.id, ...(otp !== undefined ? { otp } : {}) } }), started)
    },
    async locale(): Promise<'pt-BR' | 'en' | null> {
      const value = await deps.session.locale().catch(() => null)
      return value === 'pt-BR' || value === 'en' ? value : null
    },
    portalUrl(path: string): string {
      const url = new URL(path, deps.info.portalOrigin)
      if (url.origin !== deps.info.portalOrigin || !/^\/vault\?kind=(secret|pem)&id=\d{1,9}$/.test(`${url.pathname}${url.search}`)) throw new ExtensionError('invalid')
      return url.toString()
    },
  }
}
