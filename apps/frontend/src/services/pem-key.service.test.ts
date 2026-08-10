import { describe, expect, it } from 'vitest'
import { isEncryptedPrivateKey } from './pem-key-encryption'

function opensshHeader(cipher: string) {
  const magic = new TextEncoder().encode('openssh-key-v1\0')
  const name = new TextEncoder().encode(cipher)
  const bytes = new Uint8Array(magic.length + 4 + name.length)
  bytes.set(magic)
  new DataView(bytes.buffer).setUint32(magic.length, name.length)
  bytes.set(name, magic.length + 4)
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END OPENSSH PRIVATE KEY-----`
}

describe('isEncryptedPrivateKey', () => {
  it('detecta PKCS#8, PEM legado e PPK criptografados', () => {
    expect(isEncryptedPrivateKey('-----BEGIN ENCRYPTED PRIVATE KEY-----')).toBe(true)
    expect(isEncryptedPrivateKey('Proc-Type: 4,ENCRYPTED')).toBe(true)
    expect(isEncryptedPrivateKey('PuTTY-User-Key-File-3: ssh-rsa\nEncryption: aes256-cbc')).toBe(true)
  })

  it('distingue OpenSSH criptografado de não criptografado', () => {
    expect(isEncryptedPrivateKey(opensshHeader('aes256-ctr'))).toBe(true)
    expect(isEncryptedPrivateKey(opensshHeader('none'))).toBe(false)
  })
})
