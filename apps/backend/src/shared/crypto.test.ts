import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0'.repeat(64)
})

import { EncryptionKeyring } from './crypto.js'

const OLD_KEY = '1'.repeat(64)
const NEW_KEY = '2'.repeat(64)

describe('EncryptionKeyring', () => {
  it('writes with the primary key and reads with the primary key', () => {
    const keyring = new EncryptionKeyring(NEW_KEY)
    expect(keyring.decrypt(keyring.encrypt('sensitive-value'))).toBe('sensitive-value')
  })

  it('reads legacy payloads with an explicitly configured previous key', () => {
    const legacy = new EncryptionKeyring(OLD_KEY).encrypt('legacy-secret')
    const rotated = new EncryptionKeyring(NEW_KEY, [OLD_KEY])

    expect(rotated.decrypt(legacy)).toBe('legacy-secret')
  })

  it('never writes new payloads with a previous key', () => {
    const rotated = new EncryptionKeyring(NEW_KEY, [OLD_KEY])
    const payload = rotated.encrypt('new-secret')

    expect(new EncryptionKeyring(NEW_KEY).decrypt(payload)).toBe('new-secret')
    expect(() => new EncryptionKeyring(OLD_KEY).decrypt(payload)).toThrow()
  })

  it('fails closed when no configured key can authenticate the payload', () => {
    const payload = new EncryptionKeyring(OLD_KEY).encrypt('legacy-secret')
    expect(() => new EncryptionKeyring(NEW_KEY).decrypt(payload)).toThrow(
      'Não foi possível descriptografar o payload com as chaves configuradas',
    )
  })

  it('rejects malformed keys and payloads', () => {
    expect(() => new EncryptionKeyring('invalid')).toThrow('Chave de criptografia inválida')
    expect(() => new EncryptionKeyring(NEW_KEY).decrypt({ encrypted: 'bad', iv: 'bad' }))
      .toThrow('Payload cifrado inválido')
  })
})
