export type PrivateImportConnectionMode = 'direct' | 'agent_tenant_fallback' | 'auto'

export function isPrivateNetworkAddress(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^\[|]$/g, '')
  if (host === 'localhost' || host === '::1') return true
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

export function importConnectionMode(
  address: string,
  privateMode: PrivateImportConnectionMode,
  hasBastion: boolean,
): PrivateImportConnectionMode {
  if (hasBastion || !isPrivateNetworkAddress(address)) return 'direct'
  return privateMode
}
