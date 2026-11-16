import { beforeAll, describe, expect, it } from 'vitest'
import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
import { CompactEncrypt, importJWK } from 'jose'
import { assertVaultEnvelopeContext, createVaultRecipient, openVaultEnvelope, type VaultEnvelopeContext } from './vault-envelope'

let recipient: Awaited<ReturnType<typeof createVaultRecipient>>
let context: VaultEnvelopeContext
beforeAll(async () => {
  recipient = await createVaultRecipient()
  context = { version: 1, operationId: 'a'.repeat(43), tenantId: 2, userId: 1, clientId: 'b'.repeat(64), action: 'reveal',
    itemRef: 'secret:4', recipientThumbprint: recipient.thumbprint, policyVersion: 1, secretVersion: 'c'.repeat(64), expiresAt: 31000, origin: 'https://vault.example.test' }
})
async function seal(value = new TextEncoder().encode('test-password'), changes: Record<string, unknown> = {}, headerChanges: Record<string, unknown> = {}) {
  return new CompactEncrypt(value).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: { ...context, ...changes }, ...headerChanges })
    .encrypt(await importJWK(recipient.recipient, 'RSA-OAEP-256'))
}
describe('Vault browser envelope', () => {
  it('generates only a three-field public JWK and a nonexportable private key', async () => {
    expect(Object.keys(recipient.recipient).sort()).toEqual(['e', 'kty', 'n'])
    expect(recipient.privateKey.extractable).toBe(false)
    expect((recipient.privateKey.algorithm as RsaKeyAlgorithm).modulusLength).toBe(2048)
    await expect(crypto.subtle.exportKey('jwk', recipient.privateKey)).rejects.toThrow()
  })
  it('interoperates with independent native RSA-OAEP-SHA256/AES-GCM encryption', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context })).toString('base64url')
    const cek = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cek, iv)
    cipher.setAAD(Buffer.from(header, 'ascii'))
    const ciphertext = Buffer.concat([cipher.update('senha-ç🔒', 'utf8'), cipher.final()])
    const wrapped = publicEncrypt({ key: createPublicKey({ key: recipient.recipient, format: 'jwk' }), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, cek)
    const compact = [header, wrapped.toString('base64url'), iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')
    await expect(openVaultEnvelope(compact, recipient.privateKey, context)).resolves.toBe('senha-ç🔒')
  })
  it.each(['version','operationId','tenantId','userId','clientId','action','itemRef','recipientThumbprint','policyVersion','secretVersion','expiresAt','origin'])('rejects mismatching authenticated %s', async field => {
    const changes: Record<string, unknown> = { version: 2, operationId: 'd'.repeat(43), tenantId: 3, userId: 3, clientId: 'd'.repeat(64), action: 'copy',
      itemRef: 'secret:5', recipientThumbprint: 'd'.repeat(43), policyVersion: 2, secretVersion: 'd'.repeat(64), expiresAt: 32000, origin: 'https://other.example.test' }
    await expect(openVaultEnvelope(await seal(undefined, { [field]: changes[field] }), recipient.privateKey, context)).rejects.toThrow('VAULT_ENVELOPE_INVALID')
  })
  it('rejects unknown header/context fields and incorrect typ', async () => {
    for (const encrypted of [await seal(undefined, { extra: true }), await seal(undefined, {}, { extra: true }), await seal(undefined, {}, { typ: 'other' })]) {
      await expect(openVaultEnvelope(encrypted, recipient.privateKey, context)).rejects.toThrow('VAULT_ENVELOPE_INVALID')
    }
  })
  it('rejects authenticated alternative encryption algorithms', async () => {
    for (const changes of [{ alg: 'RSA-OAEP' }, { enc: 'A128GCM' }]) {
      const header = { alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'vaultnaccess+jwe', vault: context, ...changes }
      const encrypted = await new CompactEncrypt(new TextEncoder().encode('test-password')).setProtectedHeader(header)
        .encrypt(await importJWK(recipient.recipient, header.alg))
      await expect(openVaultEnvelope(encrypted, recipient.privateKey, context)).rejects.toThrow('VAULT_ENVELOPE_INVALID')
    }
  })
  it('snapshots expected context before awaiting cryptography', async () => {
    const encrypted = await seal(), expected = { ...context }
    const opening = openVaultEnvelope(encrypted, recipient.privateKey, expected)
    expected.tenantId = 999
    await expect(opening).resolves.toBe('test-password')
  })
  it('limits plaintext by bytes and rejects malformed UTF8', async () => {
    await expect(openVaultEnvelope(await seal(new Uint8Array(8192).fill(65)), recipient.privateKey, context)).resolves.toHaveLength(8192)
    for (const bytes of [new Uint8Array(8193), new Uint8Array([255])]) {
      await expect(openVaultEnvelope(await seal(bytes), recipient.privateKey, context)).rejects.toThrow('VAULT_ENVELOPE_INVALID')
    }
  })
  it('rejects malformed, oversized and tampered envelopes and another private key', async () => {
    const encrypted = await seal(), fields = encrypted.split('.')
    fields[3] = (fields[3]?.startsWith('A') ? 'B' : 'A') + fields[3]?.slice(1)
    for (const value of ['', 'a'.repeat(20481), fields.join('.')]) await expect(openVaultEnvelope(value, recipient.privateKey, context)).rejects.toThrow('VAULT_ENVELOPE_INVALID')
    await expect(openVaultEnvelope(encrypted, (await createVaultRecipient()).privateKey, context)).rejects.toThrow('VAULT_ENVELOPE_INVALID')
  })
  it('validates local expected context strictly without trusting server-shaped extras', () => {
    for (const value of [null, [], { ...context, extra: true }, { ...context, expiresAt: NaN }, { ...context, itemRef: 'secret:01' }, { ...context, origin: 'http://vault.example.test' }]) {
      expect(() => assertVaultEnvelopeContext(value)).toThrow('VAULT_ENVELOPE_INVALID')
    }
  })
})
