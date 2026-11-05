/** Deployment acknowledgement only: this cannot verify network protection. */
export function assertTacacsActivation(environment: Record<string, string | undefined>): void {
  if (environment.NODEACCESS_TACACS_ENABLE !== 'true') {
    throw new Error('Set NODEACCESS_TACACS_ENABLE=true explicitly to start the optional TACACS+ service')
  }
  if (environment.NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED !== 'true') {
    throw new Error('Legacy TACACS+ uses weak MD5 obfuscation without secure transport. Protect the network path and explicitly set NODEACCESS_TACACS_LEGACY_RISK_ACKNOWLEDGED=true. This acknowledgement does not verify protection or resolve the MD5 risk. See docs/guides/network-access-tacacs.md')
  }
}
