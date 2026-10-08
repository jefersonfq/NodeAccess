import { promises as dns } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { BlockList, isIP } from 'node:net'

export class SsrfBlockedError extends Error {
  constructor(msg: string) { super(msg); this.name = 'SsrfBlockedError' }
}

const blocked = new BlockList()
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) blocked.addSubnet(ip, prefix, 'ipv4')
// BlockList also recognizes hexadecimal and expanded IPv4-mapped IPv6.
const publicV6 = new BlockList()
publicV6.addSubnet('2000::', 3, 'ipv6')
const mappedV4 = new BlockList()
mappedV4.addSubnet('::ffff:0:0', 96, 'ipv6')
for (const [ip, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  blocked.addSubnet(ip, prefix, 'ipv6')
}

export function assertPublicAddress(address: string): void {
  const family = isIP(address)
  if (!family || blocked.check(address, family === 4 ? 'ipv4' : 'ipv6') ||
      (family === 6 && !publicV6.check(address, 'ipv6') && !mappedV4.check(address, 'ipv6'))) {
    throw new SsrfBlockedError('Destino de webhook deve ser um endereço IP público')
  }
}

export function parsePublicHttpUrl(rawUrl: string): URL {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { throw new SsrfBlockedError('URL inválida') }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new SsrfBlockedError('Use HTTP(S) sem credenciais na URL')
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) assertPublicAddress(hostname)
  return parsed
}

async function publicAddresses(hostname: string): Promise<Array<{ address: string; family: number }>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const addresses = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SsrfBlockedError('Prazo de resolução DNS excedido')), 5_000) }),
    ])
    if (!addresses.length) throw new SsrfBlockedError('Hostname sem endereço')
    for (const item of addresses) assertPublicAddress(item.address)
    return addresses
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err
    throw new SsrfBlockedError('Não foi possível resolver o hostname')
  } finally { clearTimeout(timer) }
}

export async function assertNotSsrfUrl(rawUrl: string): Promise<void> {
  const hostname = parsePublicHttpUrl(rawUrl).hostname.replace(/^\[|\]$/g, '')
  if (!isIP(hostname)) await publicAddresses(hostname)
}

// The HTTP socket uses these exact validated addresses, without a second DNS lookup.
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  void publicAddresses(hostname).then(addresses => {
    const candidates = options.family ? addresses.filter(item => item.family === options.family) : addresses
    if (!candidates.length) throw new SsrfBlockedError('Hostname sem endereço na família solicitada')
    if (options.all) callback(null, candidates)
    else callback(null, candidates[0]!.address, candidates[0]!.family)
  }).catch((err: Error) => callback(err, '', 0))
}
