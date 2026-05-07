export type McpCapabilityKind = 'resource' | 'tool' | 'prompt'
export type McpCapabilityRisk = 'low' | 'medium' | 'high'
export type McpCapabilityAccessMode = 'read_only' | 'approval_required' | 'autonomous'

export interface McpCapabilityDefinition {
  key: string
  kind: McpCapabilityKind
  title: string
  description: string
  module: 'hosts' | 'host_dashboard' | 'sessions' | 'session_audit' | 'diagnostics' | 'snippets' | 'ai_ssh_actions' | 'mcp_interactive_ssh'
  scope: 'tenant' | 'host' | 'session' | 'diagnostic' | 'snippet' | 'action'
  risk: McpCapabilityRisk
  accessMode: McpCapabilityAccessMode
}

export interface McpToolDefinition {
  key: string
  title: string
  description: string
  accessMode: McpCapabilityAccessMode
  risk: McpCapabilityRisk
  inputSchema: Record<string, unknown>
}

export interface McpResourceDefinition {
  key: string
  title: string
  description: string
  uriTemplate: string
  accessMode: McpCapabilityAccessMode
  risk: McpCapabilityRisk
}

export const MCP_CAPABILITIES: McpCapabilityDefinition[] = [
  {
    key: 'search_hosts',
    kind: 'tool',
    title: 'Buscar hosts',
    description: 'Busca hosts visiveis ao usuario dentro do tenant atual.',
    module: 'hosts',
    scope: 'tenant',
    risk: 'low',
    accessMode: 'read_only',
  },
  {
    key: 'get_host_dashboard',
    kind: 'resource',
    title: 'Dashboard do host',
    description: 'Retorna o dashboard consolidado de um host visivel ao usuario.',
    module: 'host_dashboard',
    scope: 'host',
    risk: 'low',
    accessMode: 'read_only',
  },
  {
    key: 'list_host_diagnostic_runs',
    kind: 'resource',
    title: 'Execucoes de diagnostico do host',
    description: 'Lista execucoes de diagnostico do host respeitando o escopo do usuario.',
    module: 'diagnostics',
    scope: 'host',
    risk: 'low',
    accessMode: 'read_only',
  },
  {
    key: 'get_diagnostic_run',
    kind: 'resource',
    title: 'Detalhe da execucao de diagnostico',
    description: 'Retorna detalhe completo de uma execucao de diagnostico visivel ao usuario.',
    module: 'diagnostics',
    scope: 'diagnostic',
    risk: 'medium',
    accessMode: 'read_only',
  },
  {
    key: 'search_snippets',
    kind: 'tool',
    title: 'Buscar snippets',
    description: 'Busca snippets acessiveis ao usuario dentro do tenant atual.',
    module: 'snippets',
    scope: 'snippet',
    risk: 'low',
    accessMode: 'read_only',
  },
  {
    key: 'list_host_action_runs',
    kind: 'resource',
    title: 'Execucoes de acoes por IA do host',
    description: 'Lista action runs vinculados a um host visivel ao usuario.',
    module: 'ai_ssh_actions',
    scope: 'host',
    risk: 'medium',
    accessMode: 'read_only',
  },
  {
    key: 'get_action_run',
    kind: 'resource',
    title: 'Detalhe de action run por IA',
    description: 'Retorna detalhe completo de um action run visivel ao usuario.',
    module: 'ai_ssh_actions',
    scope: 'action',
    risk: 'medium',
    accessMode: 'read_only',
  },
  {
    key: 'request_action_run',
    kind: 'tool',
    title: 'Solicitar action run por IA',
    description: 'Cria uma solicitacao governada de acao por IA para um host visivel ao usuario.',
    module: 'ai_ssh_actions',
    scope: 'action',
    risk: 'high',
    accessMode: 'approval_required',
  },
  {
    key: 'evaluate_action_command_policy',
    kind: 'tool',
    title: 'Avaliar policy de comando SSH por IA',
    description: 'Classifica um comando pela policy do tenant antes de solicitar um action run.',
    module: 'ai_ssh_actions',
    scope: 'action',
    risk: 'medium',
    accessMode: 'read_only',
  },
  {
    key: 'cancel_action_run',
    kind: 'tool',
    title: 'Cancelar action run por IA',
    description: 'Cancela um action run visivel ao usuario quando o escopo permitir.',
    module: 'ai_ssh_actions',
    scope: 'action',
    risk: 'medium',
    accessMode: 'approval_required',
  },
  {
    key: 'approve_action_run',
    kind: 'tool',
    title: 'Aprovar action run por IA',
    description: 'Aprova um action run pendente quando o ator MCP tiver escopo administrativo.',
    module: 'ai_ssh_actions',
    scope: 'action',
    risk: 'high',
    accessMode: 'approval_required',
  },
  {
    key: 'reject_action_run',
    kind: 'tool',
    title: 'Rejeitar action run por IA',
    description: 'Rejeita um action run pendente quando o ator MCP tiver escopo administrativo.',
    module: 'ai_ssh_actions',
    scope: 'action',
    risk: 'high',
    accessMode: 'approval_required',
  },
  {
    key: 'open_interactive_ssh_session',
    kind: 'tool',
    title: 'Abrir sessao SSH interativa MCP',
    description: 'Abre uma sessao SSH interativa governada para um host permitido ao token MCP.',
    module: 'mcp_interactive_ssh',
    scope: 'host',
    risk: 'high',
    accessMode: 'autonomous',
  },
  {
    key: 'write_interactive_ssh_session',
    kind: 'tool',
    title: 'Enviar input para sessao SSH interativa MCP',
    description: 'Envia bytes de entrada para uma sessao SSH interativa MCP ativa.',
    module: 'mcp_interactive_ssh',
    scope: 'session',
    risk: 'high',
    accessMode: 'autonomous',
  },
  {
    key: 'read_interactive_ssh_session',
    kind: 'tool',
    title: 'Ler output de sessao SSH interativa MCP',
    description: 'Le output acumulado de uma sessao SSH interativa MCP ativa.',
    module: 'mcp_interactive_ssh',
    scope: 'session',
    risk: 'high',
    accessMode: 'autonomous',
  },
  {
    key: 'resize_interactive_ssh_session',
    kind: 'tool',
    title: 'Redimensionar sessao SSH interativa MCP',
    description: 'Atualiza colunas e linhas de uma sessao SSH interativa MCP ativa.',
    module: 'mcp_interactive_ssh',
    scope: 'session',
    risk: 'high',
    accessMode: 'autonomous',
  },
  {
    key: 'close_interactive_ssh_session',
    kind: 'tool',
    title: 'Fechar sessao SSH interativa MCP',
    description: 'Fecha uma sessao SSH interativa MCP ativa.',
    module: 'mcp_interactive_ssh',
    scope: 'session',
    risk: 'high',
    accessMode: 'autonomous',
  },
  {
    key: 'summarize_diagnostic_run',
    kind: 'prompt',
    title: 'Resumir execucao de diagnostico',
    description: 'Prompt sugerido para resumir achados de uma execucao de diagnostico.',
    module: 'diagnostics',
    scope: 'diagnostic',
    risk: 'low',
    accessMode: 'read_only',
  },
] as const

export function getMcpCapability(key: string): McpCapabilityDefinition | null {
  return MCP_CAPABILITIES.find((item) => item.key === key) ?? null
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    key: 'search_hosts',
    title: 'Buscar hosts',
    description: 'Busca hosts visiveis ao usuario dentro do tenant atual.',
    accessMode: 'read_only',
    risk: 'low',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    key: 'search_snippets',
    title: 'Buscar snippets',
    description: 'Busca snippets acessiveis ao usuario no tenant atual.',
    accessMode: 'read_only',
    risk: 'low',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    key: 'request_action_run',
    title: 'Solicitar action run por IA',
    description: 'Cria uma solicitacao governada de acao por IA para um host.',
    accessMode: 'approval_required',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['hostId', 'mode', 'channel', 'summary', 'steps'],
      properties: {
        hostId: { type: 'integer', minimum: 1 },
        mode: {
          type: 'string',
          enum: ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access'],
        },
        channel: {
          type: 'string',
          enum: ['local_ai', 'mcp', 'integration', 'internal'],
        },
        summary: { type: 'string', minLength: 1, maxLength: 500 },
        approvalReason: { type: ['string', 'null'], maxLength: 500 },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 25,
          items: {
            type: 'object',
            required: ['id', 'label', 'command', 'timeoutSeconds'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 80 },
              label: { type: 'string', minLength: 1, maxLength: 160 },
              command: { type: 'string', minLength: 1, maxLength: 4000 },
              timeoutSeconds: { type: 'integer', minimum: 1, maximum: 900 },
            },
          },
        },
      },
    },
  },
  {
    key: 'evaluate_action_command_policy',
    title: 'Avaliar policy de comando SSH por IA',
    description: 'Classifica um comando como seguro, exige aprovacao ou bloqueado pela policy do tenant.',
    accessMode: 'read_only',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      anyOf: [
        { required: ['command'] },
        { required: ['steps'] },
      ],
      properties: {
        command: { type: 'string', minLength: 1, maxLength: 4000 },
        mode: {
          type: 'string',
          enum: ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access'],
        },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: 25,
          items: {
            type: 'object',
            required: ['id', 'command'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 80 },
              label: { type: 'string', maxLength: 160 },
              command: { type: 'string', minLength: 1, maxLength: 4000 },
            },
          },
        },
      },
    },
  },
  {
    key: 'cancel_action_run',
    title: 'Cancelar action run por IA',
    description: 'Cancela um action run por IA especifico.',
    accessMode: 'approval_required',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      required: ['runId'],
      properties: {
        runId: { type: 'integer', minimum: 1 },
      },
    },
  },
  {
    key: 'approve_action_run',
    title: 'Aprovar action run por IA',
    description: 'Aprova um action run por IA pendente.',
    accessMode: 'approval_required',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['runId'],
      properties: {
        runId: { type: 'integer', minimum: 1 },
        approvalReason: { type: ['string', 'null'], maxLength: 500 },
      },
    },
  },
  {
    key: 'reject_action_run',
    title: 'Rejeitar action run por IA',
    description: 'Rejeita um action run por IA pendente.',
    accessMode: 'approval_required',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['runId'],
      properties: {
        runId: { type: 'integer', minimum: 1 },
        approvalReason: { type: ['string', 'null'], maxLength: 500 },
      },
    },
  },
  {
    key: 'open_interactive_ssh_session',
    title: 'Abrir sessao SSH interativa MCP',
    description: 'Abre uma sessao SSH interativa de alto risco para um host permitido ao token MCP.',
    accessMode: 'autonomous',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['hostId', 'reason'],
      properties: {
        hostId: { type: 'integer', minimum: 1 },
        reason: { type: 'string', minLength: 8, maxLength: 500 },
        ttlSeconds: { type: 'integer', minimum: 60, maximum: 3600 },
        cols: { type: 'integer', minimum: 40, maximum: 240 },
        rows: { type: 'integer', minimum: 10, maximum: 80 },
      },
    },
  },
  {
    key: 'write_interactive_ssh_session',
    title: 'Enviar input para sessao SSH interativa MCP',
    description: 'Envia input para uma sessao SSH interativa MCP ativa.',
    accessMode: 'autonomous',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'data'],
      properties: {
        sessionId: { type: 'string', minLength: 1, maxLength: 120 },
        data: { type: 'string', minLength: 1, maxLength: 8000 },
      },
    },
  },
  {
    key: 'read_interactive_ssh_session',
    title: 'Ler output de sessao SSH interativa MCP',
    description: 'Le output acumulado de uma sessao SSH interativa MCP ativa.',
    accessMode: 'autonomous',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string', minLength: 1, maxLength: 120 },
        cursor: { type: 'integer', minimum: 0 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 64000 },
      },
    },
  },
  {
    key: 'resize_interactive_ssh_session',
    title: 'Redimensionar sessao SSH interativa MCP',
    description: 'Atualiza dimensoes de uma sessao SSH interativa MCP ativa.',
    accessMode: 'autonomous',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'cols', 'rows'],
      properties: {
        sessionId: { type: 'string', minLength: 1, maxLength: 120 },
        cols: { type: 'integer', minimum: 40, maximum: 240 },
        rows: { type: 'integer', minimum: 10, maximum: 80 },
      },
    },
  },
  {
    key: 'close_interactive_ssh_session',
    title: 'Fechar sessao SSH interativa MCP',
    description: 'Fecha uma sessao SSH interativa MCP ativa.',
    accessMode: 'autonomous',
    risk: 'high',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string', minLength: 1, maxLength: 120 },
      },
    },
  },
] as const

export const MCP_RESOURCES: McpResourceDefinition[] = [
  {
    key: 'get_host_dashboard',
    title: 'Dashboard do host',
    description: 'Leitura consolidada do dashboard de um host visivel.',
    uriTemplate: 'nodeaccess://hosts/{id}/dashboard?periodDays={7|15|30|60}',
    accessMode: 'read_only',
    risk: 'low',
  },
  {
    key: 'list_host_diagnostic_runs',
    title: 'Execucoes de diagnostico por host',
    description: 'Lista execucoes de diagnostico vinculadas a um host visivel.',
    uriTemplate: 'nodeaccess://hosts/{id}/diagnostic-runs?status={pending|running|completed|failed|canceled[,..]}&aiSummaryStatus={PROCESSING|READY|FAILED|NONE[,..]}',
    accessMode: 'read_only',
    risk: 'low',
  },
  {
    key: 'get_diagnostic_run',
    title: 'Detalhe da execucao de diagnostico',
    description: 'Leitura detalhada de uma execucao de diagnostico especifica.',
    uriTemplate: 'nodeaccess://diagnostic-runs/{runId}',
    accessMode: 'read_only',
    risk: 'medium',
  },
  {
    key: 'list_host_action_runs',
    title: 'Execucoes de acoes por IA por host',
    description: 'Lista action runs vinculados a um host visivel.',
    uriTemplate: 'nodeaccess://hosts/{id}/ai-ssh-action-runs?status={pending_approval|approved|running|completed|failed|canceled|rejected[,..]}&channel={local_ai|mcp|integration|internal[,..]}&mode={read_only|diagnostic_only|approval_required|full_operational_access[,..]}',
    accessMode: 'read_only',
    risk: 'medium',
  },
  {
    key: 'get_action_run',
    title: 'Detalhe de action run por IA',
    description: 'Leitura detalhada de um action run especifico.',
    uriTemplate: 'nodeaccess://ai-ssh-action-runs/{runId}',
    accessMode: 'read_only',
    risk: 'medium',
  },
] as const
