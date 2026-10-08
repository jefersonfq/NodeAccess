import { isIP } from 'node:net'
import { checkServerIdentity, type ConnectionOptions } from 'node:tls'

/** The socket is loopback, but TLS must authenticate the original tunneled server. */
export function tunnelTlsOptions(remoteHost: string): ConnectionOptions {
  return {
    rejectUnauthorized: true,
    ...(isIP(remoteHost) ? {} : { servername: remoteHost }),
    checkServerIdentity: (_socketHost, certificate) => checkServerIdentity(remoteHost, certificate),
  }
}
