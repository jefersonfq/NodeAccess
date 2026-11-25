export type SiteFillMode = 'username' | 'password' | 'both'
/** Browser identity bound to the server's single-use fill operation. */
export interface SiteFillBinding {
  readonly mode?: SiteFillMode
  readonly origin: string
  readonly tabId: number
  readonly frameId: 0
  readonly documentId: string
}
export type SiteFillCredentials =
  | { mode: 'username'; username: string }
  | { mode: 'password'; password: string }
  | { mode: 'both'; username: string; password: string }
export interface SiteFillBrowser {
  capture(): Promise<SiteFillBinding>
  /** Inspect only structure, before requesting credentials. No field values may be read. */
  preflight(binding: SiteFillBinding): Promise<SiteFillMode>
  fill(binding: SiteFillBinding, credentials: SiteFillCredentials): Promise<void>
}
export class SiteFillError extends Error {
  constructor(readonly reason: 'disabled' | 'target' | 'changed' | 'fields') {
    super(`site_fill_${reason}`)
    this.name = 'SiteFillError'
  }
}
export function validFillBinding(value: SiteFillBinding): boolean {
  try {
    const url = new URL(value.origin)
    return url.protocol === 'https:' && url.origin === value.origin &&
      Number.isSafeInteger(value.tabId) && value.tabId >= 0 && value.frameId === 0 &&
      typeof value.documentId === 'string' && value.documentId.length > 0
  } catch { return false }
}
export function sameFillBinding(a: SiteFillBinding, b: SiteFillBinding): boolean {
  return validFillBinding(b) && a.origin === b.origin && a.tabId === b.tabId &&
    a.frameId === b.frameId && a.documentId === b.documentId
}
/** Caller verifies the envelope and consumes the server operation exactly once in deliver.
 * Credentials are never persisted, logged, retried or passed to authorize/capture.
 */
export async function fillSite<Operation>(options: {
  enabled?: () => boolean
  origin: string
  browser: SiteFillBrowser
  authorize(binding: SiteFillBinding): Promise<Operation>
  deliver(operation: Operation, binding: SiteFillBinding): Promise<SiteFillCredentials>
}): Promise<void> {
  const enabled = (): void => { if (options.enabled?.() !== true) throw new SiteFillError('disabled') }
  enabled()
  const document = Object.freeze({ ...await options.browser.capture() })
  if (!validFillBinding(document) || document.origin !== options.origin) throw new SiteFillError('target')
  const mode = await options.browser.preflight(document)
  if (!['username', 'password', 'both'].includes(mode)) throw new SiteFillError('fields')
  const binding = Object.freeze({ ...document, mode })
  enabled()
  const operation = await options.authorize(binding)
  enabled()
  if (!sameFillBinding(binding, await options.browser.capture())) throw new SiteFillError('changed')
  if (await options.browser.preflight(binding) !== mode) throw new SiteFillError('changed')
  enabled()
  let credentials: SiteFillCredentials | undefined
  try {
    credentials = await options.deliver(operation, binding)
    enabled()
    if (!sameFillBinding(binding, await options.browser.capture())) throw new SiteFillError('changed')
    if (credentials.mode !== mode ||
      (mode !== 'password' && (!('username' in credentials) || typeof credentials.username !== 'string')) ||
      (mode !== 'username' && (!('password' in credentials) || typeof credentials.password !== 'string' || !credentials.password)) ||
      (mode === 'username' && 'password' in credentials) || (mode === 'password' && 'username' in credentials)) {
      throw new SiteFillError('fields')
    }
    enabled()
    await options.browser.fill(binding, credentials)
  } finally {
    // Drop our reference; JavaScript strings cannot be reliably zeroized.
    credentials = undefined
  }
}
