import type { PrismaClient } from '@prisma/client'
import { AppError } from '../../shared/errors.js'
import type { JwtPayload } from '../../shared/guards.js'
import type { HostDashboardService } from '../host-dashboard/host-dashboard.service.js'
import type { DiagnosticRunService } from '../diagnostic-playbooks/diagnostic-run.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SnippetService } from '../snippets/snippet.service.js'
import type { AiSshActionService } from '../ai-ssh-actions/ai-ssh-action.service.js'
import type { AiSshActionCommandPolicyService } from '../ai-ssh-actions/ai-ssh-action-command-policy.service.js'
import { MCP_CAPABILITIES, MCP_RESOURCES, MCP_TOOLS, type McpCapabilityDefinition, type McpCapabilityKind } from './mcp.capabilities.js'
import type { McpInteractiveSshService } from './mcp-interactive-ssh.service.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { AiInteractionRepository } from '../local-ai/ai-interaction.repository.js'
import type { AiInvestigationService } from '../ai-investigations/ai-investigation.service.js'
import { expandMcpActionModes, isMcpActionModeAllowed } from './mcp-action-mode-policy.js'
import { buildMcpCommandAuditEvidence, sanitizeMcpAuditText } from './mcp-audit-evidence.js'

interface McpAuditContext {
  mode?: 'jwt' | 'persisted_token' | 'static_token'
  tokenId?: number
  allowedCapabilities?: string[]
  allowedActionModes?: string[]
  allowedHostIds?: number[]
}

function catalogAllowed(key: string, auditContext?: McpAuditContext): boolean {
  const allowed = auditContext?.allowedCapabilities
  const investigationSupport = ['start_host_investigation','get_host_investigation','complete_host_investigation','abandon_host_investigation'].includes(key)
  return !allowed?.length || allowed.includes(key) || (investigationSupport && allowed.includes('run_host_operation'))
}

const ALLOWED_ACTION_RUN_STATUSES = [
  'pending_approval',
  'approved',
  'running',
  'completed',
  'failed',
  'canceled',
  'rejected',
] as const

type McpActionRunStatus = typeof ALLOWED_ACTION_RUN_STATUSES[number]

const ALLOWED_DIAGNOSTIC_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'canceled',
] as const

type McpDiagnosticRunStatus = typeof ALLOWED_DIAGNOSTIC_RUN_STATUSES[number]

const ALLOWED_DIAGNOSTIC_AI_SUMMARY_STATUSES = [
  'PROCESSING',
  'READY',
  'FAILED',
  'NONE',
] as const

type McpDiagnosticAiSummaryStatus = typeof ALLOWED_DIAGNOSTIC_AI_SUMMARY_STATUSES[number]

const ALLOWED_ACTION_RUN_CHANNELS = [
  'local_ai',
  'mcp',
  'integration',
  'internal',
] as const

type McpActionRunChannel = typeof ALLOWED_ACTION_RUN_CHANNELS[number]

const ALLOWED_ACTION_RUN_MODES = [
  'read_only',
  'diagnostic_only',
  'approval_required',
  'full_operational_access',
] as const

type McpActionRunMode = typeof ALLOWED_ACTION_RUN_MODES[number]

export class McpService {
  constructor(
    private readonly db: PrismaClient,
    private readonly hostDashboardService: HostDashboardService,
    private readonly diagnosticRunService: DiagnosticRunService,
    private readonly snippetService: SnippetService,
    private readonly aiSshActionService: AiSshActionService,
    private readonly aiSshActionCommandPolicyService: AiSshActionCommandPolicyService,
    private readonly logRepository: LogRepository,
    private readonly interactiveSshService: McpInteractiveSshService,
    private readonly sshRepository: SshRepository,
    private readonly interactions?: AiInteractionRepository,
    private readonly investigations?: AiInvestigationService,
  ) {}

  async listCapabilities(user: JwtPayload, auditContext?: McpAuditContext): Promise<{
    actor: {
      userId: number
      tenantId: number
      role: 'admin' | 'user'
    }
    capabilities: McpCapabilityDefinition[]
  }> {
    const capabilities = MCP_CAPABILITIES.filter((item) => catalogAllowed(item.key, auditContext))
    await this.audit(user, 'MCP_CAPABILITIES_LISTED', {
      count: capabilities.length,
    }, auditContext)

    return {
      actor: {
        userId: Number(user.sub),
        tenantId: user.tenantId,
        role: user.role,
      },
      capabilities,
    }
  }

  async searchHosts(user: JwtPayload, input: { query: string; limit?: number }, auditContext?: McpAuditContext) {
    const query = input.query.trim()
    if (!query) throw new AppError('Consulta MCP obrigatoria', 400, 'MCP_QUERY_REQUIRED')

    const limit = Math.max(1, Math.min(input.limit ?? 10, 50))
    const candidates = await this.db.host.findMany({
      where: {
        tenantId: user.tenantId,
        deletedAt: null,
        OR: [
          { name: { contains: query } },
          { ip: { contains: query } },
          { sshUser: { contains: query } },
          { group: { name: { contains: query } } },
          { bastion: { name: { contains: query } } },
        ],
      },
      select: {
        id: true,
        name: true,
        ip: true,
        port: true,
        sshUser: true,
        scope: true,
        connectionMode: true,
        group: { select: { name: true } },
        bastion: { select: { name: true } },
      },
      orderBy: [{ name: 'asc' }],
      take: Math.min(Math.max(limit * 10, 50), 200),
    })
    const visibleHostIds = await this.sshRepository.findHostIdsWithEffectivePermission(
      candidates.map((host) => host.id),
      user.tenantId,
      Number(user.sub),
      'view',
      user.role === 'admin' ? 'ADMIN' : 'USER',
    )
    const hosts = candidates.filter((host) => visibleHostIds.has(host.id)).slice(0, limit)

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'search_hosts',
      query,
      resultCount: hosts.length,
    }, auditContext)

    return {
      capability: 'search_hosts' as const,
      items: hosts.map((host) => ({
        id: host.id,
        name: host.name,
        ip: host.ip,
        port: host.port,
        sshUser: host.sshUser,
        scope: String(host.scope).toLowerCase(),
        connectionMode: String(host.connectionMode).toLowerCase(),
        groupName: host.group?.name ?? null,
        bastionName: host.bastion?.name ?? null,
      })),
    }
  }

  async getHostDashboard(user: JwtPayload, input: { hostId: number; periodDays?: 7 | 15 | 30 | 60 }, auditContext?: McpAuditContext) {
    const periodDays = input.periodDays ?? 30
    const dashboard = await this.hostDashboardService.getDashboard({
      hostId: input.hostId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
      periodDays,
    })

    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'get_host_dashboard',
      hostId: input.hostId,
      periodDays,
    }, auditContext)

    return dashboard
  }

  async listHostDiagnosticRuns(user: JwtPayload, input: {
    hostId: number
    statuses?: string[]
    aiSummaryStatuses?: string[]
  }, auditContext?: McpAuditContext) {
    const requestedStatuses = this.normalizeDiagnosticRunStatuses(input.statuses)
    const requestedAiSummaryStatuses = this.normalizeDiagnosticAiSummaryStatuses(input.aiSummaryStatuses)
    const allRuns = await this.diagnosticRunService.listForHost({
      hostId: input.hostId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
    })
    const runs = allRuns.filter((run) => {
      if (requestedStatuses.length && !requestedStatuses.includes(run.status as McpDiagnosticRunStatus)) {
        return false
      }
      if (requestedAiSummaryStatuses.length) {
        const current = (run.aiSummaryStatus ?? 'NONE').toUpperCase() as McpDiagnosticAiSummaryStatus
        if (!requestedAiSummaryStatuses.includes(current)) return false
      }
      return true
    })

    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'list_host_diagnostic_runs',
      hostId: input.hostId,
      ...(requestedStatuses.length ? { statuses: requestedStatuses } : {}),
      ...(requestedAiSummaryStatuses.length ? { aiSummaryStatuses: requestedAiSummaryStatuses } : {}),
      resultCount: runs.length,
    }, auditContext)

    return runs
  }

  async getDiagnosticRun(user: JwtPayload, input: { runId: number }, auditContext?: McpAuditContext) {
    const run = await this.diagnosticRunService.getById({
      id: input.runId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
    })

    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'get_diagnostic_run',
      runId: input.runId,
      hostId: run.hostId,
      status: run.status,
    }, auditContext)

    return run
  }

  async searchSnippets(user: JwtPayload, input: { query: string; limit?: number }, auditContext?: McpAuditContext) {
    const query = input.query.trim()
    if (!query) throw new AppError('Consulta MCP obrigatoria', 400, 'MCP_QUERY_REQUIRED')

    const limit = Math.max(1, Math.min(input.limit ?? 10, 50))
    const rows = await this.snippetService.list(Number(user.sub), user.tenantId)
    const items = rows
      .filter((snippet) => {
        const haystacks = [snippet.name, snippet.description ?? '', snippet.command]
        return haystacks.some((value) => value.toLowerCase().includes(query.toLowerCase()))
      })
      .slice(0, limit)
      .map((snippet) => ({
        id: snippet.id,
        name: snippet.name,
        description: snippet.description ?? null,
        scope: String(snippet.scope).toLowerCase(),
        groupName: snippet.group?.name ?? null,
      }))

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'search_snippets',
      query,
      resultCount: items.length,
    }, auditContext)

    return {
      capability: 'search_snippets' as const,
      items,
    }
  }

  async listHostActionRuns(user: JwtPayload, input: {
    hostId: number
    statuses?: string[]
    channels?: string[]
    modes?: string[]
  }, auditContext?: McpAuditContext) {
    const requestedStatuses = this.normalizeActionRunStatuses(input.statuses)
    const requestedChannels = this.normalizeActionRunChannels(input.channels)
    const requestedModes = this.normalizeActionRunModes(input.modes)
    const allRuns = await this.aiSshActionService.listForHost({
      hostId: input.hostId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
    })
    const runs = allRuns.filter((run) => {
      if (requestedStatuses.length && !requestedStatuses.includes(run.status as McpActionRunStatus)) {
        return false
      }
      if (requestedChannels.length && !requestedChannels.includes(run.channel as McpActionRunChannel)) {
        return false
      }
      if (requestedModes.length && !requestedModes.includes(run.mode as McpActionRunMode)) {
        return false
      }
      return true
    })

    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'list_host_action_runs',
      hostId: input.hostId,
      ...(requestedStatuses.length ? { statuses: requestedStatuses } : {}),
      ...(requestedChannels.length ? { channels: requestedChannels } : {}),
      ...(requestedModes.length ? { modes: requestedModes } : {}),
      resultCount: runs.length,
    }, auditContext)

    return runs
  }

  async getActionRun(user: JwtPayload, input: { runId: number }, auditContext?: McpAuditContext) {
    const run = await this.aiSshActionService.getById({
      id: input.runId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
    })

    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'get_action_run',
      runId: input.runId,
      hostId: run.hostId,
      status: run.status,
    }, auditContext)

    return run
  }

  async requestActionRun(user: JwtPayload, input: {
    hostId: number
    mode: 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access'
    channel: 'local_ai' | 'mcp' | 'integration' | 'internal'
    summary: string
    approvalReason?: string | null
    investigationId?: number | null
    steps: Array<{ id: string; label: string; command: string; timeoutSeconds: number }>
  }, auditContext?: McpAuditContext) {
    const run = await this.aiSshActionService.createRequestedRun({
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
      mcpTokenId: auditContext?.tokenId ?? null,
      investigationId: input.investigationId ?? null,
      dto: {
        hostId: input.hostId,
        mode: input.mode,
        channel: input.channel,
        summary: input.summary,
        approvalReason: input.approvalReason ?? null,
        steps: input.steps,
      },
    })

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'request_action_run',
      instructionSource: 'mcp_agent',
      requestedByUserId: Number(user.sub),
      hostId: input.hostId,
      runId: run.id,
      investigationId: input.investigationId ?? null,
      mode: run.mode,
      channel: run.channel,
      status: run.status,
      instructionSummary: sanitizeMcpAuditText(input.summary),
      commandCount: input.steps.length,
      commandEvidence: buildMcpCommandAuditEvidence(input.steps),
    }, auditContext)

    return run
  }

  async runHostOperation(user: JwtPayload, input: {
    target: string | number
    objective: string
    mode: McpActionRunMode
    approvalReason?: string | null
    investigationId?: number | null
    steps: Array<{ id: string; label: string; command: string; timeoutSeconds: number }>
  }, auditContext?: McpAuditContext) {
    const objective = input.objective.trim()
    if (!objective) throw new AppError('Objetivo operacional obrigatorio', 400, 'MCP_OPERATION_OBJECTIVE_REQUIRED')
    if (!ALLOWED_ACTION_RUN_MODES.includes(input.mode)) {
      throw new AppError(`Modo de operacao MCP nao suportado: ${input.mode}`, 400, 'MCP_ACTION_RUN_MODE_NOT_SUPPORTED')
    }
    if (!isMcpActionModeAllowed(auditContext?.allowedActionModes, input.mode)) {
      throw new AppError(`Modo de operacao nao permitido para este token MCP: ${input.mode}`, 403, 'MCP_ACTION_RUN_MODE_DENIED')
    }

    const host = await this.resolveOperationHost(user, input.target)
    if (auditContext?.allowedHostIds?.length && !auditContext.allowedHostIds.includes(host.id)) {
      throw new AppError(`Host nao permitido para este token MCP: ${host.id}`, 403, 'MCP_HOST_DENIED')
    }
    if (input.investigationId) {
      if (!this.investigations) throw new AppError('Investigações não disponíveis', 503, 'AI_INVESTIGATION_UNAVAILABLE')
      const investigation = await this.investigations.get(input.investigationId, user.tenantId)
      if (investigation.hostId !== host.id) {
        throw new AppError('A investigação pertence a outro host', 409, 'AI_INVESTIGATION_HOST_MISMATCH')
      }
      if (!['OPEN', 'WAITING_USER'].includes(investigation.status)) {
        throw new AppError('Investigação encerrada', 409, 'AI_INVESTIGATION_CLOSED')
      }
    }

    const run = await this.requestActionRun(user, {
      hostId: host.id,
      mode: input.mode,
      channel: 'mcp',
      summary: objective,
      ...(input.approvalReason !== undefined ? { approvalReason: input.approvalReason } : {}),
      investigationId: input.investigationId ?? null,
      steps: input.steps,
    }, auditContext)
    if (input.investigationId) await this.investigations?.attachRun(input.investigationId, run.id, user.tenantId)

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'run_host_operation',
      instructionSource: 'mcp_agent',
      requestedByUserId: Number(user.sub),
      hostId: host.id,
      runId: run.id,
      investigationId: input.investigationId ?? null,
      mode: run.mode,
      status: run.status,
      commandCount: input.steps.length,
    }, auditContext)

    return {
      capability: 'run_host_operation' as const,
      target: host,
      run,
      governance: {
        status: run.status,
        requiresApproval: run.status === 'pending_approval',
        nextAction: run.status === 'pending_approval'
          ? `Abra /ai-ssh-action-runs/${run.id} no NodeAccess para revisar os comandos e aprovar ou rejeitar a solicitacao.`
          : `A execucao foi autorizada. Abra /ai-ssh-action-runs/${run.id} no NodeAccess para acompanhar evidencias e resultado.`,
        actionRunPath: `/ai-ssh-action-runs/${run.id}`,
        actionRunResource: `nodeaccess://ai-ssh-action-runs/${run.id}`,
        ...(input.investigationId ? { investigationId: input.investigationId } : {}),
      },
    }
  }

  async evaluateActionCommandPolicy(user: JwtPayload, input: {
    command?: string
    mode?: 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access'
    steps?: Array<{ id: string; label?: string; command: string }>
  }, auditContext?: McpAuditContext) {
    const mode = input.mode
    if (mode && !ALLOWED_ACTION_RUN_MODES.includes(mode)) {
      throw new AppError(`Modo de action run MCP nao suportado: ${mode}`, 400, 'MCP_ACTION_RUN_MODE_NOT_SUPPORTED')
    }
    const rawSteps = 'steps' in input && Array.isArray(input.steps) ? input.steps : []
    const hasPlan = rawSteps.length > 0
    const commands = hasPlan
      ? rawSteps.map((step) => ({
        id: String(step.id ?? ''),
        label: step.label === undefined ? null : String(step.label),
        command: String(step.command ?? ''),
      }))
      : [{ id: 'command', label: null, command: String(input.command ?? '') }]

    if (!commands.length) {
      throw new AppError('Comando ou steps obrigatorios para avaliar policy', 400, 'MCP_ACTION_COMMAND_POLICY_INPUT_REQUIRED')
    }

    const evaluations = await Promise.all(commands.map(async (step) => {
      const result = await this.aiSshActionCommandPolicyService.evaluate({
        tenantId: user.tenantId,
        command: step.command,
      })
      return {
        id: step.id,
        label: step.label,
        command: result.command,
        risk: result.risk,
      }
    }))
    const blockedSteps = evaluations.filter((step) => step.risk === 'blocked').map((step) => step.id)
    const approvalRequiredSteps = evaluations.filter((step) => step.risk === 'approval_required').map((step) => step.id)
    const maxRisk = blockedSteps.length ? 'blocked' : approvalRequiredSteps.length ? 'approval_required' : 'safe'
    const modeAllowsPlan = !mode
      ? true
      : !blockedSteps.length
        && (!approvalRequiredSteps.length || mode === 'approval_required' || mode === 'full_operational_access')
    const recommendation = blockedSteps.length
      ? 'blocked'
      : approvalRequiredSteps.length
        ? mode === 'full_operational_access'
          ? 'can_request'
          : 'use_approval_required'
        : 'can_request'

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'evaluate_action_command_policy',
      risk: maxRisk,
      ...(mode ? { mode } : {}),
      commandCount: evaluations.length,
      blockedSteps,
      approvalRequiredSteps,
    }, auditContext)

    if (!hasPlan) {
      return {
        capability: 'evaluate_action_command_policy' as const,
        command: evaluations[0]!.command,
        risk: evaluations[0]!.risk,
      }
    }

    return {
      capability: 'evaluate_action_command_policy' as const,
      mode: mode ?? null,
      maxRisk,
      canRequest: modeAllowsPlan,
      recommendation,
      approvalRequiredSteps,
      blockedSteps,
      steps: evaluations,
    }
  }

  async cancelActionRun(user: JwtPayload, input: { runId: number }, auditContext?: McpAuditContext) {
    const run = await this.aiSshActionService.cancel({
      id: input.runId,
      tenantId: user.tenantId,
      userId: Number(user.sub),
      role: user.role === 'admin' ? 'ADMIN' : 'USER',
    })

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'cancel_action_run',
      runId: input.runId,
      hostId: run.hostId,
      status: run.status,
    }, auditContext)

    return run
  }

  async approveActionRun(user: JwtPayload, input: { runId: number; approvalReason?: string | null }, auditContext?: McpAuditContext) {
    if (user.role !== 'admin') {
      throw new AppError('Aprovacao de action run via MCP exige perfil administrativo', 403, 'MCP_ACTION_RUN_APPROVAL_FORBIDDEN')
    }

    const run = await this.aiSshActionService.approve({
      id: input.runId,
      tenantId: user.tenantId,
      adminId: Number(user.sub),
      ...(input.approvalReason !== undefined ? { approvalReason: input.approvalReason } : {}),
    })

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'approve_action_run',
      runId: input.runId,
      hostId: run.hostId,
      status: run.status,
    }, auditContext)

    return run
  }

  async rejectActionRun(user: JwtPayload, input: { runId: number; approvalReason?: string | null }, auditContext?: McpAuditContext) {
    if (user.role !== 'admin') {
      throw new AppError('Rejeicao de action run via MCP exige perfil administrativo', 403, 'MCP_ACTION_RUN_REJECTION_FORBIDDEN')
    }

    const run = await this.aiSshActionService.reject({
      id: input.runId,
      tenantId: user.tenantId,
      adminId: Number(user.sub),
      ...(input.approvalReason !== undefined ? { approvalReason: input.approvalReason } : {}),
    })

    await this.audit(user, 'MCP_TOOL_CALLED', {
      capability: 'reject_action_run',
      runId: input.runId,
      hostId: run.hostId,
      status: run.status,
    }, auditContext)

    return run
  }

  async openInteractiveSshSession(user: JwtPayload, input: {
    hostId: number
    reason: string
    ttlSeconds?: number
    cols?: number
    rows?: number
  }, auditContext?: McpAuditContext) {
    return this.interactiveSshService.open(user, input, auditContext)
  }

  async writeInteractiveSshSession(user: JwtPayload, input: {
    sessionId: string
    data: string
  }, auditContext?: McpAuditContext) {
    return this.interactiveSshService.write(user, input, auditContext)
  }

  async readInteractiveSshSession(user: JwtPayload, input: {
    sessionId: string
    cursor?: number
    maxBytes?: number
  }, auditContext?: McpAuditContext) {
    return this.interactiveSshService.read(user, input, auditContext)
  }

  async resizeInteractiveSshSession(user: JwtPayload, input: {
    sessionId: string
    cols: number
    rows: number
  }, auditContext?: McpAuditContext) {
    return this.interactiveSshService.resize(user, input, auditContext)
  }

  async closeInteractiveSshSession(user: JwtPayload, input: {
    sessionId: string
  }, auditContext?: McpAuditContext) {
    return this.interactiveSshService.close(user, input, auditContext)
  }

  listPrompts(input?: { kind?: McpCapabilityKind }) {
    const items = MCP_CAPABILITIES.filter((item) => item.kind === 'prompt' && (!input?.kind || item.kind === input.kind))
    return items.map((item) => ({
      key: item.key,
      title: item.title,
      description: item.description,
      template: this.promptTemplate(item.key),
    }))
  }

  async getPrompt(user: JwtPayload, key: string, auditContext?: McpAuditContext) {
    const prompt = this.listPrompts().find((item) => item.key === key)
    if (!prompt) {
      throw new AppError(`Prompt MCP nao suportado: ${key}`, 404, 'MCP_PROMPT_NOT_SUPPORTED')
    }

    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'prompt_get',
      promptKey: key,
    }, auditContext)

    return {
      key: prompt.key,
      title: prompt.title,
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: prompt.template,
          },
        },
      ],
    }
  }

  async listTools(user: JwtPayload, auditContext?: McpAuditContext) {
    const items = MCP_TOOLS.filter((item) => catalogAllowed(item.key, auditContext))
    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'tools_catalog',
      resultCount: items.length,
    }, auditContext)

    return {
      items,
    }
  }

  async listResources(user: JwtPayload, auditContext?: McpAuditContext) {
    const items = MCP_RESOURCES.filter((item) => catalogAllowed(item.key, auditContext))
    await this.audit(user, 'MCP_RESOURCE_READ', {
      capability: 'resources_catalog',
      resultCount: items.length,
    }, auditContext)

    return {
      items,
    }
  }

  async handleJsonRpc(user: JwtPayload, input: {
    method: string
    params?: Record<string, unknown> | null
  }, auditContext?: McpAuditContext) {
    switch (input.method) {
      case 'initialize':
        const effectiveActionModes = expandMcpActionModes(auditContext?.allowedActionModes)
        return {
          protocolVersion: '2025-06-18',
          serverInfo: {
            name: 'nodeaccess-mcp',
            version: '0.1.0',
          },
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false },
            prompts: { listChanged: false },
          },
          instructions: `Use start_host_investigation quando o pedido puder exigir mais de uma interação e associe investigationId em run_host_operation. A conexão SSH permanece curta; a investigação mantém o contexto. Após cada run, consulte o resultado e pergunte ao usuário se deseja continuar ou concluir. Só use complete_host_investigation quando confirmedByUser=true após confirmação explícita, persistindo relatório com fatos, hipóteses e evidências. Modos efetivos deste token: ${effectiveActionModes.join(', ') || 'nenhum'}. Escolha o menor modo suficiente. Depois de criar uma operação, use get_action_run para acompanhar aprovação, steps, exit codes e resultado. Em probes onde ausência também é resultado válido, normalize para exit 0. Nunca contorne policies ou aprovações.`,
        }

      case 'tools/list':
        return {
          tools: MCP_TOOLS.filter((tool) => catalogAllowed(tool.key, auditContext)).map((tool) => ({
            name: tool.key,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: {
              readOnlyHint: tool.accessMode === 'read_only',
              destructiveHint: tool.risk === 'high',
              idempotentHint: tool.accessMode === 'read_only',
              openWorldHint: tool.key === 'run_host_operation' || tool.key.includes('interactive_ssh'),
            },
          })),
        }

      case 'resources/list':
        return {
          resources: [],
        }

      case 'resources/templates/list':
        return {
          resourceTemplates: MCP_RESOURCES.filter((resource) => catalogAllowed(resource.key, auditContext)).map((resource) => ({
            name: resource.key,
            title: resource.title,
            description: resource.description,
            uriTemplate: resource.uriTemplate,
            mimeType: 'application/json',
          })),
        }

      case 'prompts/list':
        return {
          prompts: this.listPrompts().filter((prompt) => catalogAllowed(prompt.key, auditContext)).map((prompt) => ({
            name: prompt.key,
            title: prompt.title,
            description: prompt.description,
            arguments: [],
          })),
        }

      case 'prompts/get': {
        const key = String(input.params?.name ?? '').trim()
        if (!key) throw new AppError('Nome do prompt MCP obrigatorio', 400, 'MCP_PROMPT_NAME_REQUIRED')
        const prompt = await this.getPrompt(user, key, auditContext)
        return {
          description: prompt.description,
          messages: prompt.messages,
        }
      }

      case 'tools/call':
        return this.handleJsonRpcToolCall(user, input.params ?? {}, auditContext)

      case 'resources/read':
        return this.handleJsonRpcResourceRead(user, input.params ?? {}, auditContext)

      default:
        throw new AppError(`Metodo MCP JSON-RPC nao suportado: ${input.method}`, 400, 'MCP_JSONRPC_METHOD_NOT_SUPPORTED')
    }
  }

  private async handleJsonRpcToolCall(user: JwtPayload, params: Record<string, unknown>, auditContext?: McpAuditContext) {
    const name = String(params.name ?? '').trim()
    const args = (params.arguments && typeof params.arguments === 'object')
      ? params.arguments as Record<string, unknown>
      : {}

    if (name === 'search_hosts') {
      const result = await this.searchHosts(user, {
        query: String(args.query ?? ''),
        ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'search_snippets') {
      const result = await this.searchSnippets(user, {
        query: String(args.query ?? ''),
        ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'start_host_investigation') {
      if (!this.investigations) throw new AppError('Investigações não disponíveis', 503, 'AI_INVESTIGATION_UNAVAILABLE')
      const host = await this.resolveOperationHost(user, typeof args.target === 'number' ? args.target : String(args.target ?? ''))
      const result = await this.investigations.start({ tenantId:user.tenantId,userId:Number(user.sub),hostId:host.id,tokenId:auditContext?.tokenId ?? null,objective:String(args.objective ?? ''),ttlMinutes:Number(args.ttlMinutes ?? 60) })
      return { content:[{type:'text',text:JSON.stringify(result)}], structuredContent:result }
    }
    if (name === 'get_host_investigation') {
      if (!this.investigations) throw new AppError('Investigações não disponíveis', 503, 'AI_INVESTIGATION_UNAVAILABLE')
      const result = await this.investigations.get(Number(args.investigationId), user.tenantId)
      return { content:[{type:'text',text:JSON.stringify(result)}], structuredContent:result }
    }
    if (name === 'complete_host_investigation') {
      if (!this.investigations) throw new AppError('Investigações não disponíveis', 503, 'AI_INVESTIGATION_UNAVAILABLE')
      if (args.confirmedByUser !== true) throw new AppError('Confirmação explícita obrigatória',400,'AI_INVESTIGATION_CONFIRMATION_REQUIRED')
      const array = (key:string) => { const value = args[key]; return Array.isArray(value) ? value.map(String) : [] }
      const result = await this.investigations.complete(Number(args.investigationId),user.tenantId,Number(user.sub),{ summary:String(args.summary ?? ''),facts:array('facts'),hypotheses:array('hypotheses'),risks:array('risks'),recommendations:array('recommendations'),actions:array('actions'),evidence:Array.isArray(args.evidence)?args.evidence.map((e:any)=>({actionRunId:Number(e.actionRunId),stepIds:Array.isArray(e.stepIds)?e.stepIds.map(String):[]})):[],provider:args.provider==null?null:String(args.provider),model:args.model==null?null:String(args.model),confirmedByUser:true })
      return { content:[{type:'text',text:JSON.stringify(result)}], structuredContent:result }
    }
    if (name === 'abandon_host_investigation') {
      if (!this.investigations) throw new AppError('Investigações não disponíveis', 503, 'AI_INVESTIGATION_UNAVAILABLE')
      if (args.confirmedByUser !== true) throw new AppError('Confirmação explícita obrigatória',400,'AI_INVESTIGATION_CONFIRMATION_REQUIRED')
      const result = await this.investigations.abandon(Number(args.investigationId),user.tenantId,Number(user.sub))
      return { content:[{type:'text',text:JSON.stringify(result)}], structuredContent:result }
    }

    if (name === 'get_action_run') {
      const result = await this.getActionRun(user, {
        runId: Number(args.runId),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'request_action_run') {
      const result = await this.requestActionRun(user, {
        hostId: Number(args.hostId),
        mode: String(args.mode ?? '') as 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access',
        channel: String(args.channel ?? '') as 'local_ai' | 'mcp' | 'integration' | 'internal',
        summary: String(args.summary ?? ''),
        ...(args.approvalReason !== undefined ? { approvalReason: args.approvalReason === null ? null : String(args.approvalReason) } : {}),
        steps: Array.isArray(args.steps)
          ? args.steps.map((step) => {
            const data = (step && typeof step === 'object') ? step as Record<string, unknown> : {}
            return {
              id: String(data.id ?? ''),
              label: String(data.label ?? ''),
              command: String(data.command ?? ''),
              timeoutSeconds: Number(data.timeoutSeconds),
            }
          })
          : [],
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'run_host_operation') {
      const result = await this.runHostOperation(user, {
        target: typeof args.target === 'number' ? args.target : String(args.target ?? ''),
        objective: String(args.objective ?? ''),
        mode: String(args.mode ?? '') as McpActionRunMode,
        ...(args.approvalReason !== undefined ? { approvalReason: args.approvalReason === null ? null : String(args.approvalReason) } : {}),
        ...(args.investigationId !== undefined ? { investigationId: args.investigationId === null ? null : Number(args.investigationId) } : {}),
        steps: Array.isArray(args.steps)
          ? args.steps.map((step) => {
            const data = (step && typeof step === 'object') ? step as Record<string, unknown> : {}
            return {
              id: String(data.id ?? ''),
              label: String(data.label ?? ''),
              command: String(data.command ?? ''),
              timeoutSeconds: Number(data.timeoutSeconds),
            }
          })
          : [],
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'evaluate_action_command_policy') {
      const result = await this.evaluateActionCommandPolicy(user, {
        command: String(args.command ?? ''),
        ...(args.mode !== undefined ? {
          mode: String(args.mode) as 'read_only' | 'diagnostic_only' | 'approval_required' | 'full_operational_access',
        } : {}),
        ...(Array.isArray(args.steps) ? {
          steps: args.steps.map((step) => {
            const data = (step && typeof step === 'object') ? step as Record<string, unknown> : {}
            return {
              id: String(data.id ?? ''),
              ...(data.label !== undefined ? { label: String(data.label) } : {}),
              command: String(data.command ?? ''),
            }
          }),
        } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'cancel_action_run') {
      const result = await this.cancelActionRun(user, {
        runId: Number(args.runId),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'approve_action_run') {
      const result = await this.approveActionRun(user, {
        runId: Number(args.runId),
        ...(args.approvalReason !== undefined ? { approvalReason: args.approvalReason === null ? null : String(args.approvalReason) } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'reject_action_run') {
      const result = await this.rejectActionRun(user, {
        runId: Number(args.runId),
        ...(args.approvalReason !== undefined ? { approvalReason: args.approvalReason === null ? null : String(args.approvalReason) } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'open_interactive_ssh_session') {
      const result = await this.openInteractiveSshSession(user, {
        hostId: Number(args.hostId),
        reason: String(args.reason ?? ''),
        ...(args.ttlSeconds !== undefined ? { ttlSeconds: Number(args.ttlSeconds) } : {}),
        ...(args.cols !== undefined ? { cols: Number(args.cols) } : {}),
        ...(args.rows !== undefined ? { rows: Number(args.rows) } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'write_interactive_ssh_session') {
      const result = await this.writeInteractiveSshSession(user, {
        sessionId: String(args.sessionId ?? ''),
        data: String(args.data ?? ''),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'read_interactive_ssh_session') {
      const result = await this.readInteractiveSshSession(user, {
        sessionId: String(args.sessionId ?? ''),
        ...(args.cursor !== undefined ? { cursor: Number(args.cursor) } : {}),
        ...(args.maxBytes !== undefined ? { maxBytes: Number(args.maxBytes) } : {}),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'resize_interactive_ssh_session') {
      const result = await this.resizeInteractiveSshSession(user, {
        sessionId: String(args.sessionId ?? ''),
        cols: Number(args.cols),
        rows: Number(args.rows),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    if (name === 'close_interactive_ssh_session') {
      const result = await this.closeInteractiveSshSession(user, {
        sessionId: String(args.sessionId ?? ''),
      }, auditContext)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }

    throw new AppError(`Tool MCP nao suportada: ${name}`, 400, 'MCP_JSONRPC_TOOL_NOT_SUPPORTED')
  }

  private async handleJsonRpcResourceRead(user: JwtPayload, params: Record<string, unknown>, auditContext?: McpAuditContext) {
    const uri = String(params.uri ?? '').trim()
    if (!uri) throw new AppError('URI MCP obrigatoria', 400, 'MCP_JSONRPC_URI_REQUIRED')

    const dashboardMatch = uri.match(/^nodeaccess:\/\/hosts\/(\d+)\/dashboard(?:\?periodDays=(7|15|30|60))?$/)
    if (dashboardMatch) {
      const data = await this.getHostDashboard(user, {
        hostId: Number(dashboardMatch[1]),
        ...(dashboardMatch[2] ? { periodDays: Number(dashboardMatch[2]) as 7 | 15 | 30 | 60 } : {}),
      }, auditContext)
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    }

    const hostRunsMatch = uri.match(/^nodeaccess:\/\/hosts\/(\d+)\/diagnostic-runs(?:\?(.*))?$/)
    if (hostRunsMatch) {
      const searchParams = new URLSearchParams(hostRunsMatch[2] ?? '')
      const data = await this.listHostDiagnosticRuns(user, {
        hostId: Number(hostRunsMatch[1]),
        ...(searchParams.get('status') ? { statuses: searchParams.get('status')!.split(',') } : {}),
        ...(searchParams.get('aiSummaryStatus') ? { aiSummaryStatuses: searchParams.get('aiSummaryStatus')!.split(',') } : {}),
      }, auditContext)
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    }

    const runMatch = uri.match(/^nodeaccess:\/\/diagnostic-runs\/(\d+)$/)
    if (runMatch) {
      const data = await this.getDiagnosticRun(user, {
        runId: Number(runMatch[1]),
      }, auditContext)
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    }

    const hostActionRunsMatch = uri.match(/^nodeaccess:\/\/hosts\/(\d+)\/ai-ssh-action-runs(?:\?(.*))?$/)
    if (hostActionRunsMatch) {
      const searchParams = new URLSearchParams(hostActionRunsMatch[2] ?? '')
      const data = await this.listHostActionRuns(user, {
        hostId: Number(hostActionRunsMatch[1]),
        ...(searchParams.get('status') ? { statuses: searchParams.get('status')!.split(',') } : {}),
        ...(searchParams.get('channel') ? { channels: searchParams.get('channel')!.split(',') } : {}),
        ...(searchParams.get('mode') ? { modes: searchParams.get('mode')!.split(',') } : {}),
      }, auditContext)
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    }

    const actionRunMatch = uri.match(/^nodeaccess:\/\/ai-ssh-action-runs\/(\d+)$/)
    if (actionRunMatch) {
      const data = await this.getActionRun(user, {
        runId: Number(actionRunMatch[1]),
      }, auditContext)
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }],
      }
    }

    throw new AppError(`Resource MCP nao suportado: ${uri}`, 400, 'MCP_JSONRPC_RESOURCE_NOT_SUPPORTED')
  }

  private promptTemplate(key: string): string {
    if (key === 'summarize_diagnostic_run') {
      return 'Resuma a execucao destacando risco, achados principais, evidencias objetivas e proximos passos recomendados.'
    }
    return 'Prompt MCP sem template especifico.'
  }

  private async resolveOperationHost(user: JwtPayload, target: string | number): Promise<{
    id: number
    name: string
    ip: string
    port: number
  }> {
    const raw = String(target).trim()
    if (!raw) throw new AppError('Host alvo obrigatorio', 400, 'MCP_OPERATION_TARGET_REQUIRED')

    const numericId = typeof target === 'number' || /^#?\d+$/.test(raw)
      ? Number(raw.replace(/^#/, ''))
      : null
    if (numericId !== null && Number.isInteger(numericId) && numericId > 0) {
      const host = await this.db.host.findFirst({
        where: { id: numericId, tenantId: user.tenantId, deletedAt: null },
        select: { id: true, name: true, ip: true, port: true },
      })
      if (!host) throw new AppError('Host alvo nao encontrado', 404, 'MCP_OPERATION_HOST_NOT_FOUND')
      const visible = await this.sshRepository.findHostIdsWithEffectivePermission(
        [host.id], user.tenantId, Number(user.sub), 'view', user.role === 'admin' ? 'ADMIN' : 'USER',
      )
      if (!visible.has(host.id)) throw new AppError('Host alvo nao encontrado', 404, 'MCP_OPERATION_HOST_NOT_FOUND')
      return host
    }

    const result = await this.searchHosts(user, { query: raw, limit: 20 })
    const normalized = raw.toLocaleLowerCase()
    const exact = result.items.filter((host) => (
      host.name.toLocaleLowerCase() === normalized || host.ip.toLocaleLowerCase() === normalized
    ))
    const matches = exact.length ? exact : result.items
    if (!matches.length) throw new AppError('Host alvo nao encontrado', 404, 'MCP_OPERATION_HOST_NOT_FOUND')
    if (matches.length > 1) {
      const candidates = matches.slice(0, 5).map((host) => `#${host.id} ${host.name} (${host.ip})`).join(', ')
      throw new AppError(`Host alvo ambiguo. Escolha um ID: ${candidates}`, 409, 'MCP_OPERATION_HOST_AMBIGUOUS')
    }
    const host = matches[0]!
    return { id: host.id, name: host.name, ip: host.ip, port: host.port }
  }

  private normalizeActionRunStatuses(input?: string[]): McpActionRunStatus[] {
    if (!input?.length) return []
    const normalized = input
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)

    const invalid = normalized.filter((value) => !ALLOWED_ACTION_RUN_STATUSES.includes(value as McpActionRunStatus))
    if (invalid.length) {
      throw new AppError(`Status de action run MCP nao suportado: ${invalid.join(', ')}`, 400, 'MCP_ACTION_RUN_STATUS_NOT_SUPPORTED')
    }

    return [...new Set(normalized)] as McpActionRunStatus[]
  }

  private normalizeDiagnosticRunStatuses(input?: string[]): McpDiagnosticRunStatus[] {
    if (!input?.length) return []
    const normalized = input
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)

    const invalid = normalized.filter((value) => !ALLOWED_DIAGNOSTIC_RUN_STATUSES.includes(value as McpDiagnosticRunStatus))
    if (invalid.length) {
      throw new AppError(`Status de diagnostico MCP nao suportado: ${invalid.join(', ')}`, 400, 'MCP_DIAGNOSTIC_RUN_STATUS_NOT_SUPPORTED')
    }

    return [...new Set(normalized)] as McpDiagnosticRunStatus[]
  }

  private normalizeDiagnosticAiSummaryStatuses(input?: string[]): McpDiagnosticAiSummaryStatus[] {
    if (!input?.length) return []
    const normalized = input
      .map((value) => String(value).trim().toUpperCase())
      .filter(Boolean)

    const invalid = normalized.filter((value) => !ALLOWED_DIAGNOSTIC_AI_SUMMARY_STATUSES.includes(value as McpDiagnosticAiSummaryStatus))
    if (invalid.length) {
      throw new AppError(`Status de resumo IA MCP nao suportado: ${invalid.join(', ')}`, 400, 'MCP_DIAGNOSTIC_AI_SUMMARY_STATUS_NOT_SUPPORTED')
    }

    return [...new Set(normalized)] as McpDiagnosticAiSummaryStatus[]
  }

  private normalizeActionRunChannels(input?: string[]): McpActionRunChannel[] {
    if (!input?.length) return []
    const normalized = input
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)

    const invalid = normalized.filter((value) => !ALLOWED_ACTION_RUN_CHANNELS.includes(value as McpActionRunChannel))
    if (invalid.length) {
      throw new AppError(`Canal de action run MCP nao suportado: ${invalid.join(', ')}`, 400, 'MCP_ACTION_RUN_CHANNEL_NOT_SUPPORTED')
    }

    return [...new Set(normalized)] as McpActionRunChannel[]
  }

  private normalizeActionRunModes(input?: string[]): McpActionRunMode[] {
    if (!input?.length) return []
    const normalized = input
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)

    const invalid = normalized.filter((value) => !ALLOWED_ACTION_RUN_MODES.includes(value as McpActionRunMode))
    if (invalid.length) {
      throw new AppError(`Modo de action run MCP nao suportado: ${invalid.join(', ')}`, 400, 'MCP_ACTION_RUN_MODE_NOT_SUPPORTED')
    }

    return [...new Set(normalized)] as McpActionRunMode[]
  }

  private async audit(
    user: JwtPayload,
    action: 'MCP_CAPABILITIES_LISTED' | 'MCP_RESOURCE_READ' | 'MCP_TOOL_CALLED',
    details: Record<string, unknown>,
    auditContext?: McpAuditContext,
  ): Promise<void> {
    await this.logRepository.logAdminEvent({
      adminId: Number(user.sub),
      action,
      targetType: 'MCP',
      targetId: 0,
      details: JSON.stringify({
        tenantId: user.tenantId,
        role: user.role,
        authMode: auditContext?.mode ?? 'jwt',
        ...(auditContext?.tokenId ? { tokenId: auditContext.tokenId } : {}),
        ...details,
      }),
    }).catch(() => {})
    if (this.interactions) {
      const capability = typeof details.capability === 'string' ? details.capability : action.toLowerCase()
      const correlationId = await this.interactions.record({
        tenantId: user.tenantId, userId: Number(user.sub), channel: 'mcp', purpose: capability,
        provider: 'mcp', model: 'json-rpc-2.0', routingPolicy: auditContext?.mode ?? 'jwt', status: 'succeeded',
        hostId: typeof details.hostId === 'number' ? details.hostId : null,
        tools: [capability], actionRunId: typeof details.runId === 'number' ? details.runId : null,
      }).catch(() => null)
      if (correlationId && typeof details.runId === 'number') {
        await this.interactions.linkArtifacts({ tenantId: user.tenantId, correlationId, actionRunId: details.runId }).catch(() => {})
      }
    }
  }
}
