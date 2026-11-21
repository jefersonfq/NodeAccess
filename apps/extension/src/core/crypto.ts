import type { DeviceKey } from './ports'

/** WebCrypto only: no custom cryptography and no exported private key. */
const encoder = new TextEncoder()
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  // Linear padding trim (at most two '='); no backtracking regex.
  let text = btoa(binary).replaceAll('+', '-').replaceAll('/', '_')
  while (text.endsWith('=')) text = text.slice(0, -1)
  return text
}
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}
export async function sha256(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}
/** RFC 7636 S256 pair. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48)
  return { verifier, challenge: await sha256(verifier) }
}
/** RFC 7638 thumbprint of a P-256 public JWK (members in lexicographic order). */
export function thumbprint(jwk: DeviceKey['publicJwk']): Promise<string> {
  return sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
}
export async function createDeviceKey(): Promise<DeviceKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  if (exported.kty !== 'EC' || exported.crv !== 'P-256' || !exported.x || !exported.y) throw new Error('device key')
  const publicJwk = { kty: 'EC' as const, crv: 'P-256' as const, x: exported.x, y: exported.y }
  return { privateKey: pair.privateKey, publicJwk, jkt: await thumbprint(publicJwk) }
}
/** RFC 9449 proof: ES256, typ dpop+jwt, fresh jti, server nonce and access-token hash when present. */
export async function dpopProof(key: DeviceKey, method: 'GET' | 'POST', url: string, options: { nonce?: string; accessToken?: string; now?: number } = {}): Promise<string> {
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk }
  const payload: Record<string, unknown> = { jti: randomToken(16), htm: method, htu: url, iat: Math.floor((options.now ?? Date.now()) / 1000) }
  if (options.nonce) payload.nonce = options.nonce
  if (options.accessToken) payload.ath = await sha256(options.accessToken)
  const input = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`
  // WebCrypto ECDSA already yields the IEEE P1363 r||s form required by JWS ES256.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, encoder.encode(input))
  return `${input}.${base64url(signature)}`
}
