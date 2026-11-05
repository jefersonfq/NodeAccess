import { describe, expect, it, vi } from 'vitest'
import { McpService } from './mcp.service.js'
import type { LogRepository } from '../logs/log.repository.js'
const admin = { sub: '7', email: 'fixture@example.invalid', role: 'admin' as const, isPlatformAdmin: false,
  tenantId: 3, canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, stage: 'authenticated' as const }
const user = { ...admin, role: 'user' as const }
const context = { mode: 'persisted_token' as const, tokenId: 12, allowedHostIds: [42] }
const host = { id: 42, name: 'Fixture', ip: '192.0.2.42', port: 22, sshUser: 'fixture', scope: 'GROUP', connectionMode: 'DIRECT', group: { name: 'Group' }, bastion: { name: 'Jump' } }
const run = { id: 91, hostId: 42, status: 'completed', mode: 'read_only', channel: 'mcp', steps: [] }
function fixture(withInvestigations = true) {
  const db = { host: { findMany: vi.fn().mockResolvedValue([host]), findFirst: vi.fn().mockResolvedValue(host) } }
  const dashboard = { getDashboard: vi.fn().mockResolvedValue({ hostId: 42, fixture: true }) }
  const diagnostic = { listForHost: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue({ id: 9, hostId: 42, status: 'completed' }) }
  const snippets = { list: vi.fn().mockResolvedValue([]) }
  const actions = { listForHost: vi.fn().mockResolvedValue([]), getById: vi.fn().mockResolvedValue(run),
    createRequestedRun: vi.fn().mockResolvedValue(run), cancel: vi.fn().mockResolvedValue(run), approve: vi.fn().mockResolvedValue(run), reject: vi.fn().mockResolvedValue(run) }
  const policy = { evaluate: vi.fn<(input: { tenantId: number; command: string }) => Promise<{ command: string; risk: 'safe' | 'blocked' | 'approval_required' }>>()
    .mockImplementation(input => Promise.resolve({ command: input.command.trim(), risk: 'safe' })) }
  const logs = { logAdminEvent: vi.fn<LogRepository['logAdminEvent']>().mockResolvedValue(undefined) }
  const interactive = { open: vi.fn().mockResolvedValue({ sessionId: 'fixture-session' }), write: vi.fn().mockResolvedValue({ acceptedBytes: 3 }),
    read: vi.fn().mockResolvedValue({ output: 'fixture' }), resize: vi.fn().mockResolvedValue({ cols: 100, rows: 30 }), close: vi.fn().mockResolvedValue({ closed: true }) }
  const ssh = { findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set([42])) }
  const interactions = { record: vi.fn().mockResolvedValue('correlation-fixture'), linkArtifacts: vi.fn().mockResolvedValue(undefined) }
  const investigations = { start: vi.fn().mockResolvedValue({ id: 55 }), get: vi.fn().mockResolvedValue({ id: 55, hostId: 42, status: 'OPEN' }),
    complete: vi.fn().mockResolvedValue({ id: 55, status: 'COMPLETED' }), abandon: vi.fn().mockResolvedValue({ id: 55, status: 'ABANDONED' }), attachRun: vi.fn().mockResolvedValue(undefined) }
  const service = new McpService(db as never, dashboard as never, diagnostic as never, snippets as never, actions as never,
    policy as never, logs as never, interactive as never, ssh as never, interactions as never, withInvestigations ? investigations as never : undefined)
  const tool = (name: string, args: Record<string, unknown> = {}) => service.handleJsonRpc(user, { method: 'tools/call', params: { name, arguments: args } }, context)
  const resource = (uri: string) => service.handleJsonRpc(user, { method: 'resources/read', params: { uri } }, context)
  return { service, db, dashboard, diagnostic, snippets, actions, policy, logs, interactive, ssh, interactions, investigations, tool, resource }
}

describe('MCP catalog and read contracts', () => {
  it('filters capability/tool/resource catalogs and retains investigation support only for operation capability', async () => {
    const f = fixture(), policy = { allowedCapabilities: ['run_host_operation'] }
    const capabilities = await f.service.listCapabilities(user, policy)
    expect(capabilities.actor).toEqual({ userId: 7, tenantId: 3, role: 'user' })
    expect(capabilities.capabilities.every(item => item.key === 'run_host_operation' || item.key.includes('host_investigation'))).toBe(true)
    expect((await f.service.listTools(user, { allowedCapabilities: ['search_hosts'] })).items.map(item => item.key)).toEqual(['search_hosts'])
    expect((await f.service.listResources(user, { allowedCapabilities: ['get_action_run'] })).items.map(item => item.key)).toEqual(['get_action_run'])
    expect((await f.service.listCapabilities(user)).capabilities.length).toBeGreaterThan(1)
  })
  it('searches only tenant/token host candidates and applies effective view permission before limit', async () => {
    const f = fixture(); f.db.host.findMany.mockResolvedValue([host, { ...host, id: 43 }, { ...host, id: 44 }]); f.ssh.findHostIdsWithEffectivePermission.mockResolvedValue(new Set([42, 44]))
    const result = await f.service.searchHosts(user, { query: ' Fixture ', limit: 1 }, context)
    expect(f.db.host.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 3, deletedAt: null, id: { in: [42] } }) as unknown, take: 50 }))
    expect(f.ssh.findHostIdsWithEffectivePermission).toHaveBeenCalledWith([42, 43, 44], 3, 7, 'view', 'USER')
    expect(result.items).toEqual([{ id: 42, name: 'Fixture', ip: '192.0.2.42', port: 22, sshUser: 'fixture', scope: 'group', connectionMode: 'direct', groupName: 'Group', bastionName: 'Jump' }])
    await f.service.searchHosts(admin, { query: 'fixture', limit: 1000 })
    expect(f.db.host.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200 }))
    await expect(f.service.searchHosts(user, { query: '   ' })).rejects.toMatchObject({ code: 'MCP_QUERY_REQUIRED' })
  })
  it('searches snippets by case-insensitive name/description/command without returning command bodies', async () => {
    const f = fixture(); f.snippets.list.mockResolvedValue([
      { id: 1, name: 'FIXTURE title', description: null, command: 'whoami', scope: 'USER', group: null },
      { id: 2, name: 'Other', description: 'fixture description', command: 'id', scope: 'GROUP', group: { name: 'G' } },
      { id: 3, name: 'Third', description: null, command: 'echo fixture', scope: 'GLOBAL', group: null },
      { id: 4, name: 'Unrelated', description: null, command: 'uptime', scope: 'USER', group: null },
    ])
    const result = await f.service.searchSnippets(user, { query: ' FiXtUrE ', limit: 2 }, context)
    expect(f.snippets.list).toHaveBeenCalledWith(7, 3)
    expect(result.items.map(item => item.id)).toEqual([1, 2])
    expect(result.items[0]).not.toHaveProperty('command')
    expect((await f.service.searchSnippets(user, { query: 'fixture' })).items).toHaveLength(3)
    await expect(f.service.searchSnippets(user, { query: '' })).rejects.toMatchObject({ code: 'MCP_QUERY_REQUIRED' })
  })
  it('maps resource URIs to scoped services and emits matching JSON content', async () => {
    const f = fixture()
    for (const uri of ['nodeaccess://hosts/42/dashboard', 'nodeaccess://hosts/42/dashboard?periodDays=7', 'nodeaccess://hosts/42/diagnostic-runs',
      'nodeaccess://diagnostic-runs/9', 'nodeaccess://hosts/42/ai-ssh-action-runs', 'nodeaccess://ai-ssh-action-runs/91']) {
      const result = await f.resource(uri) as { contents: Array<{ uri: string; mimeType: string; text: string }> }
      expect(result.contents).toHaveLength(1); expect(result.contents[0]).toMatchObject({ uri, mimeType: 'application/json' })
      expect(() => JSON.parse(result.contents[0]!.text) as unknown).not.toThrow()
    }
    expect(f.dashboard.getDashboard).toHaveBeenLastCalledWith({ hostId: 42, tenantId: 3, userId: 7, role: 'USER', periodDays: 7 })
    expect(f.diagnostic.getById).toHaveBeenCalledWith({ id: 9, tenantId: 3, userId: 7, role: 'USER' })
    expect(f.actions.getById).toHaveBeenCalledWith({ id: 91, tenantId: 3, userId: 7, role: 'USER' })
  })
  it('normalizes filters, deduplicates statuses and treats missing AI summary as NONE', async () => {
    const f = fixture()
    f.diagnostic.listForHost.mockResolvedValue([{ id: 1, status: 'completed', aiSummaryStatus: null }, { id: 2, status: 'failed', aiSummaryStatus: 'READY' }, { id: 3, status: 'completed', aiSummaryStatus: 'READY' }])
    expect((await f.service.listHostDiagnosticRuns(user, { hostId: 42, statuses: [' COMPLETED ', 'completed', ''], aiSummaryStatuses: [' none '] })).map(item => item.id)).toEqual([1])
    f.actions.listForHost.mockResolvedValue([{ ...run, id: 1 }, { ...run, id: 2, status: 'failed' }, { ...run, id: 3, channel: 'local_ai' }, { ...run, id: 4, mode: 'approval_required' }])
    const result = await f.resource('nodeaccess://hosts/42/ai-ssh-action-runs?status=COMPLETED,completed&channel=MCP&mOde=unused&mode=READ_ONLY') as { contents: Array<{ text: string }> }
    expect(JSON.parse(result.contents[0]!.text) as unknown).toEqual([{ ...run, id: 1 }])
    await f.resource('nodeaccess://hosts/42/diagnostic-runs?status=failed&aiSummaryStatus=ready')
    expect(f.logs.logAdminEvent.mock.calls.at(-1)![0].details).toContain('READY')
  })
  it.each([
    ['listHostDiagnosticRuns', { statuses: ['unknown'] }, 'MCP_DIAGNOSTIC_RUN_STATUS_NOT_SUPPORTED'],
    ['listHostDiagnosticRuns', { aiSummaryStatuses: ['unknown'] }, 'MCP_DIAGNOSTIC_AI_SUMMARY_STATUS_NOT_SUPPORTED'],
    ['listHostActionRuns', { statuses: ['unknown'] }, 'MCP_ACTION_RUN_STATUS_NOT_SUPPORTED'],
    ['listHostActionRuns', { channels: ['unknown'] }, 'MCP_ACTION_RUN_CHANNEL_NOT_SUPPORTED'],
    ['listHostActionRuns', { modes: ['unknown'] }, 'MCP_ACTION_RUN_MODE_NOT_SUPPORTED'],
  ] as const)('rejects unsupported %s filters before querying downstream', async (method, filters, code) => {
    const f = fixture()
    await expect(f.service[method](user, { hostId: 42, ...filters })).rejects.toMatchObject({ code })
    expect(f.actions.listForHost).not.toHaveBeenCalled(); expect(f.diagnostic.listForHost).not.toHaveBeenCalled()
  })
})

describe('MCP policies, privileged operations and audit', () => {
  it.each(['safe', 'approval_required', 'blocked'] as const)('evaluates plan risk %s without executing commands', async risk => {
    const f = fixture(); f.policy.evaluate.mockImplementation(input => Promise.resolve({ command: input.command, risk }))
    const result = await f.service.evaluateActionCommandPolicy(user, { mode: 'read_only', steps: [{ id: 'one', label: 'Step', command: 'fixture command' }] }, context)
    expect(result).toMatchObject({ maxRisk: risk, canRequest: risk === 'safe', blockedSteps: risk === 'blocked' ? ['one'] : [], approvalRequiredSteps: risk === 'approval_required' ? ['one'] : [] })
    expect(f.policy.evaluate).toHaveBeenCalledWith({ tenantId: 3, command: 'fixture command' })
    expect(f.actions.createRequestedRun).not.toHaveBeenCalled()
  })
  it.each(['approval_required', 'full_operational_access'] as const)('allows approval-risk plan request mode %s but does not execute it', async mode => {
    const f = fixture(); f.policy.evaluate.mockResolvedValue({ command: 'fixture', risk: 'approval_required' })
    expect(await f.service.evaluateActionCommandPolicy(admin, { mode, steps: [{ id: 'one', command: 'fixture' }] })).toMatchObject({ canRequest: true, recommendation: mode === 'full_operational_access' ? 'can_request' : 'use_approval_required' })
    expect(await f.tool('evaluate_action_command_policy', { command: 'fixture' })).toMatchObject({ structuredContent: { command: 'fixture', risk: 'approval_required' } })
  })
  it('rejects invalid evaluation mode and preserves admin-only approval/rejection', async () => {
    const f = fixture()
    await expect(f.service.evaluateActionCommandPolicy(user, { command: 'id', mode: 'invalid' as never })).rejects.toMatchObject({ code: 'MCP_ACTION_RUN_MODE_NOT_SUPPORTED' })
    await expect(f.service.approveActionRun(user, { runId: 91 })).rejects.toMatchObject({ code: 'MCP_ACTION_RUN_APPROVAL_FORBIDDEN' })
    await expect(f.service.rejectActionRun(user, { runId: 91 })).rejects.toMatchObject({ code: 'MCP_ACTION_RUN_REJECTION_FORBIDDEN' })
    expect(f.actions.approve).not.toHaveBeenCalled(); expect(f.actions.reject).not.toHaveBeenCalled()
  })
  it.each([['approve_action_run', 'approve'], ['reject_action_run', 'reject'], ['cancel_action_run', 'cancel']] as const)('dispatches %s with correct actor and explicit reason', async (tool, method) => {
    const f = fixture()
    const result = await f.service.handleJsonRpc(admin, { method: 'tools/call', params: { name: tool, arguments: { runId: '91', approvalReason: 'reviewed fixture' } } }, context)
    expect(result).toMatchObject({ structuredContent: run })
    expect(f.actions[method]).toHaveBeenCalledWith(expect.objectContaining({ id: 91, tenantId: 3, ...(method === 'cancel' ? { userId: 7, role: 'ADMIN' } : { adminId: 7, approvalReason: 'reviewed fixture' }) }))
    expect(f.interactions.linkArtifacts).toHaveBeenCalledWith({ tenantId: 3, correlationId: 'correlation-fixture', actionRunId: 91 })
  })
  it('keeps audit correlation scoped and tolerates audit/interactions failures without altering read result', async () => {
    const f = fixture()
    await f.service.getActionRun(user, { runId: 91 }, context)
    expect(f.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 3, userId: 7, channel: 'mcp', purpose: 'get_action_run', routingPolicy: 'persisted_token', hostId: 42, actionRunId: 91 }))
    const details = JSON.parse(f.logs.logAdminEvent.mock.calls[0]![0].details ?? '{}') as Record<string, unknown>
    expect(details).toMatchObject({ tenantId: 3, role: 'user', tokenId: 12, authMode: 'persisted_token' })
    f.logs.logAdminEvent.mockRejectedValue(new Error('audit unavailable')); f.interactions.record.mockRejectedValue(new Error('interaction unavailable'))
    await expect(f.service.getActionRun(user, { runId: 91 })).resolves.toEqual(run)
    f.interactions.record.mockResolvedValue('correlation'); f.interactions.linkArtifacts.mockRejectedValue(new Error('link unavailable'))
    await expect(f.service.getActionRun(user, { runId: 91 })).resolves.toEqual(run)
  })
})

describe('MCP protocol dispatch contracts', () => {
  it.each([
    ['open_interactive_ssh_session', 'open', { hostId: '42', reason: 'fixture', ttlSeconds: '60', cols: '100', rows: '30' }, { hostId: 42, reason: 'fixture', ttlSeconds: 60, cols: 100, rows: 30 }],
    ['write_interactive_ssh_session', 'write', { sessionId: 's', data: 'abc' }, { sessionId: 's', data: 'abc' }],
    ['read_interactive_ssh_session', 'read', { sessionId: 's', cursor: '4', maxBytes: '200' }, { sessionId: 's', cursor: 4, maxBytes: 200 }],
    ['resize_interactive_ssh_session', 'resize', { sessionId: 's', cols: '100', rows: '30' }, { sessionId: 's', cols: 100, rows: 30 }],
    ['close_interactive_ssh_session', 'close', { sessionId: 's' }, { sessionId: 's' }],
  ] as const)('dispatches %s preserving user/token context and normalized transport arguments', async (name, operation, args, expected) => {
    const f = fixture()
    const result = await f.tool(name, args) as { content: Array<{ text: string }>; structuredContent: unknown }
    expect(f.interactive[operation]).toHaveBeenCalledWith(user, expected, context)
    expect(JSON.parse(result.content[0]!.text) as unknown).toEqual(result.structuredContent)
  })
  it('preserves absent interactive optional arguments and propagates downstream denial', async () => {
    const f = fixture()
    await f.tool('open_interactive_ssh_session', { hostId: 42, reason: 'fixture' })
    expect(f.interactive.open).toHaveBeenCalledWith(user, { hostId: 42, reason: 'fixture' }, context)
    await f.tool('read_interactive_ssh_session', { sessionId: 's' })
    expect(f.interactive.read).toHaveBeenCalledWith(user, { sessionId: 's' }, context)
    f.interactive.write.mockRejectedValue(new Error('session outside actor scope'))
    await expect(f.tool('write_interactive_ssh_session', { sessionId: 'foreign', data: 'x' })).rejects.toThrow('outside actor scope')
  })
  it('dispatches typed searches, command policy plans and requested action DTOs through real adapters', async () => {
    const f = fixture()
    await f.tool('search_hosts', { query: 123, limit: '2' })
    expect(f.db.host.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([{ name: { contains: '123' } }]) as unknown }) as unknown }))
    await f.tool('search_snippets', { query: true, limit: '3' })
    await f.tool('request_action_run', { hostId: '42', mode: 'read_only', channel: 'mcp', summary: 'fixture', approvalReason: null,
      steps: [{ id: 'one', label: 'Step', command: 'id', timeoutSeconds: '30' }] })
    expect(f.actions.createRequestedRun).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 3, userId: 7, role: 'USER', mcpTokenId: 12,
      dto: { hostId: 42, mode: 'read_only', channel: 'mcp', summary: 'fixture', approvalReason: null, steps: [{ id: 'one', label: 'Step', command: 'id', timeoutSeconds: 30 }] } }))
    await f.tool('evaluate_action_command_policy', { mode: 'read_only', steps: [{ id: 'one', label: 'Step', command: ' id ' }, { id: 'two', command: 'pwd' }] })
    expect(f.policy.evaluate).toHaveBeenCalledWith({ tenantId: 3, command: ' id ' })
    expect(f.policy.evaluate).toHaveBeenCalledWith({ tenantId: 3, command: 'pwd' })
  })
  it('serves prompt descriptions and protocol negotiation with explicit capability filtering', async () => {
    const f = fixture()
    expect(await f.service.handleJsonRpc(user, { method: 'ping' })).toEqual({})
    expect(await f.service.handleJsonRpc(user, { method: 'initialize', params: { protocolVersion: '2025-03-26' } })).toMatchObject({ protocolVersion: '2025-03-26' })
    expect(await f.service.handleJsonRpc(user, { method: 'initialize' })).toMatchObject({ protocolVersion: '2025-06-18' })
    expect(f.service.listPrompts({ kind: 'tool' })).toEqual([])
    const prompts = f.service.listPrompts(); expect(prompts.length).toBeGreaterThan(0)
    const result = await f.service.handleJsonRpc(user, { method: 'prompts/get', params: { name: prompts[0]!.key } })
    expect(result).toMatchObject({ messages: [{ role: 'user', content: { type: 'text', text: prompts[0]!.template } }] })
    const filtered = await f.service.handleJsonRpc(user, { method: 'prompts/list' }, { allowedCapabilities: ['search_hosts'] })
    expect(filtered).toEqual({ prompts: [] })
    expect(await f.service.handleJsonRpc(user, { method: 'prompts/list' })).toMatchObject({ prompts: expect.any(Array) as unknown })
  })
  it.each([
    [{ method: 'unsupported' }, 'MCP_JSONRPC_METHOD_NOT_SUPPORTED'],
    [{ method: 'prompts/get' }, 'MCP_PROMPT_NAME_REQUIRED'],
    [{ method: 'prompts/get', params: { name: 'unsupported' } }, 'MCP_PROMPT_NOT_SUPPORTED'],
    [{ method: 'tools/call', params: { name: 'unsupported', arguments: null } }, 'MCP_JSONRPC_TOOL_NOT_SUPPORTED'],
    [{ method: 'resources/read' }, 'MCP_JSONRPC_URI_REQUIRED'],
    [{ method: 'resources/read', params: { uri: 'https://external.invalid/file' } }, 'MCP_JSONRPC_RESOURCE_NOT_SUPPORTED'],
    [{ method: 'resources/read', params: { uri: 'nodeaccess://hosts/42/dashboard?periodDays=90' } }, 'MCP_JSONRPC_RESOURCE_NOT_SUPPORTED'],
  ] as const)('rejects unsupported protocol request %j before operations', async (input, code) => {
    const f = fixture()
    await expect(f.service.handleJsonRpc(user, input)).rejects.toMatchObject({ code })
    expect(f.actions.createRequestedRun).not.toHaveBeenCalled(); expect(f.interactive.open).not.toHaveBeenCalled()
  })
})

describe('MCP investigation confirmation and report mapping', () => {
  it.each(['start_host_investigation', 'get_host_investigation', 'complete_host_investigation', 'abandon_host_investigation'])('refuses %s when optional service is unavailable', async name => {
    await expect(fixture(false).tool(name, { target: 42, investigationId: 55, confirmedByUser: true })).rejects.toMatchObject({ code: 'AI_INVESTIGATION_UNAVAILABLE' })
  })
  it.each(['complete_host_investigation', 'abandon_host_investigation'])('requires boolean confirmation for %s', async name => {
    const f = fixture()
    await expect(f.tool(name, { investigationId: 55, confirmedByUser: 'true' })).rejects.toMatchObject({ code: 'AI_INVESTIGATION_CONFIRMATION_REQUIRED' })
    expect(f.investigations.complete).not.toHaveBeenCalled(); expect(f.investigations.abandon).not.toHaveBeenCalled()
  })
  it('maps explicit report evidence and actor/tenant context without starting commands', async () => {
    const f = fixture()
    await f.tool('complete_host_investigation', { investigationId: '55', confirmedByUser: true, summary: 'fixture', facts: ['fact', 1], hypotheses: ['hypothesis'],
      risks: ['risk'], recommendations: ['recommendation'], actions: ['action'], evidence: [{ actionRunId: '91', stepIds: ['one', 2, true] }], provider: 'fixture', model: 'fixture-model' })
    expect(f.investigations.complete).toHaveBeenCalledWith(55, 3, 7, { summary: 'fixture', facts: ['fact', '1'], hypotheses: ['hypothesis'], risks: ['risk'], recommendations: ['recommendation'],
      actions: ['action'], evidence: [{ actionRunId: 91, stepIds: ['one', '2', 'true'] }], provider: 'fixture', model: 'fixture-model', confirmedByUser: true })
    await f.tool('abandon_host_investigation', { investigationId: 55, confirmedByUser: true })
    expect(f.investigations.abandon).toHaveBeenCalledWith(55, 3, 7)
    expect(f.actions.createRequestedRun).not.toHaveBeenCalled()
  })
  it.each([null, [], 'not-object'])('rejects malformed evidence %j before persisting report', async evidence => {
    const f = fixture()
    await expect(f.tool('complete_host_investigation', { investigationId: 55, confirmedByUser: true, evidence: [evidence] })).rejects.toMatchObject({ code: 'MCP_INVALID_ARGUMENT' })
    expect(f.investigations.complete).not.toHaveBeenCalled()
  })
})
