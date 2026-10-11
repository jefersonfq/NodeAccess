import { agentDiagnostic, agentDisconnectCode } from '@nodeaccess/shared'
import type { AgentInfo, AgentMode, AgentType } from './agent.service'

export type AgentOperationalState = 'online' | 'attention' | 'offline' | 'revoked'

export const agentPurposeCatalog: Record<`${AgentType}:${AgentMode}`, { label: string; description: string; useCase: string }> = {
  'PROXY_AGENT:USER_BOUND': { label: 'Agente pessoal', description: 'Usa a rede e a VPN do próprio usuário.', useCase: 'Acessar um ambiente disponível somente na estação do operador.' },
  'PROXY_AGENT:SERVICE_BOUND': { label: 'Agente compartilhado', description: 'Oferece uma rota permanente para o tenant.', useCase: 'Manter uma máquina ou servidor sempre disponível para a equipe.' },
  'PRIVATE_ACCESS_CONNECTOR:SERVICE_BOUND': { label: 'Conector de rede privada', description: 'Publica somente redes e portas explicitamente autorizadas.', useCase: 'Alcançar VPCs, filiais e datacenters sem expor SSH na internet.' },
  'PRIVATE_ACCESS_CONNECTOR:USER_BOUND': { label: 'Conector de rede privada', description: 'Conectores privados operam como serviço compartilhado.', useCase: 'Alcançar uma rede privada com escopo restrito.' },
}

export function agentPurpose(agent: Pick<AgentInfo, 'agentType' | 'agentMode'>): { label: string; description: string; useCase: string; } {
  return agentPurposeCatalog[`${agent.agentType}:${agent.agentMode}`]
}

export function agentOperationalState(agent: Pick<AgentInfo, 'online' | 'revokedAt' | 'tlsMode' | 'heartbeatAgeMs' | 'versionStatus' | 'maintenanceMode'>): AgentOperationalState {
  if (agent.revokedAt) return 'revoked'
  if (!agent.online) return 'offline'
  if (agent.maintenanceMode) return 'attention'
  if (agent.tlsMode === 'insecure' || agent.versionStatus === 'outdated' || (agent.heartbeatAgeMs !== null && agent.heartbeatAgeMs !== undefined && agent.heartbeatAgeMs > 60_000)) return 'attention'
  return 'online'
}

export function agentAttentionReason(agent: Pick<AgentInfo, 'tlsMode' | 'heartbeatAgeMs' | 'versionStatus' | 'minimumSupportedVersion' | 'maintenanceMode'>): string | null {
  if (agent.maintenanceMode) return 'Em manutenção: novas sessões não serão encaminhadas para este agente.'
  if (agent.tlsMode === 'insecure') return 'TLS sem validação: reinstale sem --insecure.'
  if (agent.versionStatus === 'outdated') return `Versão desatualizada: atualize para ${agent.minimumSupportedVersion ?? 'a versão atual'} ou superior.`
  if (agent.heartbeatAgeMs !== null && agent.heartbeatAgeMs !== undefined && agent.heartbeatAgeMs > 60_000) return 'Heartbeat atrasado: verifique rede, proxy ou firewall.'
  return null
}

export function agentConnectionDiagnostic(agent: Pick<AgentInfo, 'online' | 'revokedAt' | 'lastOfflineReason' | 'lastDisconnectReason' | 'lastOfflineAt' | 'lastDisconnectedAt'>): { code: null; message: string; action: string; } | { stage: string; message: string; action: string; code: "HEARTBEAT_TIMEOUT" | "REGISTRATION_TIMEOUT" | "AUTH_REVOKED" | "AUTH_UNAVAILABLE" | "REGISTRATION_REPLACED" | "DNS_FAILED" | "TLS_FAILED" | "CONNECTION_REFUSED" | "HTTP_ERROR" | "CONNECT_TIMEOUT" | "CONNECTION_LOST" | "STOPPED" | "LIMIT_EXCEEDED" | "BOOKKEEPING_UNAVAILABLE" | "TCP_TIMEOUT" | "TCP_REFUSED" | "TARGET_DNS_FAILED" | "TARGET_UNREACHABLE" | "TARGET_ERROR" | "LOCAL_POLICY_DENIED" | "CONNECTED"; } | null {
  if (agent.online && !agent.revokedAt) return null
  const reason = agent.revokedAt ? 'AUTH_REVOKED' :
    (agent.lastOfflineReason && (!agent.lastDisconnectedAt || Date.parse(agent.lastOfflineAt ?? '') >= Date.parse(agent.lastDisconnectedAt))
      ? agent.lastOfflineReason : agent.lastDisconnectReason ?? agent.lastOfflineReason)
  if (!reason) return { code: null, message: 'Nenhuma conexão do agente foi confirmada.', action: 'Abra o agente na máquina de origem e confira o servidor e a credencial.' }
  const code = agentDisconnectCode(reason)
  return { code, ...agentDiagnostic(code) }
}

export function agentHistoryDiagnostic(event: { action: string; details?: string | null }): { label: string; reference: string | null; reportedAt: string | null; } {
  try {
    const parsed: unknown = JSON.parse(event.details ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { label: event.action, reference: null, reportedAt: null }
    const details = parsed as Record<string, unknown>
    const code = typeof details.code === 'string' ? details.code : typeof details.reason === 'string' ? agentDisconnectCode(details.reason) : null
    return { label: code ? agentDiagnostic(code).message : event.action === 'agent_connected' ? 'Agente conectado.' : event.action,
      reference: typeof details.attemptId === 'string' ? details.attemptId : typeof details.connectionId === 'string' ? details.connectionId : null,
      reportedAt: details.source === 'agent' && typeof details.reportedAt === 'string' ? details.reportedAt : null }
  } catch { return { label: event.action, reference: null, reportedAt: null } }
}
