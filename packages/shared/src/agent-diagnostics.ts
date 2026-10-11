import catalog from './data/agent-diagnostics.json' with { type: 'json' }
export const agentDiagnosticCatalog = catalog
export type AgentDiagnosticCode = keyof typeof catalog
export function agentDiagnostic(code: string | null | undefined) {
  return catalog[code as AgentDiagnosticCode] ?? catalog.CONNECTION_LOST
}
export function agentDisconnectCode(reason: string, closeCode?: number): AgentDiagnosticCode {
  if (Object.hasOwn(catalog, reason)) return reason as AgentDiagnosticCode
  if (/heartbeat timeout/i.test(reason)) return 'HEARTBEAT_TIMEOUT'
  if (/authorization unavailable/i.test(reason)) return 'AUTH_UNAVAILABLE'
  if (/registration replaced|substituído/i.test(reason)) return 'REGISTRATION_REPLACED'
  if (/authorization revoked|agent revoked/i.test(reason)) return 'AUTH_REVOKED'
  if (/bookkeeping unavailable/i.test(reason)) return 'BOOKKEEPING_UNAVAILABLE'
  if (/budget exceeded|buffer limit/i.test(reason)) return 'LIMIT_EXCEEDED'
  if (/SIGTERM|SIGINT/.test(reason) || closeCode === 1000) return 'STOPPED'
  if (closeCode === 1008) return 'AUTH_REVOKED'
  return 'CONNECTION_LOST'
}
