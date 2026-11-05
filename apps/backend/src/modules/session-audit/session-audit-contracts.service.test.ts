import { describe, it, expect, vi } from 'vitest';
import { SessionAuditService } from './session-audit.service.js';
import type { SessionAuditRow } from './session-audit.repository.js';
const baseTime = Date.parse('2026-11-03T00:00:00Z');
const time = (milliseconds: number) => new Date(baseTime + milliseconds);
const summary = { summary: 'Fixture observation', riskLevel: 'low', keyFindings: ['Observed command'], nextActions: ['Review evidence'], confidence: 'high', observedFacts: [], hypotheses: [], evidenceCommandIndexes: [1] };
type Command = {
    command: string;
    output?: string;
    actor?: number | null;
};
function recording(commands: Command[]) {
    let seq = 0;
    const lines: string[] = [];
    const event = (type: string, data?: string, actorUserId?: number | null) => { seq++; lines.push(JSON.stringify({ seq, ts: time(seq * 100).toISOString(), type, payload: { ...(data !== undefined ? { data } : {}), ...(actorUserId !== undefined ? { actorUserId } : {}) } }) + '\n'); };
    event('session_started');
    event('stdout', 'fixture$ ');
    for (const entry of commands) {
        event('stdin', entry.command + '\r', entry.actor === undefined ? 9 : entry.actor);
        event('stdout', (entry.output ?? 'ok') + '\r\nfixture$ ');
    }
    event('session_ended');
    return lines.join('');
}
function setup(options: {
    commands?: Command[];
    ai?: boolean;
    integration?: boolean;
    shared?: boolean;
    aiRepo?: boolean;
} = {}) {
    const row: SessionAuditRow = { sessionId: 42, tenantId: 1, userId: 9, userNameSnapshot: 'Owner', userEmailSnapshot: 'owner@fixture.invalid', hostId: 10, hostNameSnapshot: 'Fixture host', hostIpSnapshot: 'fixture.internal', hostDeleted: 0, hostDeletedAt: null, connectionMethod: 'direct', routeSnapshotJson: '{"kind":"direct"}', clientIp: null, userAgent: null, agentRemoteIp: null, ticketProvider: null, ticketKey: null, ticketUrl: null, startedAt: time(0), endedAt: time(10000), status: 'COMPLETED', chunkCount: 1, commandCount: 2, bytesIn: 12n, bytesOut: 24n, aiSummaryStatus: 'READY', aiSummaryText: 'Fixture summary', aiSummaryJson: JSON.stringify(summary), aiRiskLevel: 'low' };
    const chunks = new Map([['fixture-chunk', recording(options.commands ?? [{ command: 'echo first' }, { command: 'echo second' }])]]);
    const repo = { findAll: vi.fn((tenantId: number, _filters: unknown) => Promise.resolve({ rows: tenantId === 1 ? [row] : [], total: tenantId === 1 ? 1 : 0 })), findBySessionId: vi.fn((tenantId: number, sessionId: number) => Promise.resolve(tenantId === 1 && sessionId === 42 ? row : null)), listChunks: vi.fn(() => Promise.resolve([{ seq: 1, storageKey: 'fixture-chunk' }])), linkTicket: vi.fn((ticket: {
            ticketProvider: string;
            ticketKey: string;
            ticketUrl: string;
        }) => { Object.assign(row, ticket); return Promise.resolve(); }), repairOrphanedRunningSessions: vi.fn().mockResolvedValue(3) };
    const storage = { readChunk: vi.fn((key: string) => { const content = chunks.get(key); if (content === undefined)
            return Promise.reject(new Error('fixture storage unavailable')); return Promise.resolve(content); }) };
    const aiRepo = { listBySessionId: vi.fn().mockResolvedValue([]), listArtifactsBySessionId: vi.fn().mockResolvedValue([]) };
    const ai = { scheduleManualSummary: vi.fn().mockResolvedValue(undefined) }, integration = { getJiraTicket: vi.fn().mockResolvedValue({ key: 'OPS-7', url: 'https://jira.fixture.invalid/browse/OPS-7' }) };
    const shared = { findBySessionId: vi.fn().mockResolvedValue(null), findParticipants: vi.fn().mockResolvedValue([]), findControlLeases: vi.fn().mockResolvedValue([]) };
    const service = new SessionAuditService(repo as never, storage as never, options.aiRepo === false ? undefined : aiRepo as never, options.ai === false ? undefined : ai as never, options.integration === false ? undefined : integration as never, options.shared === false ? undefined : shared as never);
    return { row, repo, storage, chunks, aiRepo, ai, integration, shared, service };
}
describe('SessionAuditService public contracts', () => {
    it('lists scoped metadata with defaults, number conversion and no private fields or chunk reads', async () => {
        const s = setup();
        Object.assign(s.row, { internalStorageKey: 'must-not-leak' });
        s.row.hostDeleted = 1;
        s.row.commandCount = null;
        const result = await s.service.list(1, {});
        expect(result).toMatchObject({ total: 1, page: 1, limit: 20, data: [{ sessionId: 42, hostDeleted: true, commandCount: 0, bytesIn: 12, bytesOut: 24, routeSnapshot: { kind: 'direct' }, aiSummaryStructured: summary, sharedSessionContext: null, criticalEvents: [] }] });
        expect(result.data[0]).not.toHaveProperty('internalStorageKey');
        expect(result.data[0]).not.toHaveProperty('routeSnapshotJson');
        expect(s.storage.readChunk).not.toHaveBeenCalled();
        expect(s.repo.findAll).toHaveBeenCalledWith(1, {});
        const page = await s.service.list(1, { page: 2, limit: 5, search: 'fixture' });
        expect(page).toMatchObject({ page: 2, limit: 5 });
        expect(s.repo.findAll).toHaveBeenLastCalledWith(1, { page: 2, limit: 5, search: 'fixture' });
        expect((await s.service.list(2, {})).data).toEqual([]);
    });
    it.each([null, 'broken', '[]', '"text"', 'null', '42'])('does not expose invalid route metadata %s', async (route) => { const s = setup(); s.row.routeSnapshotJson = route; s.row.aiSummaryJson = route === 'broken' ? 'broken' : null; const result = await s.service.list(1, {}); expect(result.data[0]!.routeSnapshot).toBeNull(); expect(result.data[0]!.aiSummaryStructured).toBeNull(); });
    it.each(['get', 'download', 'preview', 'commands', 'stats', 'jobs', 'artifacts', 'retry', 'jira', 'transcript'] as const)('rejects another tenant before private storage/providers in %s', async (operation) => {
        const s = setup();
        const actions = { get: () => s.service.getBySessionId(2, 42), download: () => s.service.download(2, 42), preview: () => s.service.preview(2, 42), commands: () => s.service.commands(2, 42), stats: () => s.service.commandStats(2, 42), jobs: () => s.service.jobs(2, 42), artifacts: () => s.service.artifacts(2, 42), retry: () => s.service.retrySummary(2, 42, 9, 'summary-v1'), jira: () => s.service.linkJiraTicket(2, 42, 'OPS-7'), transcript: () => s.service.transcript(2, 42) };
        await expect(actions[operation]()).rejects.toMatchObject({ statusCode: 404, code: 'SESSION_AUDIT_NOT_FOUND' });
        expect(s.repo.listChunks).not.toHaveBeenCalled();
        expect(s.storage.readChunk).not.toHaveBeenCalled();
        expect(s.ai.scheduleManualSummary).not.toHaveBeenCalled();
        expect(s.integration.getJiraTicket).not.toHaveBeenCalled();
        expect(s.shared.findParticipants).not.toHaveBeenCalled();
    });
    it('downloads chunks in repository order and propagates unavailable storage', async () => {
        const s = setup();
        s.repo.listChunks.mockResolvedValue([{ seq: 1, storageKey: 'one' }, { seq: 2, storageKey: 'two' }]);
        s.chunks.set('one', 'first\n');
        s.chunks.set('two', 'second\n');
        await expect(s.service.download(1, 42)).resolves.toEqual({ filename: 'session-audit-42.jsonl', content: 'first\nsecond\n' });
        expect(s.storage.readChunk.mock.calls.map(([key]) => key)).toEqual(['one', 'two']);
        s.chunks.delete('two');
        await expect(s.service.download(1, 42)).rejects.toThrow('fixture storage unavailable');
    });
    it('reconstructs actual JSONL once across preview, commands and AI context', async () => {
        const s = setup({ commands: [{ command: 'echo first' }, { command: 'chmod 600 /fixture/config' }] });
        const preview = await s.service.preview(1, 42, 2);
        expect(preview.map(event => event.type)).toEqual(['stdout', 'session_ended']);
        const commands = await s.service.commands(1, 42, 1);
        expect(commands.map(command => command.command)).toEqual(['chmod 600 /fixture/config']);
        const context = await s.service.buildAiSummaryContext(1, 42);
        expect(context.session.sessionId).toBe(42);
        expect(context.commands.map(command => command.command)).toEqual(['echo first', 'chmod 600 /fixture/config']);
        expect(context.preview).toHaveLength(7);
        expect(context.criticalEvents).toEqual([expect.objectContaining({ type: 'permission_change', commandIndex: 2 })]);
        expect(s.storage.readChunk).toHaveBeenCalledOnce();
    });
    it.each(['terminal', 'technical', 'commands'] as const)('exports actual %s transcript without executing terminal escapes', async (format) => {
        const s = setup({ commands: [{ command: 'echo fixture-safe', output: 'echo fixture-safe\r\nação\r\n\x1b[31mfixture output\x1b[0m' }] });
        const result = await s.service.transcript(1, 42, format);
        expect(result.filename).toBe(`session-audit-42${format === 'terminal' ? '' : `-${format}`}.txt`);
        expect(result.content).toContain('echo fixture-safe');
        if (format === 'commands') expect(result.content).not.toContain('fixture output');
        else expect(result.content).toContain('fixture output');
        expect(result.content).not.toContain('\x1b');
        expect(s.repo.findBySessionId.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    it.each(['purged', 'moved', 'deleted'])('revalidates retention/scope after rendering: %s', async (change) => {
        const s = setup();
        let calls = 0;
        s.repo.findBySessionId.mockImplementation(() => { calls++; if (calls < 3)
            return Promise.resolve(s.row); return Promise.resolve(change === 'deleted' ? null : { ...s.row, ...(change === 'purged' ? { status: 'PURGED' as const } : { tenantId: 2 }) }); });
        await expect(s.service.transcript(1, 42, 'technical')).rejects.toMatchObject({ code: change === 'purged' ? 'SESSION_AUDIT_PURGED' : 'SESSION_AUDIT_NOT_FOUND' });
        expect(s.storage.readChunk).toHaveBeenCalledOnce();
    });
    it('repairs orphaned sessions and does not hide repository failure', async () => { const s = setup(); await expect(s.service.repairOrphanedRunningSessions()).resolves.toBe(3); s.repo.repairOrphanedRunningSessions.mockRejectedValueOnce(new Error('fixture DB offline')); await expect(s.service.repairOrphanedRunningSessions()).rejects.toThrow('fixture DB offline'); });
});
describe('audit AI and issue linkage contracts', () => {
    it('projects public job fields only, with tenant-scoped lookup', async () => {
        const s = setup();
        s.aiRepo.listBySessionId.mockResolvedValue([{ id: 3, sessionId: 42, tenantId: 1, requestedByUserId: 9, kind: 'SUMMARY', triggerSource: 'manual', provider: 'local', model: 'fixture-model', status: 'COMPLETED', promptVersion: 'summary-v1', errorMessage: null, startedAt: time(0), finishedAt: time(1), createdAt: time(0), updatedAt: time(1), rawPrompt: 'must-not-leak' }]);
        const result = await s.service.jobs(1, 42);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ id: 3, tenantId: 1, sessionId: 42, model: 'fixture-model', status: 'COMPLETED' });
        expect(result[0]).not.toHaveProperty('rawPrompt');
        expect(s.aiRepo.listBySessionId).toHaveBeenCalledWith(1, 42);
        await expect(setup({ aiRepo: false }).service.jobs(1, 42)).resolves.toEqual([]);
    });
    it('parses artifact summaries, retaining malformed-summary absence and hiding internal response', async () => {
        const s = setup();
        s.aiRepo.listArtifactsBySessionId.mockResolvedValue([{ id: 4, sessionId: 42, jobId: 3, triggerSource: 'manual', template: 'summary-v1', summaryText: 'fixture', summaryJson: JSON.stringify(summary), riskLevel: 'low', createdAt: time(0), rawModelResponse: 'must-not-leak' }, { id: 5, summaryJson: 'broken' }]);
        const result = await s.service.artifacts(1, 42);
        expect(result[0]).toMatchObject({ id: 4, summaryStructured: summary });
        expect(result[0]).not.toHaveProperty('rawModelResponse');
        expect(result[1]!.summaryStructured).toBeNull();
        expect(s.aiRepo.listArtifactsBySessionId).toHaveBeenCalledWith(1, 42);
        await expect(setup({ aiRepo: false }).service.artifacts(1, 42)).resolves.toEqual([]);
    });
    it('requires completed session and available AI before scheduling an attributed summary', async () => {
        const s = setup();
        s.row.status = 'RUNNING';
        await expect(s.service.retrySummary(1, 42, 19, 'cab-v1')).rejects.toMatchObject({ code: 'SESSION_AUDIT_NOT_COMPLETED' });
        expect(s.ai.scheduleManualSummary).not.toHaveBeenCalled();
        await expect(setup({ ai: false }).service.retrySummary(1, 42, 19, 'cab-v1')).rejects.toMatchObject({ code: 'SESSION_AUDIT_AI_UNAVAILABLE' });
        s.row.status = 'COMPLETED';
        await s.service.retrySummary(1, 42, 19, 'risk-v1');
        expect(s.ai.scheduleManualSummary).toHaveBeenCalledWith(42, 1, 19, 'risk-v1');
        s.ai.scheduleManualSummary.mockRejectedValueOnce(new Error('fixture queue offline'));
        await expect(s.service.retrySummary(1, 42, 19, 'summary-v1')).rejects.toThrow('fixture queue offline');
    });
    it('links canonical ticket data only after provider validation and returns refreshed audit', async () => {
        const s = setup();
        const result = await s.service.linkJiraTicket(1, 42, 'ops-7');
        expect(s.integration.getJiraTicket).toHaveBeenCalledWith(1, 'ops-7');
        expect(s.repo.linkTicket).toHaveBeenCalledWith({ tenantId: 1, sessionId: 42, ticketProvider: 'jira', ticketKey: 'OPS-7', ticketUrl: 'https://jira.fixture.invalid/browse/OPS-7' });
        expect(result).toMatchObject({ ticketProvider: 'jira', ticketKey: 'OPS-7' });
    });
    it('does not write a link when integration is absent or provider fails', async () => {
        await expect(setup({ integration: false }).service.linkJiraTicket(1, 42, 'OPS-7')).rejects.toMatchObject({ code: 'JIRA_INTEGRATION_UNAVAILABLE' });
        const s = setup();
        s.integration.getJiraTicket.mockRejectedValueOnce(new Error('fixture ticket unavailable'));
        await expect(s.service.linkJiraTicket(1, 42, 'OPS-7')).rejects.toThrow('fixture ticket unavailable');
        expect(s.repo.linkTicket).not.toHaveBeenCalled();
    });
});
describe('shared audit actors and critical evidence', () => {
    it('preserves absent shared context and falls back to owner identity', async () => {
        const s = setup({ shared: false });
        s.row.userNameSnapshot = '';
        expect((await s.service.getBySessionId(1, 42)).sharedSessionContext).toBeNull();
        expect(await s.service.commandStats(1, 42)).toEqual({ total: 2, participants: [{ key: 'owner:9', userId: 9, name: '#9', role: 'owner', count: 2 }] });
        const present = setup();
        expect((await present.service.getBySessionId(1, 42)).sharedSessionContext).toBeNull();
        expect(present.shared.findParticipants).not.toHaveBeenCalled();
    });
    it('attributes actual commands to participants, lease fallbacks and owner without inventing users', async () => {
        const s = setup({ commands: [{ command: 'echo a', actor: 11 }, { command: 'echo b', actor: 11 }, { command: 'echo c', actor: 10 }, { command: 'echo d', actor: 999 }, { command: 'echo e', actor: null }, { command: 'echo f', actor: null }] });
        s.shared.findBySessionId.mockResolvedValue({ sharedSessionId: 77, status: 'CLOSED', ownerUserId: 9, ownerName: 'Owner' });
        s.shared.findParticipants.mockResolvedValue([{ userId: 9, name: 'Owner', email: null, role: 'OWNER', joinedAt: time(0), leftAt: null }, { userId: 10, name: 'Alpha', email: null, role: 'VIEWER', joinedAt: time(0), leftAt: time(5000) }, { userId: 11, name: 'Bravo', email: null, role: 'VIEWER', joinedAt: time(0), leftAt: null }]);
        s.shared.findControlLeases.mockResolvedValue([{ id: 1, controllerUserId: 12, grantedByUserId: 99, startedAt: time(800), expiresAt: time(1050), endedAt: null, endReason: null, revokeReason: null }, { id: 2, controllerUserId: 9, grantedByUserId: 10, startedAt: time(1050), expiresAt: time(9000), endedAt: time(1200), endReason: 'REVOKED', revokeReason: 'fixture reason' }]);
        const audit = await s.service.getBySessionId(1, 42);
        expect(audit.sharedSessionContext).toMatchObject({ sharedSessionId: 77, status: 'closed', ownerUserId: 9, participantsCount: 3 });
        expect(audit.sharedSessionContext!.participants.map(p => p.role)).toEqual(['owner', 'viewer', 'viewer']);
        expect(audit.sharedSessionContext!.controlEpochs[0]).toMatchObject({ controllerName: '#12', grantedByName: '#99' });
        expect(audit.sharedSessionContext!.controlEpochs[1]).toMatchObject({ controllerName: 'Owner', grantedByName: 'Alpha', endReason: 'revoked' });
        const stats = await s.service.commandStats(1, 42);
        expect(stats.total).toBe(6);
        expect(Object.fromEntries(stats.participants.map(p => [p.key, p.count]))).toEqual({ 'viewer:11': 2, 'owner:9': 2, 'viewer:10': 1, 'viewer:12': 1 });
        expect(stats.participants.slice(0, 2).map(p => p.name)).toEqual(['Bravo', 'Owner']);
        expect(s.shared.findParticipants).toHaveBeenCalledWith(77);
        expect(s.shared.findControlLeases).toHaveBeenCalledWith(77);
    });
    it.each([
        ['rm -rf /fixture/cache', '', 'destructive_delete', 'high'],
        ['service fixture start', 'active (running)', 'service_start', 'medium'],
        ['service fixture stop', 'inactive (dead)', 'service_stop', 'high'],
        ['service fixture restart', '', 'service_restart', 'high'],
        ['service fixture status', 'active (running)', 'service_status', 'low'],
        ['chmod 600 /fixture/config', '', 'permission_change', 'high'],
        ['useradd fixture-user', '', 'identity_change', 'high'],
        ['apt-get install fixture-package', '', 'package_change', 'medium'],
        ['nano /fixture/config', 'fixture file written', 'config_edit', 'medium'],
    ])('derives %s evidence from recorded input/output without executing it', async (command, output, type, severity) => {
        const s = setup({ commands: [{ command, output }] }), audit = await s.service.getBySessionId(1, 42);
        expect(audit.criticalEvents).toHaveLength(1);
        expect(audit.criticalEvents[0]).toMatchObject({ type, severity, command, commandIndex: 1 });
        expect(audit.criticalEvents[0]!.evidence).toContain(command);
    });
    it('marks fullscreen evidence as advisory and caps critical events at twenty', async () => {
        const silent = setup({ commands: [{ command: 'nano /fixture/config', output: '' }] });
        const advisory = (await silent.service.getBySessionId(1, 42)).criticalEvents;
        expect(advisory).toHaveLength(1);
        expect(advisory[0]!.summary).toContain('Validar se houve alteração persistida');
        const many = setup({ commands: Array.from({ length: 25 }, (_, index) => ({ command: `chmod 600 /fixture/config-${index}` })) });
        const events = (await many.service.getBySessionId(1, 42)).criticalEvents;
        expect(events).toHaveLength(20);
        expect(events.at(-1)!.commandIndex).toBe(20);
    });
});

it('keeps masked input in technical evidence without inventing a reconstructed command', async () => {
 const s=setup({commands:[{command:'echo {{secret:fixture:***}}',output:'fixture output'}]})
 const technical=await s.service.transcript(1,42,'technical')
 expect(technical.content).toContain('{{secret:fixture:***}}')
 expect(await s.service.commands(1,42)).toEqual([])
})
