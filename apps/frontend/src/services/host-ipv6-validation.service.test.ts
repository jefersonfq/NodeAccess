import { describe, expect, it } from 'vitest'
import { isIP } from 'node:net'
import { validateIPv6Input } from './host-ipv6-validation.service'

describe('IPv6 host field input states', () => {
  it.each(['::', '::1', '2001:db8::1', '1:2:3:4:5:6:7:8', '::ffff:192.0.2.1', '1:2:3:4:5:6:192.0.2.1', '2001:db8::/0', '2001:db8::1/128', '::ffff:192.0.2.1/96'])('accepts complete valid address %s', input => {
    expect(isIP(input.split('/')[0])).toBe(6)
    expect(validateIPv6Input(input)).toEqual({ status: 'valid', message: null })
  })
  it.each(['', ':', '2001:', '2001:db8:', '1:2:3', '::ffff:192.', '::ffff:192.0.2.', '2001:db8::1/'])('marks typing state incomplete rather than valid: %s', input => {
    expect(validateIPv6Input(input)).toMatchObject({ status: 'incomplete', message: expect.any(String) as unknown })
  })
  it.each(['1::2::3', 'abcd::def::123', '2001:::1', ':1', '12345::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8:', '::ffff:999.1', '::ffff:01.2.3.4', '::ffff:192.0.2.1:2', '::1/129', '::1/-1', '::1/abc', '::1/64/2', 'fe80::1%eth0', '[::1]', '::1/path'])('rejects invalid structure %s', input => {
    expect(validateIPv6Input(input).status).toBe('invalid')
  })
})
