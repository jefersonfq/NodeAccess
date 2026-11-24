/**
 * NA-0198 — Windows Hello / passkey ceremonies with the browser's own WebAuthn API (no dependency). The server sends the
 * options as JSON (base64url) and verifies everything; this file only converts formats and maps a cancelled or refused
 * ceremony to a clear reason. Nothing here is stored.
 */
import { VaultClientError } from '@/services/vault-http'
import type { VaultWebauthnCeremony } from '@/services/vault-delivery'

const b64url = (buffer: ArrayBuffer): string => {
  let text = ''
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
const bytes = (value: unknown): ArrayBuffer => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new VaultClientError('unavailable')
  const text = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4))
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out.buffer
}
type Descriptor = { id: string; type?: string; transports?: string[] }
const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] => (Array.isArray(list) ? list as Descriptor[] : [])
  .map(d => ({ type: 'public-key' as const, id: bytes(d.id), ...(Array.isArray(d.transports) ? { transports: d.transports as AuthenticatorTransport[] } : {}) }))

/** Browser able to run the ceremony on this page (HTTPS, WebAuthn API). */
export function webauthnAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true && typeof window.PublicKeyCredential === 'function'
    && typeof navigator !== 'undefined' && typeof navigator.credentials?.get === 'function'
}
function refused(error: unknown): never {
  if (error instanceof VaultClientError) throw error
  // NotAllowedError covers cancel, timeout and "no matching credential" without telling them apart (by design of WebAuthn).
  throw new VaultClientError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'webauthnCancelled' : 'webauthn')
}
/** Unlock: answer the server's request options; returns the JSON the server expects. */
export async function webauthnAssertion(options: unknown, signal: AbortSignal): Promise<object> {
  const o = options as { challenge?: unknown; rpId?: unknown; allowCredentials?: unknown; timeout?: unknown; userVerification?: unknown }
  if (!o || typeof o.rpId !== 'string') throw new VaultClientError('unavailable')
  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({ signal, publicKey: { challenge: bytes(o.challenge), rpId: o.rpId, userVerification: 'required',
      timeout: typeof o.timeout === 'number' ? o.timeout : 120_000, allowCredentials: descriptors(o.allowCredentials) } })
  } catch (error) { refused(error) }
  if (!(credential instanceof PublicKeyCredential)) throw new VaultClientError('webauthn')
  const r = credential.response as AuthenticatorAssertionResponse
  return { id: credential.id, rawId: b64url(credential.rawId), type: 'public-key', clientExtensionResults: {},
    ...(credential.authenticatorAttachment === 'platform' || credential.authenticatorAttachment === 'cross-platform' ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
    response: { clientDataJSON: b64url(r.clientDataJSON), authenticatorData: b64url(r.authenticatorData), signature: b64url(r.signature),
      ...(r.userHandle ? { userHandle: b64url(r.userHandle) } : {}) } }
}
/** Registration: create a credential from the server's creation options; returns the JSON the server expects. */
export async function webauthnRegistration(options: unknown, signal: AbortSignal): Promise<object> {
  const o = options as { challenge?: unknown; rp?: { id?: unknown; name?: unknown }; user?: { id?: unknown; name?: unknown; displayName?: unknown }
    pubKeyCredParams?: unknown; excludeCredentials?: unknown; timeout?: unknown; authenticatorSelection?: AuthenticatorSelectionCriteria }
  if (!o?.rp || typeof o.rp.id !== 'string' || typeof o.rp.name !== 'string' || !o.user || typeof o.user.name !== 'string') throw new VaultClientError('unavailable')
  const params = Array.isArray(o.pubKeyCredParams) ? (o.pubKeyCredParams as Array<{ alg: number }>).map(p => ({ type: 'public-key' as const, alg: p.alg })) : []
  let credential: Credential | null
  try {
    credential = await navigator.credentials.create({ signal, publicKey: { challenge: bytes(o.challenge), rp: { id: o.rp.id, name: o.rp.name },
      user: { id: bytes(o.user.id), name: o.user.name, displayName: typeof o.user.displayName === 'string' ? o.user.displayName : o.user.name },
      pubKeyCredParams: params, attestation: 'none', timeout: typeof o.timeout === 'number' ? o.timeout : 120_000,
      authenticatorSelection: { ...o.authenticatorSelection, userVerification: 'required' }, excludeCredentials: descriptors(o.excludeCredentials) } })
  } catch (error) { refused(error) }
  if (!(credential instanceof PublicKeyCredential)) throw new VaultClientError('webauthn')
  const r = credential.response as AuthenticatorAttestationResponse
  const transports = typeof r.getTransports === 'function' ? r.getTransports().filter(t => ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'].includes(t)) : []
  return { id: credential.id, rawId: b64url(credential.rawId), type: 'public-key', clientExtensionResults: {},
    ...(credential.authenticatorAttachment === 'platform' || credential.authenticatorAttachment === 'cross-platform' ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
    response: { clientDataJSON: b64url(r.clientDataJSON), attestationObject: b64url(r.attestationObject), ...(transports.length ? { transports } : {}) } }
}
/** The real browser, for createVaultDelivery({ webauthn }). */
export const browserWebauthn: VaultWebauthnCeremony = { available: webauthnAvailable, assertion: webauthnAssertion, registration: webauthnRegistration }
