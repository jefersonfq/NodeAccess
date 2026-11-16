import { describe, expect, it } from 'vitest'
import { canManageVaultEntry, filterVaultEntries, pemEntries, secretEntries } from './vault-catalog'
import { secretFixture, pemFixture } from './vault-catalog.fixtures'
describe('Vault public catalogue', () => {
  it('keeps identities separate and strips fields outside public contracts', () => {
    const entries = [...secretEntries([{ ...secretFixture, value: 'private' }]), ...pemEntries([{ ...pemFixture, key: 'private' }])]
    expect(entries.map(e => e.key)).toEqual(['secret:1', 'pem:1'])
    expect(JSON.stringify(entries)).not.toContain('private')
    expect(entries[0].record.createdAt).toBeInstanceOf(Date)
    expect(() => secretEntries([{}])).toThrow()
    expect(() => pemEntries([{}])).toThrow()
  })
  it('retains existing ownership rules for each type', () => {
    const own = secretEntries([secretFixture])[0]
    const group = secretEntries([{ ...secretFixture, scope: 'GROUP', ownerUserId: null, groupId: 8 }])[0]
    const tenant = secretEntries([{ ...secretFixture, scope: 'TENANT', ownerUserId: null }])[0]
    const pem = pemEntries([pemFixture])[0]
    for (const entry of [own, group, pem]) {
      expect(canManageVaultEntry(entry, 41, false)).toBe(true)
      expect(canManageVaultEntry(entry, 42, false)).toBe(false)
      expect(canManageVaultEntry(entry, undefined, false)).toBe(false)
      expect(canManageVaultEntry(entry, 42, true)).toBe(true)
    }
    expect(canManageVaultEntry(tenant, 41, false)).toBe(false)
    expect(canManageVaultEntry(tenant, 42, true)).toBe(true)
  })
  it('searches public metadata and combines type filters without modifying the source', () => {
    const entries = [...pemEntries([pemFixture]), ...secretEntries([secretFixture])]
    expect(filterVaultEntries(entries, '', 'all').map(e => e.name)).toEqual(['database', 'gateway'])
    for (const query of [' DATA ', 'production', 'operator', 'personal']) expect(filterVaultEntries(entries, query, 'all')).toHaveLength(1)
    expect(filterVaultEntries(entries, 'production', 'pem')).toEqual([])
    expect(filterVaultEntries(entries, '', 'pem')).toHaveLength(1)
    expect(filterVaultEntries(entries, 'missing', 'all')).toEqual([])
    expect(entries[0].kind).toBe('pem')
  })
})
