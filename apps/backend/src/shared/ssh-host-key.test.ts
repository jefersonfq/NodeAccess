import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createHostKeyVerifier } from './ssh-host-key.js'

describe.each(['target', 'bastion'] as const)('%s SSH identity', step => {
  const key = Buffer.from('synthetic-public-host-key')
  const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`
  it.each([undefined, null, '', 'SHA256:other'])('fails closed for trust=%s', trust => {
    const result = vi.fn()
    expect(createHostKeyVerifier(trust, step, result)(key)).toBe(false)
    expect(result).toHaveBeenCalledWith(expect.objectContaining({ step, reason: trust ? 'changed' : 'unknown', presentedFingerprint: fingerprint, trustedFingerprint: trust || null }))
  })
  it('accepts exact identity and detects replacement without retaining stale error', () => {
    const result = vi.fn(), verify = createHostKeyVerifier(fingerprint, step, result)
    expect(verify(Buffer.from('replaced-key'))).toBe(false)
    expect(verify(key)).toBe(true)
    expect(result).toHaveBeenLastCalledWith(null)
  })
})
