import { describe, expect, it, vi } from 'vitest'
import { encrypt } from '../../shared/crypto.js'
import { OnePasswordService } from './onepassword.service.js'

describe('OnePasswordService secret references', () => {
  it('resolves an active tenant Secret without calling the 1Password integration', async () => {
    const encrypted = encrypt('imported-password')
    const integrations = { findByProvider: vi.fn() }
    const secrets = {
      findByAlias: vi.fn(async () => ({ ...encrypted, encryptedValue: encrypted.encrypted, revokedAt: null })),
    }
    const service = new OnePasswordService(integrations as never, secrets as never)

    await expect(service.resolve(7, 'secret://guacamole.linux.abc')).resolves.toBe('imported-password')
    expect(secrets.findByAlias).toHaveBeenCalledWith(7, 'guacamole.linux.abc')
    expect(integrations.findByProvider).not.toHaveBeenCalled()
  })

  it('rejects revoked Secrets', async () => {
    const service = new OnePasswordService({} as never, {
      findByAlias: vi.fn(async () => ({ revokedAt: new Date() })),
    } as never)

    await expect(service.resolve(7, 'secret://guacamole.revoked.abc')).rejects.toThrow('revogado')
  })
})
