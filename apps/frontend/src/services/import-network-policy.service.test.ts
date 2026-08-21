import { describe, expect, it } from 'vitest'
import { importConnectionMode, isPrivateNetworkAddress } from './import-network-policy.service'

describe('import network policy', () => {
  it.each(['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.20', '127.0.0.1', '169.254.1.2', 'localhost', 'fd00::1', 'fe80::1'])(
    'recognizes %s as private/local', address => expect(isPrivateNetworkAddress(address)).toBe(true),
  )
  it.each(['8.8.8.8', '172.32.0.1', '192.169.1.1', 'server.example.test'])(
    'does not infer %s as private', address => expect(isPrivateNetworkAddress(address)).toBe(false),
  )
  it('routes only private hosts without a bastion through the selected agent policy', () => {
    expect(importConnectionMode('10.0.0.1', 'agent_tenant_fallback', false)).toBe('agent_tenant_fallback')
    expect(importConnectionMode('10.0.0.1', 'agent_tenant_fallback', true)).toBe('direct')
    expect(importConnectionMode('public.example.test', 'agent_tenant_fallback', false)).toBe('direct')
  })
})
