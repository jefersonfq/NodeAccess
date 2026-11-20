import type { LocationQuery } from 'vue-router'
import type { VaultExtensionConnectRequest } from '@nodeaccess/shared'

/** NA-0183: pure helpers of the extension consent page (no browser storage, no network). */
interface Parser { safeParse(value: unknown): { success: true; data: VaultExtensionConnectRequest } | { success: false } }
const keys = ['extensionId', 'redirectUri', 'state', 'codeChallenge', 'codeChallengeMethod', 'deviceJkt'] as const

/** Accepts exactly the six single-valued parameters, and only the Chromium redirect of the same extension. */
export function extensionConsentRequest(query: LocationQuery, schema: Parser): VaultExtensionConnectRequest | null {
  if (Object.keys(query).some(k => !(keys as readonly string[]).includes(k))) return null
  const flat: Record<string, string> = {}
  for (const key of keys) {
    const value = query[key]
    if (typeof value !== 'string') return null
    flat[key] = value
  }
  const parsed = schema.safeParse(flat)
  if (!parsed.success || parsed.data.redirectUri !== `https://${parsed.data.extensionId}.chromiumapp.org/`) return null
  return parsed.data
}
/** Redirect back to the extension; parameters go in the query, which the extension reads and discards. */
export function extensionReturnUrl(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}
/** Short, comparable rendering of the device key thumbprint shown in both the page and the extension. */
export function fingerprint(jkt: string): string {
  return (jkt.slice(0, 16).match(/.{1,4}/g) ?? []).join('-')
}
