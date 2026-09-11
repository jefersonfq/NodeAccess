import { z } from 'zod'

export const DeviceProfileSchema = z.enum(['server_ssh', 'network_generic', 'cisco_ios', 'juniper_junos'])
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>
export const DEVICE_PROFILES = [
  { value: 'server_ssh', label: 'Servidor SSH', sftp: true, serverAutomation: true },
  { value: 'network_generic', label: 'Equipamento de rede (genérico)', sftp: false, serverAutomation: false },
  { value: 'cisco_ios', label: 'Cisco IOS / IOS XE (piloto)', sftp: false, serverAutomation: false },
  { value: 'juniper_junos', label: 'Juniper Junos (piloto)', sftp: false, serverAutomation: false },
] as const

// Unknown profiles fail closed. Only absent legacy values inherit server behavior.
export function deviceCapabilities(profile?: string | null) {
  return DEVICE_PROFILES.find(p => p.value === (profile ?? 'server_ssh'))
    ?? { value: profile, label: 'Perfil não suportado: atualize o NodeAccess', sftp: false, serverAutomation: false }
}

// Informational classification only. Enforcement belongs to the device AAA.
export function classifyNetworkCommand(profile: DeviceProfile, command: string): 'query' | 'configuration' | 'unknown' {
  if (/[\r\n;|&<>\x00-\x1f]/.test(command)) return 'unknown'
  const value = command.trim()
  if (profile === 'cisco_ios' || profile === 'juniper_junos') {
    if (/^show(?: |$)/.test(value)) return 'query'
    if (/^(?:configure|conf|set|delete|commit|rollback|write|copy|reload)(?: |$)/.test(value)) return 'configuration'
  }
  return 'unknown'
}
