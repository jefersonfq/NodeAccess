import { describe, expect, it, vi } from 'vitest'
import { McpService } from './mcp.service.js'

const user = {
  sub: '7', email: 'operator@example.test', role: 'admin' as const, isPlatformAdmin: false,
  tenantId: 3, canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false,
  stage: 'authenticated' as const,
}

function createService(input: {
  host?: { id: number; name: string; ip: string; port: number } | null
  candidates?: Array<{ id: number; name: string; ip: string; port: number }>
  runStatus?: 'approved' | 'pending_approval'
} = {}) {
  const host = input.host === undefined ? { id: 42, name: 'API Produção', ip: '10.0.0.42', port: 22 } : input.host
  const candidates = input.candidates ?? []
  const db = {
    host: {
      findFirst: vi.fn().mockResolvedValue(host),
      findMany: vi.fn().mockResolvedValue(candidates.map((item) => ({
        ...item, sshUser: 'ops', scope: 'GLOBAL', connectionMode: 'DIRECT', group: null, bastion: null,
      }))),
    },
  }
  const aiSshActionService = {
    createRequestedRun: vi.fn().mockResolvedValue({
      id: 91, hostId: 42, mode: 'diagnostic_only', channel: 'mcp', status: input.runStatus ?? 'approved',
    }),
    getById: vi.fn().mockResolvedValue({
      id: 91, hostId: 42, mode: 'diagnostic_only', channel: 'mcp', status: 'completed', steps: [],
    }),
  }
  const sshRepository = {
    findHostIdsWithEffectivePermission: vi.fn().mockImplementation(async (ids: number[]) => new Set(ids)),
  }
  const logRepository = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const investigations = {
    start: vi.fn().mockResolvedValue({ ...investigation, status: 'OPEN', actionRuns: [], reports: [] }),
    get: vi.fn().mockResolvedValue({ ...investigation, status: 'WAITING_USER', actionRuns: [], reports: [] }),
    attachRun: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue({ ...investigation, status: 'COMPLETED' }),
    abandon: vi.fn().mockResolvedValue({ ...investigation, status: 'ABANDONED' }),
  }
  const service = new McpService(
    db as never, {} as never, {} as never, {} as never, aiSshActionService as never,
    {} as never, logRepository as never, {} as never, sshRepository as never, undefined,
    investigations as never,
  )
  return { service, db, aiSshActionService, sshRepository, investigations }
}

const steps = [{ id: 'load', label: 'Coletar carga', command: 'uptime', timeoutSeconds: 30 }]
const investigation = {
  id: 12, tenantId: 3, hostId: 42, hostName: 'API Produção', hostIp: '10.0.0.42', requestedById: 7,
  requestedByName: 'Operador', mcpTokenId: 88, mcpTokenName: 'governado', objective: 'Investigar carga',
  expiresAt: new Date(), lastActivityAt: new Date(), closedAt: null, closeReason: null, createdAt: new Date(),
}

describe('McpService.runHostOperation', () => {
  it('publica resources conforme o protocolo MCP e expõe acompanhamento como ferramenta', async () => {
    const { service } = createService()
    const resources = await service.handleJsonRpc(user, { method: 'resources/list' }) as { resources: unknown[] }
    const templates = await service.handleJsonRpc(user, { method: 'resources/templates/list' }) as {
      resourceTemplates: Array<{ name: string; uriTemplate: string }>
    }
    const tools = await service.handleJsonRpc(user, { method: 'tools/list' }, {
      allowedCapabilities: ['get_action_run'],
    }) as { tools: Array<{ name: string }> }

    expect(resources.resources).toEqual([])
    expect(templates.resourceTemplates).toContainEqual(expect.objectContaining({
      name: 'get_action_run',
      uriTemplate: 'nodeaccess://ai-ssh-action-runs/{runId}',
    }))
    expect(tools.tools).toEqual([expect.objectContaining({ name: 'get_action_run' })])

    const result = await service.handleJsonRpc(user, {
      method: 'tools/call',
      params: { name: 'get_action_run', arguments: { runId: 91 } },
    }, { allowedCapabilities: ['get_action_run'] }) as { structuredContent: { id: number; status: string } }
    expect(result.structuredContent).toMatchObject({ id: 91, status: 'completed' })
  })

  it('publica instruções orientadas a objetivo e filtra a ferramenta pela allowlist do token', async () => {
    const { service } = createService()
    const initialized = await service.handleJsonRpc(user, { method: 'initialize' }, {
      allowedActionModes: ['full_operational_access'],
    }) as { instructions: string }
    const listed = await service.handleJsonRpc(user, { method: 'tools/list' }, {
      allowedCapabilities: ['run_host_operation'],
    }) as { tools: Array<{ name: string; annotations: { destructiveHint: boolean } }> }

    expect(initialized.instructions).toContain('Use start_host_investigation')
    expect(initialized.instructions).toContain('confirmação explícita')
    expect(initialized.instructions).toContain('read_only, diagnostic_only, approval_required, full_operational_access')
    expect(listed.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'run_host_operation',
        annotations: expect.objectContaining({ destructiveHint: true }),
      }),
      expect.objectContaining({ name: 'start_host_investigation' }),
      expect.objectContaining({ name: 'complete_host_investigation' }),
    ]))
  })

  it('resolve o ID, cria ActionRun MCP e retorna orientação governada', async () => {
    const { service, aiSshActionService } = createService()

    const result = await service.runHostOperation(user, {
      target: 42,
      objective: 'Diagnosticar load alto sem processo dominante',
      mode: 'diagnostic_only',
      steps,
    }, { allowedActionModes: ['diagnostic_only'], allowedHostIds: [42] })

    expect(aiSshActionService.createRequestedRun).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 3,
      userId: 7,
      dto: expect.objectContaining({ hostId: 42, channel: 'mcp', mode: 'diagnostic_only', steps }),
    }))
    expect(result.target).toEqual({ id: 42, name: 'API Produção', ip: '10.0.0.42', port: 22 })
    expect(result.governance.requiresApproval).toBe(false)
    expect(result.governance.actionRunPath).toBe('/ai-ssh-action-runs/91')
    expect(result.governance.actionRunResource).toBe('nodeaccess://ai-ssh-action-runs/91')
  })

  it('orienta o agente a abrir a tela exata quando aguarda aprovação', async () => {
    const { service } = createService({ runStatus: 'pending_approval' })

    const result = await service.runHostOperation(user, {
      target: 42,
      objective: 'Revisar firewall',
      mode: 'approval_required',
      approvalReason: 'Revisão solicitada pelo operador',
      steps,
    }, { allowedActionModes: ['approval_required'], allowedHostIds: [42] })

    expect(result.governance).toMatchObject({
      status: 'pending_approval',
      requiresApproval: true,
      actionRunPath: '/ai-ssh-action-runs/91',
    })
    expect(result.governance.nextAction).toContain('/ai-ssh-action-runs/91')
    expect(result.governance.nextAction).toContain('aprovar ou rejeitar')
  })

  it('aceita diagnóstico de menor risco com token full operational', async () => {
    const { service, aiSshActionService } = createService()

    await service.runHostOperation(user, {
      target: 42,
      objective: 'Consultar uso de disco',
      mode: 'diagnostic_only',
      steps,
    }, { allowedActionModes: ['full_operational_access'], allowedHostIds: [42] })

    expect(aiSshActionService.createRequestedRun).toHaveBeenCalledOnce()
  })

  it('audita origem, ator, token, instrução sanitizada e hashes do plano', async () => {
    const { service } = createService()
    const logRepository = (service as unknown as { logRepository: { logAdminEvent: ReturnType<typeof vi.fn> } }).logRepository

    await service.runHostOperation(user, {
      target: 42,
      objective: 'Validar CSV token=na_mcp_secret',
      mode: 'diagnostic_only',
      steps,
    }, { mode: 'persisted_token', tokenId: 88, allowedActionModes: ['diagnostic_only'], allowedHostIds: [42] })

    const requestLog = logRepository.logAdminEvent.mock.calls
      .map(([entry]) => entry)
      .find((entry) => JSON.parse(entry.details).capability === 'request_action_run')
    const details = JSON.parse(requestLog.details)
    expect(requestLog.adminId).toBe(7)
    expect(details).toMatchObject({
      tokenId: 88,
      authMode: 'persisted_token',
      instructionSource: 'mcp_agent',
      requestedByUserId: 7,
      instructionSummary: 'Validar CSV token=[redacted]',
      commandCount: 1,
    })
    expect(details.commandEvidence[0]).toMatchObject({ stepId: 'load', label: 'Coletar carga' })
    expect(details.commandEvidence[0].commandSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(requestLog.details).not.toContain('na_mcp_secret')
    expect(requestLog.details).not.toContain('uptime')
  })

  it('nega modo e host fora das restrições do token antes de criar execução', async () => {
    const { service, aiSshActionService } = createService()

    await expect(service.runHostOperation(user, {
      target: 42, objective: 'Corrigir serviço', mode: 'full_operational_access', steps,
    }, { allowedActionModes: ['diagnostic_only'], allowedHostIds: [42] })).rejects.toMatchObject({
      code: 'MCP_ACTION_RUN_MODE_DENIED', statusCode: 403,
    })

    await expect(service.runHostOperation(user, {
      target: 42, objective: 'Coletar carga', mode: 'diagnostic_only', steps,
    }, { allowedActionModes: ['diagnostic_only'], allowedHostIds: [99] })).rejects.toMatchObject({
      code: 'MCP_HOST_DENIED', statusCode: 403,
    })
    expect(aiSshActionService.createRequestedRun).not.toHaveBeenCalled()
  })

  it('não escolhe automaticamente quando uma busca textual é ambígua', async () => {
    const { service, aiSshActionService } = createService({
      candidates: [
        { id: 11, name: 'API Azul', ip: '10.0.0.11', port: 22 },
        { id: 12, name: 'API Verde', ip: '10.0.0.12', port: 22 },
      ],
    })

    await expect(service.runHostOperation(user, {
      target: 'API', objective: 'Diagnosticar carga', mode: 'diagnostic_only', steps,
    })).rejects.toMatchObject({ code: 'MCP_OPERATION_HOST_AMBIGUOUS', statusCode: 409 })
    expect(aiSshActionService.createRequestedRun).not.toHaveBeenCalled()
  })

  it('mantém contexto entre execuções curtas e só conclui após confirmação explícita', async () => {
    const { service, aiSshActionService, investigations } = createService()
    const allowedCapabilities = ['run_host_operation']
    const started = await service.handleJsonRpc(user, {
      method: 'tools/call', params: { name: 'start_host_investigation', arguments: { target: 42, objective: 'Investigar carga', ttlMinutes: 60 } },
    }, { allowedCapabilities, tokenId: 88 }) as { structuredContent: { id: number } }
    expect(started.structuredContent.id).toBe(12)

    await service.handleJsonRpc(user, {
      method: 'tools/call', params: { name: 'run_host_operation', arguments: {
        target: 42, investigationId: 12, objective: 'Coletar carga', mode: 'diagnostic_only', steps,
      } },
    }, { allowedCapabilities, allowedActionModes: ['diagnostic_only'], tokenId: 88 })
    expect(aiSshActionService.createRequestedRun).toHaveBeenCalledWith(expect.objectContaining({ investigationId: 12 }))
    expect(investigations.attachRun).toHaveBeenCalledWith(12, 91, 3)

    await expect(service.handleJsonRpc(user, {
      method: 'tools/call', params: { name: 'complete_host_investigation', arguments: { investigationId: 12, summary: 'Concluído', confirmedByUser: false } },
    }, { allowedCapabilities })).rejects.toMatchObject({ code: 'AI_INVESTIGATION_CONFIRMATION_REQUIRED' })

    await service.handleJsonRpc(user, {
      method: 'tools/call', params: { name: 'complete_host_investigation', arguments: {
        investigationId: 12, summary: 'Concluído', facts: ['Carga normal'], evidence: [{ actionRunId: 91, stepIds: ['load'] }], confirmedByUser: true,
      } },
    }, { allowedCapabilities })
    expect(investigations.complete).toHaveBeenCalledWith(12, 3, 7, expect.objectContaining({ confirmedByUser: true }))
  })
})
