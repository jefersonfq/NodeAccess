import { describe, expect, it } from 'vitest'
import { registrationSchema } from './trial-contract.js'

const registration = { name: 'Synthetic visitor', email: 'fixture@example.test', termsAccepted: true, privacyVersion: 'fixture' }
describe('optional trial contact phone', () => {
  it.each([undefined, '', '   '])('treats %j as absent without opting into marketing', phone => {
    expect(registrationSchema.parse({ ...registration, phone })).toMatchObject({ phone: undefined, marketingConsent: false, researchConsent: false })
  })
  it.each([
    ['+1 (202) 555-0123', '+12025550123'], ['(202) 555-0123', '2025550123'],
    ['  +12025550123  ', '+12025550123'], ['12345678', '12345678'], ['+123456789012345', '+123456789012345'],
  ])('normalizes %s without inventing a country', (phone, expected) => {
    expect(registrationSchema.parse({ ...registration, phone }).phone).toBe(expected)
  })
  it.each(['1234567', '+1234567890123456', '+012345678', '+1 202 555 0123 ext 1', '+1.202.555.0123', '++12025550123', '202/555/0123', 'a'.repeat(41), ' '.repeat(41), 12025550123, null])('rejects invalid phone %j', phone => {
    expect(registrationSchema.safeParse({ ...registration, phone }).success).toBe(false)
  })
  it('keeps an omitted field compatible with the previous request shape', () => {
    expect(registrationSchema.parse(registration)).not.toHaveProperty('phone')
  })
})
