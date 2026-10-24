import { describe, expect, it } from 'vitest'
import { authAccessOrigin } from './auth-access-origin'

describe('legacy authentication access origin', () => {
  it.each([null, undefined, '', '   ', 'curl/8.0', 'python-requests/2.31', 'Mozilla/5.0',
    'fake-native-ssh-gateway', 'native-ssh-gateway-other', 'Native-SSH-Gateway',
    'Mozilla/5.0 (compatible; Googlebot/2.1) Chrome/120.0',
    'Mozilla/5.0 HeadlessChrome/120.0', '<script>alert(1)</script>'])('keeps ambiguous agent %s unidentified', agent => {
    expect(authAccessOrigin(agent)).toBe('unknown')
  })
  it.each(['native-ssh-gateway', ' native-ssh-gateway '])('recognizes exact gateway marker %s', agent => {
    expect(authAccessOrigin(agent)).toBe('gateway')
  })
  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
  ])('recognizes browser evidence %s', agent => {
    expect(authAccessOrigin(agent)).toBe('web')
  })
})
