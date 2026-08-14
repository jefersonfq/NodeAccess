import { describe, expect, it, vi } from 'vitest'
import { SshRepository } from './ssh.repository.js'

const host = {
  id: 5, tenantId: 7, name: 'private-db', ip: '10.0.1.5', port: 22,
  accessProtocol: 'SSH', sshUser: 'db', authType: 'PASSWORD', connectionMode: 'DIRECT',
  passwordEncrypted: 'target-secret', onePasswordRef: null, trustedHostKeyFingerprint: null,
  scope: 'GLOBAL', ownerId: null, groupId: null, pemKey: null,
  bastion: {
    id: 31, ip: 'snapshot.invalid', port: 2200, sshUser: 'old-user', authType: 'PASSWORD',
    passwordEncrypted: 'old-secret', pemKey: null,
  },
  group: null,
}

describe('SshRepository host-backed bastion credentials', () => {
  it('uses current source Host connection data instead of the compatibility snapshot', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ privateAccessConnectorId: null }])
      .mockResolvedValueOnce([{
        ip: '203.0.113.21', port: 22, sshUser: 'ubuntu', authType: 'PEM',
        passwordEncrypted: null, encryptedKey: 'cipher', iv: 'iv',
        encryptedPassphrase: 'pass-cipher', passphraseIv: 'pass-iv',
      }])
      .mockResolvedValueOnce([])
    const repository = new SshRepository({
      host: { findFirst: vi.fn().mockResolvedValue(host) },
      $queryRaw: query,
    } as never)

    const result = await repository.findHostWithCredentials(5, 7)
    expect(result?.bastion).toEqual({
      ip: '203.0.113.21', port: 22, sshUser: 'ubuntu', authType: 'PEM',
      passwordEncrypted: null,
      pemKey: { encryptedKey: 'cipher', iv: 'iv', encryptedPassphrase: 'pass-cipher', passphraseIv: 'pass-iv' },
    })
  })

  it('keeps the legacy bastion snapshot when there is no source Host', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ privateAccessConnectorId: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const repository = new SshRepository({
      host: { findFirst: vi.fn().mockResolvedValue(host) },
      $queryRaw: query,
    } as never)

    const result = await repository.findHostWithCredentials(5, 7)
    expect(result?.bastion).toMatchObject({ ip: 'snapshot.invalid', port: 2200, sshUser: 'old-user', passwordEncrypted: 'old-secret' })
  })
})
