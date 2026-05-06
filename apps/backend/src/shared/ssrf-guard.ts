import { promises as dns } from 'node:dns'
import { isIPv4 } from 'node:net'

export class SsrfBlockedError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'SsrfBlockedError'
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = parts as [number, number, ...number[]]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 240
  )
}

function isPrivateIPv6(ip: string): boolean {
  const norm = ip.toLowerCase()
  const v4Mapped = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]!)
  return (
    norm === '::1' ||
    norm === '::' ||
    /^fe[89ab]/i.test(norm) ||
    /^f[cd]/i.test(norm)
  )
}

export async function assertNotSsrfUrl(rawUrl: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('URL inválida')
  }

  const bare = parsed.hostname.replace(/^\[|\]$/g, '')

  if (isIPv4(bare)) {
    if (isPrivateIPv4(bare)) throw new SsrfBlockedError(`Endereço privado não permitido: ${bare}`)
    return
  }

  if (parsed.hostname.startsWith('[')) {
    if (isPrivateIPv6(bare)) throw new SsrfBlockedError(`Endereço IPv6 privado não permitido: ${bare}`)
    return
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await dns.lookup(bare, { all: true })
  } catch {
    throw new SsrfBlockedError(`Não foi possível resolver o hostname: ${bare}`)
  }

  if (addresses.length === 0) throw new SsrfBlockedError(`Hostname não resolve: ${bare}`)

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) throw new SsrfBlockedError(`${bare} resolve para endereço privado: ${address}`)
    if (family === 6 && isPrivateIPv6(address)) throw new SsrfBlockedError(`${bare} resolve para endereço IPv6 privado: ${address}`)
  }
}
