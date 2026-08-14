import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})
import { decrypt, encrypt } from '../../shared/crypto.js'
import { SshSession } from '../ssh/ssh.session.js'
import { PemKeyService } from './pem-key.service.js'
import type { PemKeyRepository } from './pem-key.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

const TEST_PASSPHRASE = 'chave-segura-123'

function encryptedPrivateKey() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: TEST_PASSPHRASE,
  }).toString()
}

function setup() {
  let stored: Record<string, unknown> | null = null
  const repository = {
    create: vi.fn(async (data) => {
      stored = data
      return { id: 7, createdAt: new Date(), ...data }
    }),
    findById: vi.fn(),
    updatePassphrase: vi.fn(),
  } as unknown as PemKeyRepository
  const logs = { logAdminEvent: vi.fn(async () => undefined) } as unknown as LogRepository
  return { service: new PemKeyService(repository, logs), repository, getStored: () => stored }
}

describe('PemKeyService passphrase', () => {
  it('recusa chave criptografada sem passphrase', async () => {
    const { service } = setup()
    await expect(service.create({ name: 'encrypted', key: encryptedPrivateKey() }, 1))
      .rejects.toThrow('Informe a senha da chave')
  })

  it('valida e cifra a passphrase separadamente da chave', async () => {
    const { service, getStored } = setup()
    const result = await service.create({
      name: 'encrypted',
      key: encryptedPrivateKey(),
      passphrase: TEST_PASSPHRASE,
    }, 1)

    const stored = getStored() as { encryptedPassphrase: string; passphraseIv: string }
    expect(result.hasPassphrase).toBe(true)
    expect(stored.encryptedPassphrase).not.toContain(TEST_PASSPHRASE)
    expect(decrypt({ encrypted: stored.encryptedPassphrase, iv: stored.passphraseIv })).toBe(TEST_PASSPHRASE)
  })

  it('entrega a passphrase decifrada ao ssh2 sem expô-la no contrato público', () => {
    const key = encrypt(encryptedPrivateKey())
    const passphrase = encrypt(TEST_PASSPHRASE)
    const session = new SshSession({ send: vi.fn() }, {
      host: '127.0.0.1', port: 22, username: 'test', authType: 'PEM',
      pemKey: {
        encryptedKey: key.encrypted,
        iv: key.iv,
        encryptedPassphrase: passphrase.encrypted,
        passphraseIv: passphrase.iv,
      },
    })

    const config = (session as unknown as { buildConnectConfig: (credentials: unknown) => { passphrase?: string } })
      .buildConnectConfig((session as unknown as { target: unknown }).target)
    expect(config.passphrase).toBe(TEST_PASSPHRASE)
    session.dispose()
  })
})
