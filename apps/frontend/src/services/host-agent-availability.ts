import type { HostPublic } from '@nodeaccess/shared'
import type { AgentInfo, AgentStatusInfo } from './agent.service'

export type HostAgentAvailability = {
  state: 'direct' | 'checking' | 'user' | 'tenant' | 'connector' | 'fallback' | 'offline'
  blocksConnection: boolean
  name?: string
}

/** A mandatory route must be evaluated for this host, never the open edit form. */
export function hostAgentAvailability(
  host: Pick<HostPublic, 'connectionMode' | 'privateAccessConnectorId'>,
  status: AgentStatusInfo | null,
  agents: Pick<AgentInfo, 'id' | 'name' | 'online' | 'active' | 'revokedAt' | 'maintenanceMode'>[] = [],
): HostAgentAvailability {
  const mode = host.connectionMode ?? 'auto'
  if (mode === 'direct') return { state: 'direct', blocksConnection: false }
  if (mode === 'auto') {
    const agent = status?.userAgent ?? status?.tenantAgent
    return agent ? { state: status?.userAgent ? 'user' : 'tenant', blocksConnection: false, name: agent.name }
      : { state: 'fallback', blocksConnection: false }
  }
  if (status === null) return { state: 'checking', blocksConnection: true }
  if (mode === 'private_access_connector') {
    if (host.privateAccessConnectorId) {
      const selected = agents.find(agent => agent.id === host.privateAccessConnectorId)
      if (selected) return selected.online && selected.active && !selected.revokedAt && !selected.maintenanceMode
        ? { state: 'connector', blocksConnection: false, name: selected.name }
        : { state: 'offline', blocksConnection: true, name: selected.name }
      if (status.privateAccessConnector?.id !== host.privateAccessConnectorId) return { state: 'offline', blocksConnection: true }
    }
    return status.privateAccessConnector ? { state: 'connector', blocksConnection: false, name: status.privateAccessConnector.name }
      : { state: 'offline', blocksConnection: true }
  }
  const agent = status.userAgent ?? (mode === 'agent_user' ? null : status.tenantAgent)
  return agent ? { state: status.userAgent ? 'user' : 'tenant', blocksConnection: false, name: agent.name }
    : { state: 'offline', blocksConnection: true }
}
