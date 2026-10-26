import { describe, expect, it } from 'vitest'
import { isOnePasswordVendorHost, validateTrialOnePasswordToken } from './trial-onepassword.js'
function token(signInAddress: string): string { return `ops_${Buffer.from(JSON.stringify({ signInAddress })).toString('base64url')}` }
describe('trial SDK fixed vendor boundary', () => {
  it.each(['my.1password.com', 'team.1password.eu', 'tenant.1password.ca'])('accepts vendor hostname %s', host => {
    expect(isOnePasswordVendorHost(host)).toBe(true)
    expect(() => validateTrialOnePasswordToken(token(host))).not.toThrow()
  })
  it.each(['127.0.0.1', '169.254.169.254', '1password.com.attacker.test', 'https://my.1password.com', 'my.1password.com:443', 'my.1password.com/path', 'user@my.1password.com', 'my.1password.com.', 'my..1password.com'])('rejects token destination %s', host => {
    expect(() => validateTrialOnePasswordToken(token(host))).toThrow()
  })
  it('rejects malformed and oversized tokens without invoking SDK', () => {
    expect(() => validateTrialOnePasswordToken('ops_invalid')).toThrow()
    expect(() => validateTrialOnePasswordToken('ops_' + 'a'.repeat(65536))).toThrow()
  })
})
