import { describe, expect, it } from 'vitest'
import { isGuidedTrial, trialExpiryNotice } from './trial-experience'
describe('explicit full trial capabilities and expiry', () => {
  it('preserves old profiles and only enables full on explicit value', () => {
    expect(isGuidedTrial(undefined)).toBe(false)
    expect(isGuidedTrial(null)).toBe(false)
    expect(isGuidedTrial({ resources: ['ssh'] })).toBe(true)
    expect(isGuidedTrial({ experience: 'guided', resources: ['ssh'] })).toBe(true)
    expect(isGuidedTrial({ experience: 'full', resources: ['ssh'] })).toBe(false)
  })
  it('highlights only inside the configured expiry window, without rounding away expiration', () => {
    const now = Date.parse('2026-10-25T00:00:00Z')
    const trial = { resources: ['ssh'], expiresAt: '2026-10-26T00:00:00Z' }
    expect(trialExpiryNotice(trial, now - 1)).toBeNull()
    expect(trialExpiryNotice(trial, now)).toBe('Teste termina em até 24 h')
    expect(trialExpiryNotice({ ...trial, expiryNoticeHours: 6 }, now)).toBeNull()
    expect(trialExpiryNotice(trial, now + 24 * 3600000)).toBe('Período de teste encerrado')
    expect(trialExpiryNotice({ ...trial, expiresAt: 'invalid' }, now)).toBeNull()
  })
})
