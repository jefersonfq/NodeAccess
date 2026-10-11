/** Bounded waits by operation cost. Callers can supply a deliberate timeout. */
export function apiRequestTimeout(url: string): number {
  if (/\/sftp\/|\/session-audit\/.*(?:export|reconstruct)|\/local-ai\/|\/diagnostic-playbooks\//.test(url)) return 300_000
  if (/\/integrations\/|\/hosts\/(?:import|test-connection)|\/platform\/tls\//.test(url)) return 120_000
  return 30_000
}
