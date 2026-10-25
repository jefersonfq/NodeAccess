import { describe, expect, it } from 'vitest'
import { trialNameError, trialEmailError, trialPhoneError, formatTrialPhone } from './trial-registration'
describe('trial registration field contracts', () => {
  it.each(['José da Silva', 'Jose\u0301 da Silva', 'Ana O’Connor', 'João Luís', 'Anne-Marie Silva'])('accepts full Unicode name %s', value => expect(trialNameError(value)).toBe(''))
  it.each(['Ana', 'Jo da Silva', '123 Silva', 'Ana <Silva>', '李 王', 'A-b Silva', '-Ana Maria', 'Ana--Maria Silva', 'Ana Silva-'])('rejects incomplete/invalid name %s', value => expect(trialNameError(value)).not.toBe(''))
  it.each(['ana+teste@example.com', 'ana@xn--exemplo-9za.com.br'])('accepts email %s', value => expect(trialEmailError(value)).toBe(''))
  it.each(['ana@localhost', 'ana@example.c', 'ana@example.123', '.ana@example.com', 'ana..silva@example.com', 'ana @example.com'])('rejects email %s', value => expect(trialEmailError(value)).not.toBe(''))
  it.each(['', '(11) 3456-7890', '(21) 99999-1234', '+55 (21) 99999-1234', '+44 20 7946 0958'])('accepts phone %s', value => expect(trialPhoneError(value)).toBe(''))
  it.each(['(20) 99999-1234', '(11) 1999-1234', '(11) 89999-1234', '+55 20 99999-1234', '12345678', '11ABC999991234'])('rejects invalid BR phone %s', value => expect(trialPhoneError(value)).not.toBe(''))
  it('formats progressively without stripping invalid input or changing international input', () => {
    expect(['1', '11', '113', '1134567', '1134567890', '11999991234'].map(formatTrialPhone)).toEqual(['(1', '(11', '(11) 3', '(11) 3456-7', '(11) 3456-7890', '(11) 99999-1234'])
    for (const value of ['+44 20 7946 0958', '11a999991234', '119999912345']) expect(formatTrialPhone(value)).toBe(value)
  })
})
