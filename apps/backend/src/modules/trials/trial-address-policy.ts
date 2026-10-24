import { isIPv4 } from 'node:net'
import { AppError, ValidationError } from '../../shared/errors.js'

const numericIp = (ip: string): number => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0)
const restrictedRanges: [string, number][] = [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16], ['172.16.0.0',12],
  ['192.0.0.0',24], ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16], ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',3],
]
/** Literal public IPv4 only: no DNS lookup, redirects, integer/hex/IPv6 aliases or rebinding. */
export function validateTrialCustomAddress(ip: string, protectedAddresses: readonly string[] = []): void {
  if (!isIPv4(ip) || ip.split('.').some(part => String(Number(part)) !== part)) throw new ValidationError('Informe um endereço IPv4 público literal.')
  const value = numericIp(ip)
  if (restrictedRanges.some(([base,bits]) => Math.floor(value / 2 ** (32-bits)) === Math.floor(numericIp(base) / 2 ** (32-bits))) || protectedAddresses.includes(ip)) {
    throw new AppError('Este destino não é permitido na degustação.', 403, 'TRIAL_DESTINATION_BLOCKED')
  }
}
