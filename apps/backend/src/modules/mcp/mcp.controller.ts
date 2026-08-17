import type { FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from '../../shared/errors.js'
import type { McpService } from './mcp.service.js'

interface HostParams {
  id: string
}

interface RunParams {
  runId: string
}

interface PromptParams {
  key: string
}

interface SearchToolsBody {
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

interface RunHostOperationBody {
  target: string | number
  objective: string
  mode: 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access'
  approvalReason?: string | null
  steps: Array<{ id: string; label: string; command: string; timeoutSeconds: number }>
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

interface HostDashboardQuery {
  periodDays?: string
}

interface ActionRunsQuery {
  status?: string
  channel?: string
  mode?: string
}

interface DiagnosticRunsQuery {
  status?: string
  aiSummaryStatus?: string
}

interface McpJsonRpcBody {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown> | null
}

const allowedPeriods = [7, 15, 30, 60] as const

function parseStatusList(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export class McpController {
  constructor(private readonly service: McpService) {}

  private auditContext(request: FastifyRequest) {
    return {
      ...(request.mcpAuth?.mode ? { mode: request.mcpAuth.mode } : {}),
      ...(request.mcpAuth?.tokenId ? { tokenId: request.mcpAuth.tokenId } : {}),
      ...(request.mcpAuth?.allowedCapabilities ? { allowedCapabilities: request.mcpAuth.allowedCapabilities } : {}),
      ...(request.mcpAuth?.allowedActionModes ? { allowedActionModes: request.mcpAuth.allowedActionModes } : {}),
      ...(request.mcpAuth?.allowedHostIds ? { allowedHostIds: request.mcpAuth.allowedHostIds } : {}),
    }
  }

  async listCapabilities(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.listCapabilities(request.jwtUser!, this.auditContext(request)))
  }

  async listTools(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.listTools(request.jwtUser!, this.auditContext(request)))
  }

  async listResources(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.listResources(request.jwtUser!, this.auditContext(request)))
  }

  async searchHosts(request: FastifyRequest<{ Body: SearchToolsBody }>, reply: FastifyReply) {
    return reply.send(await this.service.searchHosts(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async getHostDashboard(
    request: FastifyRequest<{ Params: HostParams; Querystring: HostDashboardQuery }>,
    reply: FastifyReply,
  ) {
    const requestedPeriod = Number(request.query.periodDays)
    const periodDays = (allowedPeriods as readonly number[]).includes(requestedPeriod)
      ? requestedPeriod as 7 | 15 | 30 | 60
      : 30

    return reply.send(await this.service.getHostDashboard(request.jwtUser!, {
      hostId: Number(request.params.id),
      periodDays,
    }, this.auditContext(request)))
  }

  async listHostDiagnosticRuns(request: FastifyRequest<{ Params: HostParams; Querystring: DiagnosticRunsQuery }>, reply: FastifyReply) {
    const statuses = parseStatusList(request.query.status)
    const aiSummaryStatuses = parseStatusList(request.query.aiSummaryStatus)
    return reply.send(await this.service.listHostDiagnosticRuns(request.jwtUser!, {
      hostId: Number(request.params.id),
      ...(statuses ? { statuses } : {}),
      ...(aiSummaryStatuses ? { aiSummaryStatuses } : {}),
    }, this.auditContext(request)))
  }

  async getDiagnosticRun(request: FastifyRequest<{ Params: RunParams }>, reply: FastifyReply) {
    return reply.send(await this.service.getDiagnosticRun(request.jwtUser!, {
      runId: Number(request.params.runId),
    }, this.auditContext(request)))
  }

  async listHostActionRuns(request: FastifyRequest<{ Params: HostParams; Querystring: ActionRunsQuery }>, reply: FastifyReply) {
    const statuses = parseStatusList(request.query.status)
    const channels = parseStatusList(request.query.channel)
    const modes = parseStatusList(request.query.mode)
    return reply.send(await this.service.listHostActionRuns(request.jwtUser!, {
      hostId: Number(request.params.id),
      ...(statuses ? { statuses } : {}),
      ...(channels ? { channels } : {}),
      ...(modes ? { modes } : {}),
    }, this.auditContext(request)))
  }

  async getActionRun(request: FastifyRequest<{ Params: RunParams }>, reply: FastifyReply) {
    return reply.send(await this.service.getActionRun(request.jwtUser!, {
      runId: Number(request.params.runId),
    }, this.auditContext(request)))
  }

  async searchSnippets(request: FastifyRequest<{ Body: SearchToolsBody }>, reply: FastifyReply) {
    return reply.send(await this.service.searchSnippets(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async requestActionRun(request: FastifyRequest<{ Body: RequestActionRunBody }>, reply: FastifyReply) {
    return reply.send(await this.service.requestActionRun(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async runHostOperation(request: FastifyRequest<{ Body: RunHostOperationBody }>, reply: FastifyReply) {
    return reply.send(await this.service.runHostOperation(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async evaluateActionCommandPolicy(request: FastifyRequest<{ Body: EvaluateActionCommandPolicyBody }>, reply: FastifyReply) {
    return reply.send(await this.service.evaluateActionCommandPolicy(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async cancelActionRun(request: FastifyRequest<{ Body: CancelActionRunBody }>, reply: FastifyReply) {
    return reply.send(await this.service.cancelActionRun(request.jwtUser!, {
      runId: Number(request.body.runId),
    }, this.auditContext(request)))
  }

  async approveActionRun(request: FastifyRequest<{ Body: ApproveActionRunBody }>, reply: FastifyReply) {
    return reply.send(await this.service.approveActionRun(request.jwtUser!, {
      runId: Number(request.body.runId),
      ...(request.body.approvalReason !== undefined ? { approvalReason: request.body.approvalReason } : {}),
    }, this.auditContext(request)))
  }

  async rejectActionRun(request: FastifyRequest<{ Body: RejectActionRunBody }>, reply: FastifyReply) {
    return reply.send(await this.service.rejectActionRun(request.jwtUser!, {
      runId: Number(request.body.runId),
      ...(request.body.approvalReason !== undefined ? { approvalReason: request.body.approvalReason } : {}),
    }, this.auditContext(request)))
  }

  async openInteractiveSshSession(request: FastifyRequest<{ Body: OpenInteractiveSshSessionBody }>, reply: FastifyReply) {
    return reply.send(await this.service.openInteractiveSshSession(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async writeInteractiveSshSession(request: FastifyRequest<{ Body: WriteInteractiveSshSessionBody }>, reply: FastifyReply) {
    return reply.send(await this.service.writeInteractiveSshSession(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async readInteractiveSshSession(request: FastifyRequest<{ Body: ReadInteractiveSshSessionBody }>, reply: FastifyReply) {
    return reply.send(await this.service.readInteractiveSshSession(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async resizeInteractiveSshSession(request: FastifyRequest<{ Body: ResizeInteractiveSshSessionBody }>, reply: FastifyReply) {
    return reply.send(await this.service.resizeInteractiveSshSession(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async closeInteractiveSshSession(request: FastifyRequest<{ Body: CloseInteractiveSshSessionBody }>, reply: FastifyReply) {
    return reply.send(await this.service.closeInteractiveSshSession(request.jwtUser!, request.body, this.auditContext(request)))
  }

  async listPrompts(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ items: this.service.listPrompts() })
  }

  async getPrompt(request: FastifyRequest<{ Params: PromptParams }>, reply: FastifyReply) {
    return reply.send(await this.service.getPrompt(request.jwtUser!, request.params.key, this.auditContext(request)))
  }

  async jsonRpc(request: FastifyRequest<{ Body: McpJsonRpcBody }>, reply: FastifyReply) {
    const id = request.body?.id ?? null
    try {
      if (request.body?.jsonrpc !== '2.0') {
        throw new AppError('Versao JSON-RPC invalida', 400, 'MCP_JSONRPC_INVALID_VERSION')
      }

      const method = String(request.body.method ?? '').trim()
      if (!method) {
        throw new AppError('Metodo JSON-RPC obrigatorio', 400, 'MCP_JSONRPC_METHOD_REQUIRED')
      }

      const result = await this.service.handleJsonRpc(request.jwtUser!, {
        method,
        params: request.body.params ?? null,
      }, this.auditContext(request))

      return reply.send({
        jsonrpc: '2.0',
        id,
        result,
      })
    } catch (error) {
      const appError = error instanceof AppError
        ? error
        : new AppError('Falha ao processar JSON-RPC do MCP', 500, 'MCP_JSONRPC_INTERNAL_ERROR')

      return reply.status(appError.statusCode >= 500 ? 500 : 200).send({
        jsonrpc: '2.0',
        id,
        error: {
          code: appError.statusCode >= 500 ? -32603 : -32000,
          message: appError.message,
          data: {
            code: appError.code,
            statusCode: appError.statusCode,
          },
        },
      })
    }
  }
}
