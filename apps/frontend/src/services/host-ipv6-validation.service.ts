export interface IPv6InputValidation {
  status: 'valid' | 'incomplete' | 'invalid'
  message: string | null
}

function canExtendAddress(address: string): boolean {
  if (address === '' || address === ':') return true
  if (address.startsWith(':') && !address.startsWith('::')) return false
  const compressed = address.includes('::')
  const groups = address.split(':')
  const populated = groups.filter(Boolean)
  const dotted = populated.findIndex(group => group.includes('.'))
  if (dotted >= 0) {
    if (dotted !== populated.length - 1 || address.endsWith(':')) return false
    const octets = populated[dotted].split('.')
    if (octets.length > 4 || octets.some((part, index) => part === '' ? index !== octets.length - 1 : !/^\d{1,3}$/.test(part) || Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return false
  }
  const hex = dotted >= 0 ? populated.slice(0, -1) : populated
  if (hex.some(group => !/^[\da-fA-F]{1,4}$/.test(group))) return false
  const occupied = hex.length + (dotted >= 0 ? 2 : 0)
  if (occupied > (compressed ? 7 : 8)) return false
  if (!compressed && occupied === 8 && address.endsWith(':')) return false
  return true
}

/** Browser-native IPv6 parsing for a complete address; typing prefixes remain explicitly incomplete. */
export function validateIPv6Input(input: string): IPv6InputValidation {
  const [address, mask, ...extra] = input.trim().split('/')
  const invalid = (message: string): IPv6InputValidation => ({ status: 'invalid', message })
  if (extra.length || address.length > 45 || address.includes(':::') || address.split('::').length > 2) return invalid('IPv6 inválido')
  if (!/^[\da-fA-F:.]*$/.test(address)) return invalid('IPv6 inválido — use um endereço IPv6 sem colchetes ou zona')
  if (mask !== undefined && mask !== '' && (!/^\d+$/.test(mask) || Number(mask) > 128)) return invalid('Máscara IPv6 inválida — deve ser 0–128')
  let complete = false
  try { complete = address.includes(':') && new URL(`http://[${address}]/`).hostname.startsWith('[') } catch { /* An incomplete address may still be a valid typing prefix. */ }
  if (complete && mask !== '') return { status: 'valid', message: null }
  if (!complete && !canExtendAddress(address)) return invalid('IPv6 inválido')
  return { status: 'incomplete', message: complete ? 'Informe a máscara IPv6 (0–128)' : 'IPv6 incompleto — continue digitando o endereço' }
}
