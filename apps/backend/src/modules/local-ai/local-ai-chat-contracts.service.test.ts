import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../shared/crypto.js';
import { LocalAiService } from './local-ai.service.js';
import type { LocalAiStreamChunk } from './local-ai.service.js';
import type { LocalAiProviderChatInput } from './local-ai.provider.js';
const providers = vi.hoisted(() => ({ local: { chat: vi.fn(), stream: vi.fn() }, network: { chat: vi.fn(), stream: vi.fn() }, factory: vi.fn(), available: vi.fn() }));
vi.mock('../trials/trial-policy.js', () => ({ trialFeatureAvailable: providers.available }));
vi.mock('./providers/ollama.provider.js', () => ({ OllamaProvider: class {
        chat = providers.local.chat;
        chatStream = providers.local.stream;
    } }));
vi.mock('./providers/network-provider.factory.js', () => ({ createNetworkProvider: providers.factory }));
let nextTenant = 1000;
const dated = new Date('2026-01-01T00:00:00Z');
function setup(extra: Record<string, unknown> = {}, withInteractions = true) {
    const tenantId = ++nextTenant, key = encrypt('fixture-network-key');
    const user = { isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, sub: '9', tenantId, role: 'admin' as const, email: 'fixture@example.invalid', stage: 'authenticated' as const };
    const config = { localProvider: 'ollama', localBaseUrl: 'http://local.invalid:11434', localModel: 'fixture-local', networkProvider: 'openai_compatible', networkBaseUrl: 'https://network.invalid/v1', networkModel: 'fixture-network', networkApiKeyEncrypted: key.encrypted, networkApiKeyIv: key.iv, routingPolicy: 'local_only', healthStatus: 'healthy', lastCheckedAt: new Date().toISOString(), ...extra };
    const row = { enabled: true, config: JSON.stringify(config) };
    const integrations = { findByProvider: vi.fn().mockResolvedValue(row) };
    const entitlements = { requireFeature: vi.fn().mockResolvedValue(undefined), isFeatureEnabled: vi.fn().mockResolvedValue(true) };
    const platform = { tenantName: 'Fixture tenant', enabledModules: ['ssh'], visibleHosts: 2, activeSessions: 1 };
    const host = { id: 42, name: 'Fixture host', ip: '192.0.2.42', port: 22, sshUser: 'ops', scope: 'GLOBAL', connectionMode: 'DIRECT', groupName: 'Equipe', bastionName: 'Jump', operatingSystem: 'LINUX', recentSessions: [{ id: 51, userName: 'Fixture', startedAt: dated, active: true }] };
    const session = { id: 51, hostName: host.name, hostIp: host.ip, userName: 'Fixture', startedAt: dated, active: true };
    const audit = { sessionId: 51, hostName: host.name, hostIp: host.ip, status: 'recorded', riskLevel: 'low', summary: 'Fixture audit', ticketKey: 'OPS-1', ticketProvider: 'jira' };
    const tools = {
        getPlatformSnapshot: vi.fn().mockResolvedValue(platform), searchHosts: vi.fn().mockResolvedValue([host]), listRecentSessions: vi.fn().mockResolvedValue([session]), searchSessionAudits: vi.fn().mockResolvedValue([audit]),
        searchKnowledgeBase: vi.fn().mockResolvedValue([{ title: 'Fixture manual', excerpt: 'Relevant excerpt', referenceUrl: 'https://docs.example.invalid/' }]), getHostSummary: vi.fn().mockResolvedValue(host), getSessionSummary: vi.fn().mockResolvedValue(session), getTicketAuditSummary: vi.fn().mockResolvedValue(audit),
        getGroupSummary: vi.fn().mockResolvedValue({ id: 4, name: 'Equipe', bastionName: 'Jump', description: 'Fixture group', visibleHosts: [host] }), getBastionSummary: vi.fn().mockResolvedValue({ id: 5, name: 'Jump', ip: '192.0.2.5', port: 22, sshUser: 'jump', visibleHosts: [host], relatedGroups: ['Equipe'] }), getSessionAuditSummary: vi.fn().mockResolvedValue(audit),
    };
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) };
    const policy = { evaluate: vi.fn().mockResolvedValue({ risk: 'safe' }), evaluateMany: vi.fn().mockResolvedValue([]) };
    const usage = { record: vi.fn().mockResolvedValue({ estimatedUsdMicros: 15 }), reserveMonthlyRequest: vi.fn().mockResolvedValue({ allowed: true, used: 1, limit: 10 }), summarize: vi.fn().mockResolvedValue({ totals: { requests: 3 } }) };
    const interactions = { record: vi.fn().mockResolvedValue('correlation-fixture'), purgeExpired: vi.fn().mockResolvedValue(undefined), listRecent: vi.fn().mockResolvedValue([{ id: 'fixture-entry' }]) };
    const service = new LocalAiService(integrations as never, entitlements as never, tools as never, logs as never, policy as never, usage as never, withInteractions ? interactions as never : undefined);
    return { service, user, config, row, integrations, entitlements, platform, host, session, audit, tools, logs, policy, usage, interactions };
}
async function* stream(...tokens: string[]) { for (const token of tokens)
    yield await Promise.resolve(token); }
async function collect(source: AsyncGenerator<LocalAiStreamChunk>) { const chunks: LocalAiStreamChunk[] = []; for await (const chunk of source)
    chunks.push(chunk); return chunks; }
function prompt() { return providers.local.chat.mock.calls[0]![0] as LocalAiProviderChatInput; }
beforeEach(() => {
    vi.resetAllMocks();
    providers.available.mockResolvedValue(true);
    providers.local.chat.mockResolvedValue({ answer: 'Local answer', usage: { inputTokens: 10, outputTokens: 4 } });
    providers.network.chat.mockResolvedValue({ answer: 'Network answer' });
    providers.local.stream.mockImplementation(() => stream('one', 'two'));
    providers.network.stream.mockImplementation(() => stream('network'));
    providers.factory.mockReturnValue({ chat: providers.network.chat, chatStream: providers.network.stream });
});
describe('local AI chat context and accounting', () => {
    it('uses only selected tools and passes tenant scope without executing actions', async () => {
        const s = setup(), result = await s.service.chat(s.user, { message: '  olá  ' });
        expect(prompt().userMessage).toBe('olá');
        expect(prompt().systemPrompt).toContain('Fixture tenant');
        expect(s.tools.getPlatformSnapshot).toHaveBeenCalledWith(s.user);
        expect(s.tools.searchHosts).not.toHaveBeenCalled();
        expect(result).toMatchObject({ answer: 'Local answer', provider: 'ollama', mode: 'read_only', actionExecutionEnabled: false, guardrailMessage: null, correlationId: 'correlation-fixture' });
        expect(result.toolExecutions).toHaveLength(1);
        expect(result.toolExecutions![0]).toMatchObject({ key: 'platform_snapshot', status: 'executed' });
        expect(typeof result.toolExecutions![0]!.durationMs).toBe('number');
        expect(s.integrations.findByProvider).toHaveBeenCalledWith(s.user.tenantId, 'local_ai');
        expect(s.usage.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: s.user.tenantId, purpose: 'assistant_chat', usage: { inputTokens: 10, outputTokens: 4 } }));
        expect(s.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: s.user.tenantId, userId: 9, channel: 'assistant', status: 'succeeded', tools: ['platform_snapshot'], estimatedUsdMicros: 15 }));
    });
    it('builds authorized context and citations from each explicitly requested resource', async () => {
        const s = setup({ assistantInstructions: 'Use respostas curtas', mode: 'full_control' });
        const message = 'host 42, sessão 51, ticket OPS-1, grupo "Equipe", bastion "Jump", documentação';
        const result = await s.service.chat(s.user, { message, contextRoute: '/hosts', contextScreen: 'Hosts', terminalContext: { hostId: 42, sessionId: 51, hostName: ' Fixture  host ', hostIp: '192.0.2.42', connectionStatus: 'connected', selection: 'uptime', recentOutput: 'ready', bufferTail: 'tail' } });
        expect(s.tools.getHostSummary).toHaveBeenCalledWith(s.user, 42);
        expect(s.tools.getSessionSummary).toHaveBeenCalledWith(s.user, 51);
        expect(s.tools.getTicketAuditSummary).toHaveBeenCalledWith(s.user, 'OPS-1');
        expect(s.tools.getGroupSummary).toHaveBeenCalledWith(s.user, 'Equipe');
        expect(s.tools.getBastionSummary).toHaveBeenCalledWith(s.user, 'Jump');
        expect(result.toolExecutions).toHaveLength(11);
        expect(result.toolExecutions!.map(item => item.key)).toEqual([...result.toolExecutions!.map(item => item.key)].sort((a, b) => a.localeCompare(b)));
        expect(result.citations.map(item => item.label).join(' ')).toContain('Fixture manual');
        expect(prompt().systemPrompt).toContain('Use respostas curtas');
        expect(prompt().systemPrompt).toContain('Fixture audit');
        expect(prompt().systemPrompt).toContain('<terminal>uptime</terminal>');
        expect(result.guardrailMessage).toContain('sem executar ações');
        expect(result.actionExecutionEnabled).toBe(false);
        expect(s.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ channel: 'terminal', hostId: 42, sessionId: 51 }));
    });
    it('does not invent missing resource context or leak unrequested tool data', async () => {
        const s = setup();
        s.tools.getHostSummary.mockResolvedValue(null);
        s.tools.getSessionSummary.mockResolvedValue(null);
        s.tools.getSessionAuditSummary.mockResolvedValue(null);
        s.tools.searchHosts.mockResolvedValue([]);
        s.tools.listRecentSessions.mockResolvedValue([]);
        s.tools.searchSessionAudits.mockResolvedValue([]);
        const result = await s.service.chat(s.user, { message: 'host 42 sessão 51', terminalContext: { sessionId: -1, hostName: ' ', selection: '' } });
        expect(result.citations).toHaveLength(4);
        expect(prompt().systemPrompt).not.toContain('Fixture host');
        expect(s.tools.getBastionSummary).not.toHaveBeenCalled();
    });
    it('fails before contacting provider when a selected tool denies access', async () => {
        const s = setup();
        s.tools.getHostSummary.mockRejectedValue(new Error('scope denied'));
        await expect(s.service.chat(s.user, { message: 'host 42' })).rejects.toThrow('scope denied');
        expect(providers.local.chat).not.toHaveBeenCalled();
        expect(s.usage.record).not.toHaveBeenCalled();
    });
    it('requires platform context and rejects disabled/unconfigured/stale integration', async () => {
        const s = setup();
        s.tools.getPlatformSnapshot.mockResolvedValueOnce(null);
        await expect(s.service.chat(s.user, { message: 'hello' })).rejects.toThrow('contexto autorizado');
        s.row.enabled = false;
        await expect(s.service.chat(s.user, { message: 'hello' })).rejects.toThrow('não habilitado');
        s.row.enabled = true;
        s.row.config = '{broken';
        await expect(s.service.chat(s.user, { message: 'hello' })).rejects.toThrow('Nenhum provider');
        s.row.config = JSON.stringify({ ...s.config, lastCheckedAt: '2000-01-01T00:00:00Z' });
        await expect(s.service.chat(s.user, { message: 'hello' })).rejects.toThrow();
        expect(providers.local.chat).not.toHaveBeenCalled();
    });
    it('reserves tenant quota before provider call and denies exhausted budget even when audit fails', async () => {
        const s = setup({ monthlyRequestLimit: 10 });
        s.usage.reserveMonthlyRequest.mockResolvedValue({ allowed: false, used: 10, limit: 10 });
        s.logs.logAdminEvent.mockRejectedValue(new Error('audit unavailable'));
        await expect(s.service.chat(s.user, { message: 'hello' })).rejects.toMatchObject({ statusCode: 429 });
        expect(s.usage.reserveMonthlyRequest).toHaveBeenCalledWith(s.user.tenantId, 10);
        expect(providers.local.chat).not.toHaveBeenCalled();
    });
    it('supports quota allowance and missing optional interaction storage', async () => {
        const s = setup({ monthlyRequestLimit: 10 }, false);
        const result = await s.service.chat(s.user, { message: 'hello' });
        expect(s.usage.reserveMonthlyRequest).toHaveBeenCalledOnce();
        expect(result.correlationId).toBeNull();
        expect(s.interactions.record).not.toHaveBeenCalled();
    });
    it('keeps chat available when cost and interaction recording fail', async () => {
        const s = setup();
        s.usage.record.mockRejectedValue(new Error('usage unavailable'));
        s.interactions.record.mockRejectedValue(new Error('history unavailable'));
        expect((await s.service.chat(s.user, { message: 'hello' })).correlationId).toBeNull();
        expect(s.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ estimatedUsdMicros: null }));
    });
    it('passes decrypted network credentials only to provider factory', async () => {
        const s = setup({ routingPolicy: 'network_only' });
        const result = await s.service.chat(s.user, { message: 'hello' });
        expect(result.provider).toBe('openai_compatible');
        expect(result.answer).toBe('Network answer');
        expect(providers.factory).toHaveBeenCalledWith('openai_compatible', 'https://network.invalid/v1', 'fixture-network-key', s.user.tenantId);
        expect(JSON.stringify(s.logs.logAdminEvent.mock.calls)).not.toContain('fixture-network-key');
    });
    it('records failed routed attempts when all providers reject', async () => {
        const s = setup();
        providers.local.chat.mockRejectedValue(new Error('provider unavailable'));
        await expect(s.service.chat(s.user, { message: 'hello' })).rejects.toThrow('provider unavailable');
        expect(s.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', purpose: 'assistant_chat' }));
    });
});
describe('local AI streaming contracts', () => {
    it('emits ordered tokens then one completion with accounting and citation', async () => {
        const s = setup(), chunks = await collect(s.service.chatStream(s.user, { message: 'hello' }));
        expect(chunks.slice(0, 2)).toEqual([{ type: 'token', token: 'one' }, { type: 'token', token: 'two' }]);
        expect(chunks[2]).toMatchObject({ type: 'done', provider: 'ollama', actionExecutionEnabled: false, correlationId: 'correlation-fixture' });
        expect(chunks).toHaveLength(3);
        expect(s.usage.record).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'assistant_stream' }));
    });
    it('falls back only when first provider failed before emitting tokens', async () => {
        const s = setup({ routingPolicy: 'prefer_local' });
        providers.local.stream.mockImplementation(async function* () { await Promise.resolve(); throw new Error('offline'); yield 'unreachable'; });
        const chunks = await collect(s.service.chatStream(s.user, { message: 'hello' }));
        expect(chunks[0]).toEqual({ type: 'token', token: 'network' });
        expect(chunks[1]).toMatchObject({ type: 'done', provider: 'openai_compatible' });
        expect(s.usage.record).toHaveBeenCalledWith(expect.objectContaining({ attempts: [expect.objectContaining({ provider: 'ollama', status: 'failed' }), expect.objectContaining({ provider: 'openai_compatible', status: 'succeeded' })] }));
    });
    it('never switches provider after partial tokens, recording failure once', async () => {
        const s = setup({ routingPolicy: 'prefer_local' });
        providers.local.stream.mockImplementation(async function* () { yield await Promise.resolve('partial'); throw new Error('stream lost'); });
        const chunks = s.service.chatStream(s.user, { message: 'hello', terminalContext: { hostId: 42, sessionId: 51, recentOutput: 'context' } });
        await expect(chunks.next()).resolves.toMatchObject({ value: { type: 'token', token: 'partial' } });
        await expect(chunks.next()).rejects.toThrow('stream lost');
        expect(providers.network.stream).not.toHaveBeenCalled();
        expect(s.usage.record).toHaveBeenCalledOnce();
        expect(s.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', channel: 'terminal', hostId: 42, sessionId: 51 }));
    });
    it('surfaces final provider failure and audits both attempts when neither emits', async () => {
        const s = setup({ routingPolicy: 'prefer_network' });
        providers.local.stream.mockImplementation(async function* () { await Promise.resolve(); throw new Error('local offline'); yield ''; });
        providers.network.stream.mockImplementation(async function* () { await Promise.resolve(); throw new Error('network offline'); yield ''; });
        await expect(collect(s.service.chatStream(s.user, { message: 'hello' }))).rejects.toThrow('local offline');
        expect(s.interactions.record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'ollama', status: 'failed' }));
        expect((s.usage.record.mock.calls[0]![0] as {
            attempts: unknown[];
        }).attempts).toHaveLength(2);
    });
    it('passes abort signal to provider instead of swallowing cancellation', async () => {
        const s = setup(), controller = new AbortController();
        controller.abort(new Error('operator cancelled'));
        providers.local.stream.mockImplementation(async function* (input: LocalAiProviderChatInput) { await Promise.resolve(); input.signal?.throwIfAborted(); yield 'never'; });
        await expect(collect(s.service.chatStream(s.user, { message: 'hello' }, controller.signal))).rejects.toThrow('operator cancelled');
        expect(providers.local.stream).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    });
});
describe('local AI availability, usage and history', () => {
    it.each(['chat', 'stream', 'usage', 'history'])('blocks %s when installation feature unavailable', async (kind) => {
        const s = setup();
        providers.available.mockResolvedValue(false);
        const operation = kind === 'chat' ? s.service.chat(s.user, { message: 'hello' }) : kind === 'stream' ? collect(s.service.chatStream(s.user, { message: 'hello' })) : kind === 'usage' ? s.service.getUsageSummary(s.user) : s.service.getInteractions(s.user);
        await expect(operation).rejects.toThrow('desabilitado');
        expect(s.integrations.findByProvider).not.toHaveBeenCalled();
    });
    it('returns unavailable status for installation/license/missing or malformed integration', async () => {
        const s = setup();
        providers.available.mockResolvedValueOnce(false);
        expect(await s.service.getStatus(s.user)).toMatchObject({ available: false, enabled: false });
        s.entitlements.isFeatureEnabled.mockResolvedValueOnce(false);
        expect((await s.service.getStatus(s.user)).message).toContain('não licenciado');
        s.integrations.findByProvider.mockResolvedValueOnce(null);
        expect(await s.service.getStatus(s.user)).toMatchObject({ available: false, enabled: false, effectiveProvider: null });
        s.row.config = '{broken';
        expect((await s.service.getStatus(s.user)).effectiveProvider).toBeNull();
    });
    it('scopes usage summary and history, using configured retention and tolerating purge failure', async () => {
        const s = setup({ interactionRetentionDays: 14 });
        await expect(s.service.getUsageSummary(s.user, 7)).resolves.toEqual({ totals: { requests: 3 } });
        expect(s.usage.summarize).toHaveBeenCalledWith(s.user.tenantId, 7);
        s.interactions.purgeExpired.mockRejectedValue(new Error('purge offline'));
        await expect(s.service.getInteractions(s.user, 8)).resolves.toEqual({ items: [{ id: 'fixture-entry' }], retentionDays: 14 });
        expect(s.interactions.listRecent).toHaveBeenCalledWith(s.user.tenantId, 8);
        expect(s.entitlements.requireFeature).toHaveBeenCalledWith(s.user.tenantId, 'localAi', expect.any(String));
    });
    it('uses empty optional history and default retention when configuration absent', async () => {
        const s = setup({}, false);
        s.integrations.findByProvider.mockResolvedValue(null);
        await expect(s.service.getInteractions(s.user)).resolves.toEqual({ items: [], retentionDays: 30 });
    });
});
