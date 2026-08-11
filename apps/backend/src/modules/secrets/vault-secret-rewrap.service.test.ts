import { describe, expect, it, vi } from 'vitest'
import { VaultSecretRewrapService } from './vault-secret-rewrap.service.js'

const primary = { encrypted: 'primary', iv: 'iv-primary' }
const previous = { encrypted: 'previous', iv: 'iv-previous' }
const replacement = { encrypted: 'replacement', iv: 'iv-replacement' }

function harness(updateCount = 1) {
  const repository = {
    listAfter: vi.fn(async (cursor: number) => cursor === 0
      ? [{ id: 1, payload: primary }, { id: 2, payload: previous }]
      : []),
    updateBatch: vi.fn().mockResolvedValue(updateCount),
  }
  const crypto = {
    inspect: vi.fn((payload) => ({ keyOrigin: payload === primary ? 'primary' : 'previous', previousKeyPosition: payload === primary ? null : 1 })),
    rewrap: vi.fn((payload) => payload === primary
      ? { keyOrigin: 'primary', previousKeyPosition: null, payload, wouldChange: false, changed: false }
      : { keyOrigin: 'previous', previousKeyPosition: 1, payload: replacement, wouldChange: true, changed: true }),
  }
  return { repository, crypto, service: new VaultSecretRewrapService(repository, crypto, 100) }
}

describe('VaultSecretRewrapService', () => {
  it('is read-only by default and returns only aggregate counts', async () => {
    const { service, repository } = harness()
    await expect(service.dryRun()).resolves.toEqual({ mode: 'dry-run', total: 2, primary: 1, previous: 1, invalid: 0, changed: 0 })
    expect(repository.updateBatch).not.toHaveBeenCalled()
  })

  it('requires the expected legacy count before applying', async () => {
    const { service, repository } = harness()
    await expect(service.apply(2)).rejects.toThrow('esperado 2, encontrado 1')
    expect(repository.updateBatch).not.toHaveBeenCalled()
  })

  it('updates only legacy payloads after a matching pre-scan', async () => {
    const { service, repository } = harness()
    await expect(service.apply(1)).resolves.toEqual({ mode: 'apply', total: 2, primary: 1, previous: 1, invalid: 0, changed: 1 })
    expect(repository.updateBatch).toHaveBeenCalledWith([{ id: 2, expected: previous, replacement }])
  })

  it('stops when optimistic comparison detects concurrent changes', async () => {
    const { service } = harness(0)
    await expect(service.apply(1)).rejects.toThrow('dados alterados concorrentemente')
  })

  it('blocks apply when any payload is invalid', async () => {
    const { service, crypto, repository } = harness()
    crypto.inspect.mockImplementationOnce(() => { throw new Error('invalid') })
    await expect(service.apply(1)).rejects.toThrow('existem payloads inválidos')
    expect(repository.updateBatch).not.toHaveBeenCalled()
  })
})
