import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ssh2 from 'ssh2'
import type { ParsedKey } from 'ssh2'
import { PemKeyService } from './pem-key.service.js'
import type { PemKeyRepository } from './pem-key.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import { decrypt } from '../../shared/crypto.js'

function setup() {
  const create = vi.fn((data: Record<string, unknown>) => Promise.resolve({ id: 7, createdAt: new Date(), ...data }))
  const repository = { create } as unknown as PemKeyRepository
  const service = new PemKeyService(repository, { logAdminEvent: () => Promise.resolve() } as unknown as LogRepository)
  return { service, create }
}
afterEach(() => vi.restoreAllMocks())

describe('PEM normalization boundaries and legacy call compatibility', () => {
  it('preserves valid unencrypted PEM bytes when storing the encrypted key', async () => {
    const raw = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    const { service, create } = setup()
    await service.create({ name: 'test-key', key: raw }, 1)
    const stored = create.mock.calls[0]?.[0]
    expect(decrypt({ encrypted: String(stored?.encryptedKey), iv: String(stored?.iv) })).toBe(raw)
  })
  it('rejects invalid key data without persisting a key', async () => {
    const { service, create } = setup()
    await expect(service.create({ name: 'invalid', key: 'not-a-key' }, 1)).rejects.toThrow('Chave privada inválida')
    expect(create).not.toHaveBeenCalled()
  })
  it('preserves the legacy PPK method, receiver and argument; this is not a real PPK import test', async () => {
    const toString = vi.fn(function(this: object, format: unknown) { expect(this).toBe(parsed); expect(format).toBe('openssh'); return 'synthetic-converted-key' })
    const parsed = { toString }
    vi.spyOn(ssh2.utils, 'parseKey').mockReturnValue([parsed] as unknown as ParsedKey)
    const { service, create } = setup()
    await service.create({ name: 'legacy-contract', key: 'PuTTY-User-Key-File synthetic', passphrase: 'synthetic-passphrase' }, 1)
    expect(toString).toHaveBeenCalledExactlyOnceWith('openssh')
    const stored = create.mock.calls[0]?.[0]
    expect(decrypt({ encrypted: String(stored?.encryptedKey), iv: String(stored?.iv) })).toBe('synthetic-converted-key')
  })
  it.each(['', undefined, 42])('rejects an unusable legacy conversion result (%s) before persistence', async result => {
    vi.spyOn(ssh2.utils, 'parseKey').mockReturnValue({ toString: () => result } as unknown as ParsedKey)
    const { service, create } = setup()
    await expect(service.create({ name: 'invalid', key: 'PuTTY-User-Key-File synthetic' }, 1)).rejects.toThrow('Não foi possível converter')
    expect(create).not.toHaveBeenCalled()
  })
  it('rejects a parsed object without a callable legacy converter', async () => {
    vi.spyOn(ssh2.utils, 'parseKey').mockReturnValue({ toString: 7 } as unknown as ParsedKey)
    const { service, create } = setup()
    await expect(service.create({ name: 'invalid', key: 'PuTTY-User-Key-File synthetic' }, 1)).rejects.toThrow('Não foi possível converter')
    expect(create).not.toHaveBeenCalled()
  })
  it('preserves decryption-error guidance and rejects an empty parsed array', async () => {
    const parser = vi.spyOn(ssh2.utils, 'parseKey'), { service, create } = setup()
    parser.mockReturnValueOnce(new Error('decrypt failed'))
    await expect(service.create({ name: 'invalid', key: 'synthetic' }, 1)).rejects.toThrow('Informe a senha da chave')
    parser.mockReturnValueOnce([] as unknown as ParsedKey)
    await expect(service.create({ name: 'invalid', key: 'synthetic' }, 1)).rejects.toThrow('Chave privada inválida')
    expect(create).not.toHaveBeenCalled()
  })
})
