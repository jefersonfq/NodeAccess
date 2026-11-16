import { calculateJwkThumbprint, compactDecrypt, exportJWK, generateKeyPair } from 'jose'

export interface VaultEnvelopeContext {
  version: 1; operationId: string; tenantId: number; userId: number; clientId: string;
  action: 'reveal' | 'copy'; itemRef: `secret:${number}`; recipientThumbprint: string;
  policyVersion: number; secretVersion: string; expiresAt: number; origin: string
}
const contextKeys = ['version', 'operationId', 'tenantId', 'userId', 'clientId', 'action', 'itemRef',
  'recipientThumbprint', 'policyVersion', 'secretVersion', 'expiresAt', 'origin'] as const
const token = /^[A-Za-z0-9_-]{43}$/
const digest = /^[a-f0-9]{64}$/
function invalid(): never { throw new Error('VAULT_ENVELOPE_INVALID') }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
export function assertVaultEnvelopeContext(value: unknown): asserts value is VaultEnvelopeContext {
  if (!object(value) || Object.keys(value).length !== contextKeys.length || !contextKeys.every(key => Object.hasOwn(value, key))) invalid()
  if (value.version !== 1 || !positive(value.tenantId) || !positive(value.userId) || !positive(value.policyVersion) || !positive(value.expiresAt)
    || typeof value.operationId !== 'string' || !token.test(value.operationId)
    || typeof value.clientId !== 'string' || !digest.test(value.clientId)
    || typeof value.recipientThumbprint !== 'string' || !token.test(value.recipientThumbprint)
    || typeof value.secretVersion !== 'string' || !digest.test(value.secretVersion)
    || (value.action !== 'reveal' && value.action !== 'copy')
    || typeof value.itemRef !== 'string' || !/^secret:[1-9][0-9]*$/.test(value.itemRef) || !positive(Number(value.itemRef.slice(7)))
    || typeof value.origin !== 'string') invalid()
  try { const url = new URL(value.origin); if (url.protocol !== 'https:' || url.origin !== value.origin) invalid() } catch { invalid() }
}
export async function createVaultRecipient(): Promise<{ recipient: { kty: 'RSA'; n: string; e: string }; thumbprint: string; privateKey: CryptoKey }> {
  const { publicKey, privateKey } = await generateKeyPair('RSA-OAEP-256', { modulusLength: 2048, extractable: false })
  const jwk = await exportJWK(publicKey)
  if (!jwk.n || !jwk.e) invalid()
  const recipient = { kty: 'RSA' as const, n: jwk.n, e: jwk.e }
  return { recipient, thumbprint: await calculateJwkThumbprint(recipient, 'sha256'), privateKey }
}
/** Caller binds expected context to local intent and checks monotonic TTL before/after awaiting.
 * No wall clock here: server timestamps are compared by the owning session state machine. */
export async function openVaultEnvelope(envelope: string, privateKey: CryptoKey, context: VaultEnvelopeContext): Promise<string> {
  let plaintext: Uint8Array | undefined
  try {
    assertVaultEnvelopeContext(context)
    const expected = { ...context } // Snapshot across asynchronous cryptography.
    if (typeof envelope !== 'string' || envelope.length > 20_480 || envelope.split('.').length !== 5
      || privateKey.type !== 'private' || privateKey.extractable || privateKey.algorithm.name !== 'RSA-OAEP') invalid()
    const result = await compactDecrypt(envelope, privateKey, { keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A256GCM'] })
    plaintext = result.plaintext
    const header = result.protectedHeader
    if (Object.keys(header).length !== 4 || !['alg', 'enc', 'typ', 'vault'].every(key => Object.hasOwn(header, key))
      || header.alg !== 'RSA-OAEP-256' || header.enc !== 'A256GCM' || header.typ !== 'vaultnaccess+jwe') invalid()
    const actual = header.vault
    assertVaultEnvelopeContext(actual)
    if (!contextKeys.every(key => actual[key] === expected[key]) || plaintext.length > 8192) invalid()
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch { return invalid() } finally { plaintext?.fill(0) } // Immutable strings/runtime copies cannot be guaranteed erased.
}
