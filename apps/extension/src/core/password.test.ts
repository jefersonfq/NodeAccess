import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePassword } from './password'
afterEach(() => vi.restoreAllMocks())
describe('configurable unbiased password generator', () => {
  it('keeps the legacy 24-character API', () => { expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{24}$/) })
  it('supports bounds and guarantees every selected class', () => {
    for (const length of [8, 24, 128]) {
      const password = generatePassword({ length })
      expect(password).toHaveLength(length)
      expect(password).toMatch(/[A-Z]/); expect(password).toMatch(/[a-z]/); expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[^A-Za-z0-9]/)
    }
  })
  it('rejects biased tail bytes before mapping to the chosen alphabet', () => {
    const rng = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      const bytes = array as Uint8Array
      bytes.fill(255); bytes.set([250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7])
      return array
    })
    expect(generatePassword({ length: 8, uppercase: false, lowercase: false, digits: true, symbols: false })).toBe('01234567')
    expect(rng).toHaveBeenCalledOnce()
  })
  it('never returns a candidate missing a selected class', () => {
    let calls = 0
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      const bytes = array as Uint8Array; bytes.fill(0)
      if (calls++ > 0) bytes.set([0, 26, 52, 62])
      return array
    })
    const password = generatePassword({ length: 8 })
    expect(password).toMatch(/[A-Z]/); expect(password).toMatch(/[a-z]/); expect(password).toMatch(/[0-9]/); expect(password).toMatch(/[^A-Za-z0-9]/)
    expect(calls).toBe(2)
  })
  it('fails closed if the entropy provider only produces unusable bytes or misses classes', () => {
    const rng = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => { (array as Uint8Array).fill(255); return array })
    expect(() => generatePassword({ length: 8, uppercase: false, lowercase: false, digits: true, symbols: false })).toThrow('Password generation unavailable')
    rng.mockImplementation(array => { (array as Uint8Array).fill(0); return array })
    expect(() => generatePassword({ length: 8 })).toThrow('Password generation unavailable')
  })
  it('supports only selected classes and refuses invalid settings', () => {
    expect(generatePassword({ length: 16, uppercase: false, lowercase: true, digits: false, symbols: false })).toMatch(/^[a-z]{16}$/)
    for (const length of [0, 7, 129, 8.5, NaN, Infinity]) expect(() => generatePassword({ length })).toThrow('Invalid password length')
    expect(() => generatePassword({ uppercase: false, lowercase: false, digits: false, symbols: false })).toThrow('Select a character class')
  })
})
