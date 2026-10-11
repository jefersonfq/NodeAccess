import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as dns } from 'node:dns'
import { assertNotSsrfUrl, assertPublicAddress, publicLookup } from './ssrf-guard.js'

afterEach(() => vi.restoreAllMocks())
describe('public webhook destinations', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:0a00:0001', '2002:7f00:1::', '64:ff9b::7f00:1'])('blocks %s', address => {
    expect(() => assertPublicAddress(address)).toThrow()
  })
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:808:808'])('accepts public %s', address => {
    expect(() => assertPublicAddress(address)).not.toThrow()
  })
  it.each(['http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'ftp://8.8.8.8/', 'https://user:password@8.8.8.8/'])('rejects normalized or invalid URL %s', async url => {
    await expect(assertNotSsrfUrl(url)).rejects.toThrow()
  })
  it('rejects mixed public/private DNS answers', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '::1', family: 6 }] as never)
    await expect(assertNotSsrfUrl('https://receiver.example')).rejects.toThrow()
  })
  it('rechecks DNS at socket connection and rejects rebinding', async () => {
    const lookup = vi.spyOn(dns, 'lookup')
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never)
    await assertNotSsrfUrl('https://receiver.example')
    const error = await new Promise<Error | null>((resolve) => publicLookup('receiver.example', { all: true }, err => resolve(err)))
    expect(error?.name).toBe('SsrfBlockedError')
    expect(lookup).toHaveBeenCalledTimes(2)
  })
  it('passes only validated addresses to the socket without another resolution', async () => {
    const addresses = [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }]
    const lookup = vi.spyOn(dns, 'lookup').mockResolvedValue(addresses as never)
    const result = await new Promise((resolve, reject) => publicLookup('receiver.example', { all: true }, (err, records) => err ? reject(err) : resolve(records)))
    expect(result).toEqual(addresses)
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
