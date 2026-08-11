import { describe, expect, it, vi } from 'vitest'
import { EncryptionInventoryService, parseEncryptedJson } from './encryption-inventory.service.js'

describe('EncryptionInventoryService', () => {
  it('returns aggregate counts without identifiers or plaintext', async () => {
    const inspector = { inspect: vi.fn()
      .mockReturnValueOnce({ keyOrigin: 'primary', previousKeyPosition: null })
      .mockReturnValueOnce({ keyOrigin: 'previous', previousKeyPosition: 1 })
      .mockImplementationOnce(() => { throw new Error('invalid') }) }
    const service = new EncryptionInventoryService([{
      domain: 'secrets.value',
      load: vi.fn().mockResolvedValue([
        { encrypted: 'one', iv: 'iv-one' }, { encrypted: 'two', iv: 'iv-two' },
        { encrypted: 'bad', iv: 'bad' }, null,
      ]),
    }], inspector)

    await expect(service.inspect()).resolves.toEqual({
      totals: { domain: 'total', total: 3, primary: 1, previous: 1, invalid: 1 },
      domains: [{ domain: 'secrets.value', total: 3, primary: 1, previous: 1, invalid: 1 }],
    })
  })

  it('marks malformed JSON as invalid without returning its contents', () => {
    expect(parseEncryptedJson('{not-json')).toEqual({ encrypted: '', iv: '' })
    expect(parseEncryptedJson(null)).toBeNull()
  })
})
