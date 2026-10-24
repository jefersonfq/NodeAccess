import { describe, expect, it } from 'vitest'
import { validateTrialCustomAddress } from './trial-address-policy.js'
describe('trial custom destination literal IPv4 boundary', () => {
  for (const ip of ['8.8.8.8','1.1.1.1','45.33.32.156']) it(`permits public literal ${ip}`, () => expect(() => validateTrialCustomAddress(ip)).not.toThrow())
  for (const ip of ['localhost','example.com','localhost.example.com','2130706433','0x7f000001','127.1','127.0.0.1','127.255.255.255','0.0.0.0','0.1.2.3','10.1.1.1','100.64.0.1','100.127.255.254','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.9','192.0.2.1','192.88.99.1','192.168.1.1','198.18.0.1','198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','239.255.255.255','240.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8','8.8.8.08','8.8.8.8 ','8.8.8.8:22','8.8.8.8/32','https://8.8.8.8']) {
    it(`blocks reserved or ambiguous destination ${ip}`, () => expect(() => validateTrialCustomAddress(ip)).toThrow())
  }
  it('blocks public addresses belonging to the control plane', () => expect(() => validateTrialCustomAddress('8.8.8.8',['8.8.8.8'])).toThrow('não é permitido'))
})
