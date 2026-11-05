/** Optional daemon opt-in; TLS material is separately mandatory and validated before listen. */
export function assertTacacsActivation(environment: Record<string, string | undefined>): void {
  if (environment.NODEACCESS_TACACS_ENABLE !== 'true') {
    throw new Error('Set NODEACCESS_TACACS_ENABLE=true explicitly to start the optional TACACS+ service')
  }
}
