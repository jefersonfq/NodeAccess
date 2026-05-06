import type { FastifyInstance } from 'fastify'
import { requireMcpAuth, requireMcpCapability, assertMcpCapabilityAuthorized, assertMcpActionModeAuthorized, assertMcpHostAuthorized, assertMcpInteractiveFullAccessAuthorized } from './mcp.guard.js'
import type { McpController } from './mcp.controller.js'

interface HostParams {
  id: string
}

interface RunParams {
  runId: string
}

interface PromptParams {
  key: string
}

interface SearchBody {
  query: string
  limit?: number
}

interface RequestActionRunBody {
  hostId: number
  mode: 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access'
  channel: 'local_ai' | 'mcp' | 'integration' | 'internal'
  summary: string
  approvalReason?: string | null
  steps: Array<{
    id: string
    label: string
    command: string
    timeoutSeconds: number
  }>
}

interface EvaluateActionCommandPolicyBody {
  command?: string
  mode?: 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access'
  steps?: Array<{
    id: string
    label?: string
    command: string
  }>
}

interface CancelActionRunBody {
  runId: number
}

interface ApproveActionRunBody {
  runId: number
  approvalReason?: string | null
}

interface RejectActionRunBody {
  runId: number
  approvalReason?: string | null
}

interface OpenInteractiveSshSessionBody {
  hostId: number
  reason: string
  ttlSeconds?: number
  cols?: number
  rows?: number
}

interface WriteInteractiveSshSessionBody {
  sessionId: string
  data: string
}

interface ReadInteractiveSshSessionBody {
  sessionId: string
  cursor?: number
  maxBytes?: number
}

interface ResizeInteractiveSshSessionBody {
  sessionId: string
  cols: number
  rows: number
}

interface CloseInteractiveSshSessionBody {
  sessionId: string
}

interface JsonRpcBody {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown> | null
}

const hostParamSchema = {
  type: 'object',
  properties: { id: { type: 'integer' } },
  required: ['id'],
}

const runParamSchema = {
  type: 'object',
  properties: { runId: { type: 'integer' } },
  required: ['runId'],
}

const promptParamSchema = {
  type: 'object',
  properties: { key: { type: 'string' } },
  required: ['key'],
}

const searchBodySchema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
}

const requestActionRunBodySchema = {
  type: 'object',
  required: ['hostId', 'mode', 'channel', 'summary', 'steps'],
  properties: {
    hostId: { type: 'integer', minimum: 1 },
    mode: { type: 'string', enum: ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access'] },
    channel: { type: 'string', enum: ['local_ai', 'mcp', 'integration', 'internal'] },
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
}

const evaluateActionCommandPolicyBodySchema = {
  type: 'object',
  anyOf: [
    { required: ['command'] },
    { required: ['steps'] },
  ],
  properties: {
    command: { type: 'string', minLength: 1, maxLength: 4000 },
    mode: { type: 'string', enum: ['read_only', 'diagnostic_only', 'approval_required', 'full_operational_access'] },
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
}

const cancelActionRunBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'integer', minimum: 1 },
  },
}

const approveActionRunBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'integer', minimum: 1 },
    approvalReason: { type: ['string', 'null'], maxLength: 500 },
  },
}

const rejectActionRunBodySchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'integer', minimum: 1 },
    approvalReason: { type: ['string', 'null'], maxLength: 500 },
  },
}

const openInteractiveSshSessionBodySchema = {
  type: 'object',
  required: ['hostId', 'reason'],
  properties: {
    hostId: { type: 'integer', minimum: 1 },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    ttlSeconds: { type: 'integer', minimum: 60, maximum: 3600 },
    cols: { type: 'integer', minimum: 40, maximum: 240 },
    rows: { type: 'integer', minimum: 10, maximum: 80 },
  },
}

const writeInteractiveSshSessionBodySchema = {
  type: 'object',
  required: ['sessionId', 'data'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    data: { type: 'string', minLength: 1, maxLength: 16000 },
  },
}

const readInteractiveSshSessionBodySchema = {
  type: 'object',
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    cursor: { type: 'integer', minimum: 0 },
    maxBytes: { type: 'integer', minimum: 1, maximum: 64000 },
  },
}

const resizeInteractiveSshSessionBodySchema = {
  type: 'object',
  required: ['sessionId', 'cols', 'rows'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    cols: { type: 'integer', minimum: 40, maximum: 240 },
    rows: { type: 'integer', minimum: 10, maximum: 80 },
  },
}

const closeInteractiveSshSessionBodySchema = {
  type: 'object',
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
  },
}

const capabilitySchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    kind: { type: 'string', enum: ['resource', 'tool', 'prompt'] },
    title: { type: 'string' },
    description: { type: 'string' },
    module: { type: 'string' },
    scope: { type: 'string' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    accessMode: { type: 'string', enum: ['read_only', 'approval_required', 'autonomous'] },
  },
  required: ['key', 'kind', 'title', 'description', 'module', 'scope', 'risk', 'accessMode'],
}

export async function mcpRoutes(app: FastifyInstance, controller: McpController): Promise<void> {
  app.post<{ Body: JsonRpcBody }>('/jsonrpc', {
    preHandler: [requireMcpAuth],
    schema: {
      tags: ['MCP'],
      summary: 'Ponte JSON-RPC compatível com MCP para discovery, tools e resources',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['jsonrpc', 'method'],
        properties: {
          jsonrpc: { type: 'string', enum: ['2.0'] },
          id: { anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
          method: { type: 'string' },
          params: { type: ['object', 'null'], additionalProperties: true },
        },
      },
    },
  }, async (request, reply) => {
    const method = String(request.body.method ?? '')
    if (method === 'tools/call') {
      const name = String(request.body.params?.name ?? '')
      if (
        name === 'search_hosts'
        || name === 'search_snippets'
        || name === 'request_action_run'
        || name === 'evaluate_action_command_policy'
        || name === 'cancel_action_run'
        || name === 'approve_action_run'
        || name === 'reject_action_run'
        || name === 'open_interactive_ssh_session'
        || name === 'write_interactive_ssh_session'
        || name === 'read_interactive_ssh_session'
        || name === 'resize_interactive_ssh_session'
        || name === 'close_interactive_ssh_session'
      ) {
        await assertMcpCapabilityAuthorized(request, name)
        if (name === 'request_action_run') {
          const args = request.body.params?.arguments
          const record = args && typeof args === 'object'
            ? args as Record<string, unknown>
            : {}
          const mode = String(record.mode ?? '')
          const hostId = Number(record.hostId)
          if (Number.isInteger(hostId) && hostId > 0) {
            await assertMcpHostAuthorized(request, hostId)
          }
          if (mode) {
            await assertMcpActionModeAuthorized(request, mode)
          }
        }
        if (
          name === 'open_interactive_ssh_session'
          || name === 'write_interactive_ssh_session'
          || name === 'read_interactive_ssh_session'
          || name === 'resize_interactive_ssh_session'
          || name === 'close_interactive_ssh_session'
        ) {
          await assertMcpInteractiveFullAccessAuthorized(request, name)
          if (name === 'open_interactive_ssh_session') {
            const args = request.body.params?.arguments
            const record = args && typeof args === 'object'
              ? args as Record<string, unknown>
              : {}
            const hostId = Number(record.hostId)
            if (Number.isInteger(hostId) && hostId > 0) {
              await assertMcpHostAuthorized(request, hostId, name)
            }
          }
        }
      }
    }
    if (method === 'resources/read') {
      const uri = String(request.body.params?.uri ?? '')
      if (uri.includes('/dashboard')) {
        await assertMcpCapabilityAuthorized(request, 'get_host_dashboard')
      } else if (uri.includes('/diagnostic-runs/') && !uri.endsWith('/diagnostic-runs')) {
        await assertMcpCapabilityAuthorized(request, 'get_diagnostic_run')
      } else if (uri.endsWith('/diagnostic-runs')) {
        await assertMcpCapabilityAuthorized(request, 'list_host_diagnostic_runs')
      } else if (uri.includes('/ai-ssh-action-runs/') && !uri.endsWith('/ai-ssh-action-runs')) {
        await assertMcpCapabilityAuthorized(request, 'get_action_run')
      } else if (uri.endsWith('/ai-ssh-action-runs')) {
        await assertMcpCapabilityAuthorized(request, 'list_host_action_runs')
      }
    }
    return controller.jsonRpc(request, reply)
  })

  app.get('/capabilities', {
    preHandler: [requireMcpAuth],
    schema: {
      tags: ['MCP'],
      summary: 'Listar capabilities MCP disponiveis',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            actor: {
              type: 'object',
              properties: {
                userId: { type: 'integer' },
                tenantId: { type: 'integer' },
                role: { type: 'string', enum: ['admin', 'user'] },
              },
              required: ['userId', 'tenantId', 'role'],
            },
            capabilities: {
              type: 'array',
              items: capabilitySchema,
            },
          },
          required: ['actor', 'capabilities'],
        },
      },
    },
  }, (request, reply) => controller.listCapabilities(request, reply))

  app.get('/prompts', {
    preHandler: [requireMcpAuth],
    schema: {
      tags: ['MCP'],
      summary: 'Listar prompts MCP disponiveis',
      security: [{ bearerAuth: [] }],
    },
  }, (request, reply) => controller.listPrompts(request, reply))

  app.get<{ Params: PromptParams }>('/prompts/:key', {
    preHandler: [requireMcpAuth],
    schema: {
      tags: ['MCP'],
      summary: 'Ler prompt MCP especifico',
      security: [{ bearerAuth: [] }],
      params: promptParamSchema,
    },
  }, (request, reply) => controller.getPrompt(request, reply))

  app.get('/tools', {
    preHandler: [requireMcpAuth],
    schema: {
      tags: ['MCP'],
      summary: 'Listar tools MCP disponiveis com schema de entrada',
      security: [{ bearerAuth: [] }],
    },
  }, (request, reply) => controller.listTools(request, reply))

  app.get('/resources', {
    preHandler: [requireMcpAuth],
    schema: {
      tags: ['MCP'],
      summary: 'Listar resources MCP disponiveis com URI template',
      security: [{ bearerAuth: [] }],
    },
  }, (request, reply) => controller.listResources(request, reply))

  app.post<{ Body: SearchBody }>('/tools/search-hosts', {
    preHandler: [requireMcpCapability('search_hosts')],
    schema: {
      tags: ['MCP'],
      summary: 'Buscar hosts visiveis para uso via MCP',
      security: [{ bearerAuth: [] }],
      body: searchBodySchema,
    },
  }, (request, reply) => controller.searchHosts(request, reply))

  app.post<{ Body: SearchBody }>('/tools/search-snippets', {
    preHandler: [requireMcpCapability('search_snippets')],
    schema: {
      tags: ['MCP'],
      summary: 'Buscar snippets visiveis para uso via MCP',
      security: [{ bearerAuth: [] }],
      body: searchBodySchema,
    },
  }, (request, reply) => controller.searchSnippets(request, reply))

  app.post<{ Body: RequestActionRunBody }>('/tools/request-action-run', {
    preHandler: [
      requireMcpCapability('request_action_run'),
      async (request) => {
        await assertMcpActionModeAuthorized(request, request.body.mode)
        await assertMcpHostAuthorized(request, request.body.hostId)
      },
    ],
    schema: {
      tags: ['MCP'],
      summary: 'Solicitar action run por IA via MCP',
      security: [{ bearerAuth: [] }],
      body: requestActionRunBodySchema,
    },
  }, async (request, reply) => {
    await assertMcpActionModeAuthorized(request, request.body.mode)
    return controller.requestActionRun(request, reply)
  })

  app.post<{ Body: EvaluateActionCommandPolicyBody }>('/tools/evaluate-action-command-policy', {
    preHandler: [requireMcpCapability('evaluate_action_command_policy')],
    schema: {
      tags: ['MCP'],
      summary: 'Avaliar policy de comando SSH por IA via MCP',
      security: [{ bearerAuth: [] }],
      body: evaluateActionCommandPolicyBodySchema,
    },
  }, (request, reply) => controller.evaluateActionCommandPolicy(request, reply))

  app.post<{ Body: CancelActionRunBody }>('/tools/cancel-action-run', {
    preHandler: [requireMcpCapability('cancel_action_run')],
    schema: {
      tags: ['MCP'],
      summary: 'Cancelar action run por IA via MCP',
      security: [{ bearerAuth: [] }],
      body: cancelActionRunBodySchema,
    },
  }, (request, reply) => controller.cancelActionRun(request, reply))

  app.post<{ Body: ApproveActionRunBody }>('/tools/approve-action-run', {
    preHandler: [requireMcpCapability('approve_action_run')],
    schema: {
      tags: ['MCP'],
      summary: 'Aprovar action run por IA via MCP',
      security: [{ bearerAuth: [] }],
      body: approveActionRunBodySchema,
    },
  }, (request, reply) => controller.approveActionRun(request, reply))

  app.post<{ Body: RejectActionRunBody }>('/tools/reject-action-run', {
    preHandler: [requireMcpCapability('reject_action_run')],
    schema: {
      tags: ['MCP'],
      summary: 'Rejeitar action run por IA via MCP',
      security: [{ bearerAuth: [] }],
      body: rejectActionRunBodySchema,
    },
  }, (request, reply) => controller.rejectActionRun(request, reply))

  app.post<{ Body: OpenInteractiveSshSessionBody }>('/tools/open-interactive-ssh-session', {
    preHandler: [
      requireMcpCapability('open_interactive_ssh_session'),
      async (request) => {
        await assertMcpInteractiveFullAccessAuthorized(request, 'open_interactive_ssh_session')
        await assertMcpHostAuthorized(request, request.body.hostId, 'open_interactive_ssh_session')
      },
    ],
    schema: {
      tags: ['MCP'],
      summary: 'Abrir sessao SSH interativa livre via MCP',
      security: [{ bearerAuth: [] }],
      body: openInteractiveSshSessionBodySchema,
    },
  }, (request, reply) => controller.openInteractiveSshSession(request, reply))

  app.post<{ Body: WriteInteractiveSshSessionBody }>('/tools/write-interactive-ssh-session', {
    preHandler: [
      requireMcpCapability('write_interactive_ssh_session'),
      async (request) => {
        await assertMcpInteractiveFullAccessAuthorized(request, 'write_interactive_ssh_session')
      },
    ],
    schema: {
      tags: ['MCP'],
      summary: 'Escrever em sessao SSH interativa MCP',
      security: [{ bearerAuth: [] }],
      body: writeInteractiveSshSessionBodySchema,
    },
  }, (request, reply) => controller.writeInteractiveSshSession(request, reply))

  app.post<{ Body: ReadInteractiveSshSessionBody }>('/tools/read-interactive-ssh-session', {
    preHandler: [
      requireMcpCapability('read_interactive_ssh_session'),
      async (request) => {
        await assertMcpInteractiveFullAccessAuthorized(request, 'read_interactive_ssh_session')
      },
    ],
    schema: {
      tags: ['MCP'],
      summary: 'Ler buffer de sessao SSH interativa MCP',
      security: [{ bearerAuth: [] }],
      body: readInteractiveSshSessionBodySchema,
    },
  }, (request, reply) => controller.readInteractiveSshSession(request, reply))

  app.post<{ Body: ResizeInteractiveSshSessionBody }>('/tools/resize-interactive-ssh-session', {
    preHandler: [
      requireMcpCapability('resize_interactive_ssh_session'),
      async (request) => {
        await assertMcpInteractiveFullAccessAuthorized(request, 'resize_interactive_ssh_session')
      },
    ],
    schema: {
      tags: ['MCP'],
      summary: 'Redimensionar sessao SSH interativa MCP',
      security: [{ bearerAuth: [] }],
      body: resizeInteractiveSshSessionBodySchema,
    },
  }, (request, reply) => controller.resizeInteractiveSshSession(request, reply))

  app.post<{ Body: CloseInteractiveSshSessionBody }>('/tools/close-interactive-ssh-session', {
    preHandler: [
      requireMcpCapability('close_interactive_ssh_session'),
      async (request) => {
        await assertMcpInteractiveFullAccessAuthorized(request, 'close_interactive_ssh_session')
      },
    ],
    schema: {
      tags: ['MCP'],
      summary: 'Fechar sessao SSH interativa MCP',
      security: [{ bearerAuth: [] }],
      body: closeInteractiveSshSessionBodySchema,
    },
  }, (request, reply) => controller.closeInteractiveSshSession(request, reply))

  app.get<{ Params: HostParams; Querystring: { periodDays?: string } }>('/resources/hosts/:id/dashboard', {
    preHandler: [requireMcpCapability('get_host_dashboard')],
    schema: {
      tags: ['MCP'],
      summary: 'Ler dashboard de host via MCP',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      querystring: {
        type: 'object',
        properties: {
          periodDays: { type: 'integer', enum: [7, 15, 30, 60] },
        },
      },
    },
  }, (request, reply) => controller.getHostDashboard(request, reply))

  app.get<{ Params: HostParams; Querystring: { status?: string } }>('/resources/hosts/:id/diagnostic-runs', {
    preHandler: [requireMcpCapability('list_host_diagnostic_runs')],
    schema: {
      tags: ['MCP'],
      summary: 'Listar execucoes de diagnostico do host via MCP',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          aiSummaryStatus: { type: 'string' },
        },
      },
    },
  }, (request, reply) => controller.listHostDiagnosticRuns(request, reply))

  app.get<{ Params: RunParams }>('/resources/diagnostic-runs/:runId', {
    preHandler: [requireMcpCapability('get_diagnostic_run')],
    schema: {
      tags: ['MCP'],
      summary: 'Ler detalhe de execucao de diagnostico via MCP',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
    },
  }, (request, reply) => controller.getDiagnosticRun(request, reply))

  app.get<{ Params: HostParams; Querystring: { status?: string } }>('/resources/hosts/:id/ai-ssh-action-runs', {
    preHandler: [requireMcpCapability('list_host_action_runs')],
    schema: {
      tags: ['MCP'],
      summary: 'Listar action runs por IA do host via MCP',
      security: [{ bearerAuth: [] }],
      params: hostParamSchema,
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          channel: { type: 'string' },
          mode: { type: 'string' },
        },
      },
    },
  }, (request, reply) => controller.listHostActionRuns(request, reply))

  app.get<{ Params: RunParams }>('/resources/ai-ssh-action-runs/:runId', {
    preHandler: [requireMcpCapability('get_action_run')],
    schema: {
      tags: ['MCP'],
      summary: 'Ler detalhe de action run por IA via MCP',
      security: [{ bearerAuth: [] }],
      params: runParamSchema,
    },
  }, (request, reply) => controller.getActionRun(request, reply))
}
