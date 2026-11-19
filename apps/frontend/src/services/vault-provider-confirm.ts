import { VaultClientError } from './vault-http'

/**
 * NA-0184: OIDC vault step-up runs in a separate window. The return reaches the vault page through a
 * same-origin BroadcastChannel (works even when the provider severs window.opener with COOP). Nothing is
 * stored in browser storage; the code is useless without the server-side challenge binding and PKCE verifier.
 */
const CHANNEL = 'nodeaccess-vault-step-up'
const TIMEOUT_MS = 5 * 60_000
const STATE = /^vsu\.[A-Za-z0-9_-]{16,512}$/

export function isVaultStepUpState(value: unknown): value is string {
  return typeof value === 'string' && STATE.test(value)
}

interface ReturnMessage { type: 'vault-step-up-return'; state: string; code: string }
interface Channel { postMessage(message: unknown): void; close(): void; onmessage: ((event: MessageEvent) => void) | null }
export interface ProviderWindowDependencies {
  open(url: string): { close(): void } | null
  channel(): Channel
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}
const browser = (): ProviderWindowDependencies => ({
  open: url => window.open(url, 'nodeaccess-vault-step-up', 'popup,width=520,height=720'),
  channel: () => new BroadcastChannel(CHANNEL),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
})

/** Called by the OIDC callback page in the confirmation window. */
export function forwardVaultStepUpReturn(state: string, code: string, channel: () => Channel = () => new BroadcastChannel(CHANNEL)): boolean {
  if (!isVaultStepUpState(state) || !code || code.length > 4096) return false
  const c = channel()
  try { c.postMessage({ type: 'vault-step-up-return', state, code } satisfies ReturnMessage) } finally { c.close() }
  return true
}

export function openVaultProviderWindow(authorizationUrl: string, signal: AbortSignal, deps: ProviderWindowDependencies = browser()): Promise<{ state: string; code: string }> {
  let url: URL
  try { url = new URL(authorizationUrl) } catch { return Promise.reject(new VaultClientError('unavailable')) }
  const state = url.searchParams.get('state')
  if (url.protocol !== 'https:' || !isVaultStepUpState(state)) return Promise.reject(new VaultClientError('unavailable'))
  if (signal.aborted) return Promise.reject(new VaultClientError('locked'))
  const channel = deps.channel()
  const popup = deps.open(url.toString())
  if (!popup) { channel.close(); return Promise.reject(new VaultClientError('unsupported')) }
  return new Promise((resolve, reject) => {
    let timer: unknown = null
    const finish = (error: VaultClientError | null, value?: { state: string; code: string }): void => {
      if (timer !== null) deps.clearTimeout(timer)
      channel.onmessage = null; channel.close(); signal.removeEventListener('abort', aborted)
      try { popup.close() } catch { /* already closed or severed */ }
      if (error) reject(error); else if (value) resolve(value)
    }
    const aborted = (): void => finish(new VaultClientError('locked'))
    channel.onmessage = (event: MessageEvent): void => {
      const data = event.data as Partial<ReturnMessage> | null
      if (!data || data.type !== 'vault-step-up-return' || data.state !== state || typeof data.code !== 'string' || !data.code || data.code.length > 4096) return
      finish(null, { state, code: data.code })
    }
    signal.addEventListener('abort', aborted, { once: true })
    timer = deps.setTimeout(() => finish(new VaultClientError('expired')), TIMEOUT_MS)
  })
}

interface GoogleIdentity {
  accounts: { id: {
    initialize(options: { client_id: string; nonce: string; auto_select: boolean; callback: (response: { credential?: string }) => void }): void
    renderButton(element: HTMLElement, options: Record<string, string | number>): void
    cancel(): void
  } }
}
let googleScript: Promise<GoogleIdentity> | null = null
function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const w = window as Window & { google?: GoogleIdentity }
  if (w.google) return Promise.resolve(w.google)
  googleScript ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = (): void => { if (w.google) resolve(w.google); else reject(new VaultClientError('unavailable')) }
    script.onerror = (): void => { googleScript = null; reject(new VaultClientError('unavailable')) }
    document.head.appendChild(script)
  })
  return googleScript
}

/** Renders the Google button in `element`; resolves with a fresh ID token carrying the challenge nonce. */
export async function requestGoogleIdToken(element: HTMLElement, clientId: string, nonce: string, signal: AbortSignal): Promise<string> {
  const google = await loadGoogleIdentity()
  if (signal.aborted) throw new VaultClientError('locked')
  return new Promise<string>((resolve, reject) => {
    const aborted = (): void => { google.accounts.id.cancel(); reject(new VaultClientError('locked')) }
    signal.addEventListener('abort', aborted, { once: true })
    google.accounts.id.initialize({
      client_id: clientId, nonce, auto_select: false,
      callback: response => {
        signal.removeEventListener('abort', aborted)
        if (typeof response.credential === 'string' && response.credential.length >= 32) resolve(response.credential)
        else reject(new VaultClientError('denied'))
      },
    })
    element.replaceChildren()
    google.accounts.id.renderButton(element, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with' })
  })
}
