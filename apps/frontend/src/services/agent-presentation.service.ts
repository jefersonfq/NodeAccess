import type { AgentInfo, AgentMode, AgentType } from './agent.service'

export type AgentOperationalState = 'online' | 'attention' | 'offline' | 'revoked'

export const agentPurposeCatalog: Record<`${AgentType}:${AgentMode}`, { label: string; description: string; useCase: string }> = {
  'PROXY_AGENT:USER_BOUND': { label: 'Agente pessoal', description: 'Usa a rede e a VPN do próprio usuário.', useCase: 'Acessar um ambiente disponível somente na estação do operador.' },
  'PROXY_AGENT:SERVICE_BOUND': { label: 'Agente compartilhado', description: 'Oferece uma rota permanente para o tenant.', useCase: 'Manter uma máquina ou servidor sempre disponível para a equipe.' },
  'PRIVATE_ACCESS_CONNECTOR:SERVICE_BOUND': { label: 'Conector de rede privada', description: 'Publica somente redes e portas explicitamente autorizadas.', useCase: 'Alcançar VPCs, filiais e datacenters sem expor SSH na internet.' },
  'PRIVATE_ACCESS_CONNECTOR:USER_BOUND': { label: 'Conector de rede privada', description: 'Conectores privados operam como serviço compartilhado.', useCase: 'Alcançar uma rede privada com escopo restrito.' },
}

export function agentPurpose(agent: Pick<AgentInfo, 'agentType' | 'agentMode'>) {
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
