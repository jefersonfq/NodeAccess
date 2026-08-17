export const LOCAL_AI_READ_TOOLS = [
  'platform_snapshot',
  'search_hosts',
  'list_recent_sessions',
  'search_session_audits',
  'search_knowledge_base',
  'get_host_summary',
  'get_session_summary',
  'get_ticket_audit_summary',
  'get_group_summary',
  'get_bastion_summary',
  'get_session_audit_summary',
] as const

export type LocalAiReadToolKey = typeof LOCAL_AI_READ_TOOLS[number]

export interface LocalAiToolExecution {
  key: LocalAiReadToolKey
  status: 'executed' | 'failed'
  durationMs: number
}

export function selectLocalAiReadTools(message: string, explicit: {
  hostId: boolean
  sessionId: boolean
  ticketKey: boolean
  groupName: boolean
  bastionName: boolean
}): Set<LocalAiReadToolKey> {
  const normalized = message.toLocaleLowerCase('pt-BR')
  const selected = new Set<LocalAiReadToolKey>(['platform_snapshot'])

  if (/\b(host|hosts|servidor|servidores|ip|conex[aã]o)\b/i.test(normalized)) selected.add('search_hosts')
  if (/\b(sess[aã]o|sess[oõ]es|acesso|acessos|recente|recentes)\b/i.test(normalized)) selected.add('list_recent_sessions')
  if (/\b(auditoria|auditorias|risco|ticket|chamado|sess[aã]o)\b/i.test(normalized)) selected.add('search_session_audits')
  if (/\b(documento|documenta[cç][aã]o|base de conhecimento|procedimento|manual|como configurar)\b/i.test(normalized)) selected.add('search_knowledge_base')
  if (explicit.hostId) selected.add('get_host_summary')
  if (explicit.sessionId) {
    selected.add('get_session_summary')
    selected.add('get_session_audit_summary')
  }
  if (explicit.ticketKey) selected.add('get_ticket_audit_summary')
  if (explicit.groupName) selected.add('get_group_summary')
  if (explicit.bastionName) selected.add('get_bastion_summary')
  return selected
}

