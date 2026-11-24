/** Deliberately independent of api.ts: a consume must never be replayed or trigger a global reload. */
export interface VaultPortalIdentity {
  userId: number; tenantId: number; accessToken: string; refreshToken: string; origin: string
}
/** `noApprover` (NA-0188): the server refused a proposal no other manager could approve.
 * `reauth` (NA-0191): the identity confirmation failed (password, authenticator code or provider proof). */
export type VaultFailure = 'unavailable' | 'denied' | 'locked' | 'expired' | 'quota' | 'login' | 'clipboard' | 'unsupported' | 'noApprover' | 'reauth'
  /** NA-0198 */ | 'webauthn' | 'webauthnCancelled' | 'webauthnLimit'
export class VaultClientError extends Error {
  constructor(public readonly reason: VaultFailure) { super(reason) }
}
export interface VaultTransport {
  post<T>(path: string, body: object, identity: VaultPortalIdentity, clientId?: string, signal?: AbortSignal): Promise<T>
}
async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new VaultClientError('unavailable')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > 32768) { await reader.cancel(); throw new VaultClientError('unavailable') }
      text += decoder.decode(value, { stream: true })
    }
  } finally { reader.releaseLock() }
}
/** Error code of a refused request; any doubt is `null` (the status alone then decides). */
async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = JSON.parse(await readBounded(response)) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  } catch { return null }
}
export function createVaultTransport(fetcher: typeof fetch = globalThis.fetch): VaultTransport {
  return { async post<T>(path: string, body: object, identity: VaultPortalIdentity, clientId?: string, signal?: AbortSignal): Promise<T> {
    const abort = new AbortController()
    const cancel = (): void => abort.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) abort.abort()
    const timer = setTimeout(cancel, 8000)
    try {
      const response = await fetcher(`/api/v1/vault-security/${path}`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.accessToken}`, ...(clientId ? { 'x-vault-client': clientId } : {}) },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const reasons: Record<number, VaultFailure> = { 401: 'login', 403: 'denied', 404: 'unsupported', 409: 'expired', 423: 'locked', 429: 'quota' }
        const code = response.status === 409 || response.status === 403 ? await errorCode(response) : null
        if (response.status === 409 && code === 'VAULT_NO_APPROVER') throw new VaultClientError('noApprover')
        if (response.status === 409 && code === 'VAULT_WEBAUTHN_UNSUPPORTED') throw new VaultClientError('webauthn')
        if (response.status === 409 && code === 'VAULT_WEBAUTHN_LIMIT') throw new VaultClientError('webauthnLimit')
        if (response.status === 403 && code === 'VAULT_REAUTH_FAILED') throw new VaultClientError('reauth')
        throw new VaultClientError(reasons[response.status] ?? 'unavailable')
      }
      const text = await readBounded(response)
      return JSON.parse(text) as T
    } catch (error) {
      if (error instanceof VaultClientError) throw error
      throw new VaultClientError('unavailable')
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
  } }
}
