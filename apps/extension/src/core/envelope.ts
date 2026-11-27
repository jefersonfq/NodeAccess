/**
 * NA-0195 (E2) — opens a reveal/copy release in the popup with WebCrypto only (no dependency): an ephemeral RSA-OAEP
 * key whose private half is not extractable, and the compact JWE (RSA-OAEP-256 + A256GCM) whose protected header
 * must carry exactly the context the server returned, bound to the requested item, action and this key.
 */
import { base64url } from './crypto'

export interface DeliveryContext {
  version: 1; operationId: string; tenantId: number; userId: number; clientId: string; action: 'reveal' | 'copy' | 'fill'
  itemRef: string; recipientThumbprint: string; policyVersion: number; secretVersion: string; expiresAt: number; origin: string
}
export interface Recipient { publicJwk: { kty: 'RSA'; n: string; e: 'AQAB' }; thumbprint: string; privateKey: CryptoKey }
const KEYS = ['version', 'operationId', 'tenantId', 'userId', 'clientId', 'action', 'itemRef', 'recipientThumbprint', 'policyVersion', 'secretVersion', 'expiresAt', 'origin'] as const

export class EnvelopeError extends Error { constructor() { super('envelope') } }
const fail = (): never => { throw new EnvelopeError() }
function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) fail()
  const text = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(text.length))
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

/** RFC 7638 thumbprint, as the server computes it for the recipient. */
export async function thumbprintOf(jwk: { e: string; kty: string; n: string }): Promise<string> {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))))
}
export async function createRecipient(): Promise<Recipient> {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['decrypt'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  if (jwk.kty !== 'RSA' || jwk.e !== 'AQAB' || typeof jwk.n !== 'string') fail()
  const publicJwk = { kty: 'RSA' as const, n: jwk.n as string, e: 'AQAB' as const }
  return { publicJwk, thumbprint: await thumbprintOf(publicJwk), privateKey: pair.privateKey }
}
/** The server context must answer exactly this request (item, action, recipient) and still be alive. */
export function assertContext(context: unknown, expected: { itemRef: string; action: 'reveal' | 'copy' | 'fill'; thumbprint: string; origin?: string; serverNow?: number }): asserts context is DeliveryContext {
  const c = context as Record<string, unknown> | null
  if (!c || typeof c !== 'object' || Object.keys(c).length !== KEYS.length || !KEYS.every(k => Object.hasOwn(c, k))) fail()
  const ctx = c as Record<string, unknown>
  if (ctx.version !== 1 || ctx.itemRef !== expected.itemRef || ctx.action !== expected.action || ctx.recipientThumbprint !== expected.thumbprint
    || typeof ctx.expiresAt !== 'number' || typeof ctx.operationId !== 'string' || typeof ctx.origin !== 'string') fail()
  // Still alive by the server's own clock, and from the configured portal.
  if (expected.serverNow !== undefined && (typeof expected.serverNow !== 'number' || (ctx.expiresAt as number) <= expected.serverNow)) fail()
  if (expected.origin !== undefined && ctx.origin !== expected.origin) fail()
}
export async function openEnvelope(envelope: unknown, recipient: Recipient, context: DeliveryContext): Promise<string> {
  if (typeof envelope !== 'string' || envelope.length > 20_480) fail()
  const parts = (envelope as string).split('.')
  if (parts.length !== 5) fail()
  const [protectedB64, wrappedB64, ivB64, cipherB64, tagB64] = parts as [string, string, string, string, string]
  let header: Record<string, unknown>
  try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromB64url(protectedB64))) as Record<string, unknown> } catch { return fail() }
  if (Object.keys(header).length !== 4 || header.alg !== 'RSA-OAEP-256' || header.enc !== 'A256GCM' || header.typ !== 'vaultnaccess+jwe') fail()
  const actual = header.vault as Record<string, unknown> | null
  if (!actual || typeof actual !== 'object' || !KEYS.every(k => actual[k] === context[k]) || Object.keys(actual).length !== KEYS.length) fail()
  let cek: Uint8Array | undefined, plain: Uint8Array | undefined
  try {
    cek = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, recipient.privateKey, fromB64url(wrappedB64)))
    if (cek.length !== 32) fail()
    const key = await crypto.subtle.importKey('raw', cek as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['decrypt'])
    const cipher = fromB64url(cipherB64), tag = fromB64url(tagB64)
    const sealed = new Uint8Array(new ArrayBuffer(cipher.length + tag.length)); sealed.set(cipher); sealed.set(tag, cipher.length)
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(ivB64), additionalData: new TextEncoder().encode(protectedB64), tagLength: 128 }, key, sealed))
    if (plain.length > 8192) fail()
    return new TextDecoder('utf-8', { fatal: true }).decode(plain)
  } catch (error) {
    if (error instanceof EnvelopeError) throw error
    return fail()
  } finally { cek?.fill(0); plain?.fill(0) } // Strings and runtime copies cannot be guaranteed erased.
}
