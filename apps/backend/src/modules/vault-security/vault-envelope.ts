import { CompactEncrypt, calculateJwkThumbprint, importJWK } from 'jose'
import { createPublicKey } from 'node:crypto'
import type { EnvelopeSealer } from './vault-ports.js'
import { VaultError, type VaultSecret } from './vault-domain.js'
import { decrypt } from '../../shared/crypto.js'

type Recipient = { kty: 'RSA'; n: string; e: string }
/** RFC7516 compact JWE; protected context is authenticated, never a custom cipher. */
export class JweVaultEnvelope implements EnvelopeSealer {
  async validate(key: Recipient): Promise<string> {
    try {
      if (Object.keys(key).length !== 3 || !['e', 'kty', 'n'].every(name => Object.hasOwn(key, name)) || key.kty !== 'RSA' || key.e !== 'AQAB'
        || !/^[A-Za-z0-9_-]{342,683}$/.test(key.n)) throw new Error('key')
      const native = createPublicKey({ key, format: 'jwk' })
      const bits = native.asymmetricKeyDetails?.modulusLength ?? 0
      if (bits < 2048 || bits > 4096) throw new Error('key')
      await importJWK(key, 'RSA-OAEP-256')
      return await calculateJwkThumbprint(key, 'sha256')
    } catch { throw new VaultError('VAULT_RECIPIENT_INVALID', 400) }
  }
  async seal(key: Recipient, context: object, secret: VaultSecret): Promise<string> {
    const plaintext = Buffer.from(decrypt({ encrypted: secret.encrypted, iv: secret.iv }), 'utf8')
    try {
      if (plaintext.length > 8192) throw new VaultError('VAULT_ITEM_TOO_LARGE', 422)
      return await new CompactEncrypt(plaintext).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context })
        .encrypt(await importJWK(key, 'RSA-OAEP-256'))
    } finally { plaintext.fill(0) } // Other runtime/string copies cannot be guaranteed erased.
  }
}
