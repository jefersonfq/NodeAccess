import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { AgentService } from './agent.service.js';
const runtime = vi.hoisted(() => ({ getActiveById: vi.fn(), getLastOfflineReason: vi.fn(), getForUser: vi.fn(), getForTenant: vi.fn(), getPrivateAccessForTenant: vi.fn(), disconnectById: vi.fn(), activeConnectionsForAgent: vi.fn(), setMaintenance: vi.fn() }));
const trial = vi.hoisted(() => ({ capability: vi.fn(), user: vi.fn() }));
vi.mock('./agent.registry.js', () => ({ agentRegistry: runtime }));
vi.mock('../trials/trial-policy.js', () => ({ assertTrialCapability: trial.capability, assertTrialUserAccess: trial.user }));
function setup() {
    const db = { agent: { findFirst: vi.fn().mockResolvedValue({ id: 4, name: 'Fixture agent', createdById: 9, tenantId: 7, agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND' }), findMany: vi.fn().mockResolvedValue([{ id: 3 }]), update: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(1), adminLog: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) } };
    const transaction = vi.fn((operation: (tx: typeof db) => Promise<unknown>) => operation(db));
    Object.assign(db, { $transaction: transaction });
    const license = { requireFeature: vi.fn().mockResolvedValue(undefined) }, invalidate = vi.fn().mockResolvedValue(undefined);
    const service = new AgentService(db as never, license as never, invalidate);
    return { db, transaction, license, invalidate, service };
}
function row(extra: Record<string, unknown> = {}) {
    return { id: 4, name: 'Fixture agent', active: 1, agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', isDefault: 0, maintenanceMode: 0, drainStartedAt: null, poolName: 'fixture-pool', priority: 100, siteName: null, environment: null, privateAccessAllowedCidrsJson: null, privateAccessAllowedHostnamesJson: null, privateAccessAllowedPortsJson: null, privateAccessAllowedHostTagsJson: null, privateAccessAllowFallback: false, revokedAt: null, lastSeenAt: new Date(), createdAt: '2026-01-01T00:00:00Z', createdById: 9, createdByName: 'Fixture', createdByEmail: 'fixture@example.invalid', ...extra };
}
function query(s: ReturnType<typeof setup>, index = 0) { return s.db.$queryRaw.mock.calls[index]![0] as {
    sql: string;
    values: unknown[];
}; }
beforeEach(() => { vi.resetAllMocks(); trial.capability.mockResolvedValue(undefined); trial.user.mockResolvedValue(null); runtime.activeConnectionsForAgent.mockReturnValue(0); });
describe('agent inventory and state contracts', () => {
    it('returns empty inventory with one tenant/owner scoped query', async () => {
        const s = setup();
        expect(await s.service.list(9, 7)).toEqual([]);
        expect(s.db.$queryRaw).toHaveBeenCalledOnce();
        expect(query(s).values).toEqual([7, 9]);
        expect(query(s).sql).toContain('a.deleted_at IS NULL');
        expect(s.license.requireFeature).toHaveBeenCalledWith(7, 'agents', expect.any(String));
    });
    it('maps persisted diagnostics and exposes owner only to admin', async () => {
        const s = setup(), now = new Date();
        s.db.$queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([{ id: 4, lastAgentVersion: '999.0.0', lastAgentHostname: 'fixture-host', lastAgentPlatform: 'linux', lastAgentArch: 'x64', lastAgentRemoteIp: '192.0.2.4', lastAgentConnectedAt: now, lastAgentDisconnectedAt: null, lastAgentDisconnectReason: null }]);
        const [agent] = await s.service.list(9, 7, true);
        expect(query(s).values).toEqual([7]);
        expect(agent).toMatchObject({ online: true, version: '999.0.0', hostname: 'fixture-host', versionStatus: 'current', owner: { id: 9, name: 'Fixture', email: 'fixture@example.invalid' } });
        expect(agent?.createdAt).toBe('2026-01-01T00:00:00.000Z');
        s.db.$queryRaw.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
        expect((await s.service.list(9, 7))[0]?.owner).toBeUndefined();
    });
    it('prefers active runtime diagnostics and reports heartbeat and last offline reason', async () => {
        const s = setup(), now = new Date();
        s.db.$queryRaw.mockResolvedValueOnce([row({ maintenanceMode: 1, active: 0, isDefault: 1, drainStartedAt: now })]).mockResolvedValueOnce([{ id: 4, lastAgentVersion: '0.0.1' }]);
        runtime.getActiveById.mockReturnValue({ version: '999.0.0', hostname: 'runtime-host', platform: 'darwin', arch: 'arm64', remoteIp: '192.0.2.5', connectedAt: now, tlsMode: 'strict', lastPongAt: new Date(Date.now() - 1000) });
        runtime.getLastOfflineReason.mockReturnValue({ reason: 'fixture restart', at: now });
        const [agent] = await s.service.list(9, 7);
        expect(agent).toMatchObject({ online: true, active: false, isDefault: true, maintenanceMode: true, version: '999.0.0', lastVersion: '0.0.1', hostname: 'runtime-host', platform: 'darwin', arch: 'arm64', lastOfflineReason: 'fixture restart', tlsMode: 'strict' });
        expect(agent!.heartbeatAgeMs).toBeGreaterThanOrEqual(1000);
    });
    it.each([null, '0.0.1', '999.0.0'])('classifies missing/old/current version %s without making stale host online', async (version) => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValueOnce([row({ lastSeenAt: new Date(0) })]).mockResolvedValueOnce([{ id: 4, lastAgentVersion: version, lastAgentConnectedAt: new Date(0), lastAgentDisconnectedAt: null }]);
        const [agent] = await s.service.list(9, 7);
        expect(agent!.online).toBe(false);
        expect(agent!.versionStatus).toBe(version === null ? 'unknown' : version === '0.0.1' ? 'outdated' : 'current');
    });
    it('normalizes connector policy JSON arrays without accepting malformed objects', async () => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValueOnce([row({ agentType: 'PRIVATE_ACCESS_CONNECTOR', privateAccessAllowedCidrsJson: '["192.0.2.0/24"]', privateAccessAllowedHostnamesJson: ['fixture.internal'], privateAccessAllowedPortsJson: '{broken', privateAccessAllowedHostTagsJson: '{"not":"array"}', privateAccessAllowFallback: 1 })]).mockResolvedValueOnce([]);
        expect((await s.service.list(9, 7))[0]?.privateAccess).toEqual({ allowedCidrs: ['192.0.2.0/24'], allowedHostnames: ['fixture.internal'], allowedPorts: [], allowedHostTags: [], allowFallback: true });
    });
    it('selects persisted user/tenant/connector agents only while live and prefers runtime', async () => {
        const s = setup(), now = new Date();
        s.db.$queryRaw.mockResolvedValue([
            row({ id: 1, agentMode: 'USER_BOUND', lastAgentConnectedAt: now, lastAgentDisconnectedAt: null }),
            row({ id: 2, lastAgentConnectedAt: now, lastAgentDisconnectedAt: null }),
            row({ id: 3, agentType: 'PRIVATE_ACCESS_CONNECTOR', lastAgentConnectedAt: now, lastAgentDisconnectedAt: null }),
        ]);
        expect(await s.service.status(9, 7)).toEqual({ userAgent: { id: 1, name: 'Fixture agent' }, tenantAgent: { id: 2, name: 'Fixture agent' }, privateAccessConnector: { id: 3, name: 'Fixture agent' } });
        runtime.getForUser.mockReturnValue({ agentId: 11, name: 'Runtime user' });
        runtime.getForTenant.mockReturnValue({ agentId: 12, name: 'Runtime tenant' });
        runtime.getPrivateAccessForTenant.mockReturnValue({ agentId: 13, name: 'Runtime connector' });
        expect(await s.service.status(9, 7)).toEqual({ userAgent: { id: 11, name: 'Runtime user' }, tenantAgent: { id: 12, name: 'Runtime tenant' }, privateAccessConnector: { id: 13, name: 'Runtime connector' } });
        expect(query(s).values).toEqual([7, 9]);
        expect(query(s).sql).toContain('maintenance_mode = 0');
    });
    it('does not report disconnected persisted agents as available', async () => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValue([row({ lastAgentConnectedAt: new Date(), lastAgentDisconnectedAt: new Date() })]);
        expect(await s.service.status(9, 7)).toEqual({ userAgent: null, tenantAgent: null, privateAccessConnector: null });
    });
});
describe('agent token and lifecycle contracts', () => {
    it('creates random token once, persists only SHA256 and writes two audit records', async () => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValue([{ id: 4n }]);
        const result = await s.service.create(9, 7, { name: ' Fixture ' });
        expect(result.token).toMatch(/^na_agent_[a-f0-9]{64}$/);
        expect(result.agent).toMatchObject({ id: 4, name: 'Fixture', agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND' });
        const args = s.db.$executeRaw.mock.calls[0]!.slice(1) as unknown[];
        expect(args).toContain(createHash('sha256').update(result.token).digest('hex'));
        expect(args).not.toContain(result.token);
        expect(s.db.adminLog.create.mock.calls.map(call => (call[0] as {
            data: {
                action: string;
            };
        }).data.action)).toEqual(['agent_created', 'agent_token_issued']);
        expect(JSON.stringify(s.db.adminLog.create.mock.calls)).not.toContain(result.token);
    });
    it('forces connector service mode and sanitizes policy fields before parameterized insert', async () => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValue([{ id: 4 }]);
        const result = await s.service.create(9, 7, { name: 'Connector', agentType: 'PRIVATE_ACCESS_CONNECTOR', agentMode: 'USER_BOUND', privateAccess: { siteName: ' branch ', environment: ' test ', allowedCidrs: [' 192.0.2.0/24 ', ''], allowedHostnames: ['fixture.internal'], allowedPorts: [22, 22, 0, 65536, 443], allowedHostTags: ['ops', ' '], allowFallback: true } });
        expect(result.agent).toMatchObject({ agentMode: 'SERVICE_BOUND' });
        expect(s.db.$executeRaw.mock.calls[0]!.slice(1)).toEqual(expect.arrayContaining(['branch', 'test', '["192.0.2.0/24"]', '[22,443]', '["ops"]', true]));
    });
    it.each(['', '   '])('rejects invalid name %j before transaction', async (name) => {
        const s = setup();
        await expect(s.service.create(9, 7, { name })).rejects.toMatchObject({ code: 'AGENT_NAME_REQUIRED' });
        expect(s.transaction).not.toHaveBeenCalled();
    });
    it.each([[], [{ id: 0 }], [{ id: 'not-id' }], [{ id: Number.MAX_SAFE_INTEGER + 1 }]].map(rows => ({ rows })))('rejects invalid inserted identity $rows without audit success', async ({ rows }) => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValue(rows);
        await expect(s.service.create(9, 7, { name: 'Fixture' })).rejects.toMatchObject({ code: 'AGENT_CREATE_FAILED' });
        expect(s.db.adminLog.create).not.toHaveBeenCalled();
    });
    it('hashes authentication token and normalizes connector policy output', async () => {
        const s = setup(), token = 'fixture-token';
        s.db.$queryRaw.mockResolvedValue([row({ tenantId: 7, agentType: 'PRIVATE_ACCESS_CONNECTOR', isDefault: 1, maintenanceMode: 1, privateAccessAllowedCidrsJson: ['192.0.2.0/24', 123], privateAccessAllowedHostnamesJson: '["fixture.internal",null]', privateAccessAllowedPortsJson: '[22,"443",0,65536,1.5]', privateAccessAllowedHostTagsJson: ['ops', false], privateAccessAllowFallback: 1 })]);
        expect(await s.service.authenticate(token, true)).toMatchObject({ id: 4, isDefault: true, maintenanceMode: true, privateAccess: { allowedCidrs: ['192.0.2.0/24'], allowedHostnames: ['fixture.internal'], allowedPorts: [22, 443], allowedHostTags: ['ops'], allowFallback: true } });
        expect(s.db.$queryRaw.mock.calls[0]!.slice(1)).toEqual([createHash('sha256').update(token).digest('hex'), true]);
        expect(trial.capability).toHaveBeenCalledWith(7, 'agents');
        expect(trial.user).toHaveBeenCalledWith(7, 9);
    });
    it('rejects unknown tokens and trial denial without returning agent', async () => {
        const s = setup();
        expect(await s.service.authenticate('unknown')).toBeNull();
        expect(trial.user).not.toHaveBeenCalled();
        s.db.$queryRaw.mockResolvedValue([row({ tenantId: 7 })]);
        trial.capability.mockRejectedValueOnce(new Error('trial denied'));
        expect(await s.service.authenticate('known')).toBeNull();
        trial.user.mockRejectedValueOnce(new Error('user denied'));
        expect(await s.service.authenticate('known')).toBeNull();
        expect((await s.service.authenticate('known'))?.privateAccess).toBeNull();
    });
    it.each(['reactivate', 'revoke', 'permanentDelete', 'setDefault'] as const)('enforces tenant/owner scope for %s and allows explicit admin operation', async (operation) => {
        const s = setup();
        s.db.agent.findFirst.mockResolvedValueOnce(null);
        await expect(s.service[operation](4, 9, 7)).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
        s.db.agent.findFirst.mockResolvedValueOnce({ id: 4, createdById: 8 });
        await expect(s.service[operation](4, 9, 7)).rejects.toMatchObject({ code: 'AGENT_FORBIDDEN' });
        s.db.agent.findFirst.mockResolvedValue({ id: 4, createdById: 8, name: 'Other owner', agentMode: 'SERVICE_BOUND' });
        await s.service[operation](4, 9, 7, true);
        expect(s.transaction).toHaveBeenCalledOnce();
        expect(s.db.adminLog.create).toHaveBeenCalledOnce();
        expect(s.db.agent.findFirst.mock.calls[0]![0]).toMatchObject({ where: { id: 4, tenantId: 7, deletedAt: null } });
        if (operation === 'setDefault')
            expect(s.db.agent.updateMany).toHaveBeenCalledWith({ where: { tenantId: 7, isDefault: true }, data: { isDefault: false } });
        if (operation === 'reactivate')
            expect(s.db.agent.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { active: true, revokedAt: null, revokedById: null } });
    });
});
describe('agent diagnostic persistence', () => {
    it('updates heartbeat and diagnostics with monotonic connection guard and bound parameters', async () => {
        const s = setup(), connectedAt = new Date('2026-01-01T00:00:00Z');
        await s.service.touch(4);
        expect(s.db.agent.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { lastSeenAt: expect.any(Date) as unknown } });
        await s.service.markConnected(4, { connectedAt: connectedAt.toISOString(), version: '1.0.0', hostname: 'fixture', platform: 'linux', arch: 'x64', remoteIp: '192.0.2.4' });
        const args = s.db.$executeRaw.mock.calls[0]!;
        expect((args[0] as string[]).join('?')).toContain('last_agent_connected_at <= ?');
        expect(args.slice(1)).toEqual([connectedAt, connectedAt, '1.0.0', 'fixture', 'linux', 'x64', '192.0.2.4', 4, connectedAt]);
        await s.service.markDisconnected(4, 'fixture closed', connectedAt);
        expect(s.db.$executeRaw.mock.calls[1]!.slice(2)).toEqual(['fixture closed', 4, connectedAt]);
    });
    it('tolerates best-effort heartbeat/disconnect/audit storage failure', async () => {
        const s = setup();
        s.db.agent.update.mockRejectedValue(new Error('offline'));
        s.db.$executeRaw.mockRejectedValue(new Error('offline'));
        s.db.adminLog.create.mockRejectedValue(new Error('offline'));
        await expect(s.service.touch(4)).resolves.toBeUndefined();
        await expect(s.service.markDisconnected(4, 'offline')).resolves.toBeUndefined();
        await expect(s.service.logConnected(4, 'Fixture', 'PROXY_AGENT', 'SERVICE_BOUND', 9)).resolves.toBeUndefined();
        await expect(s.service.logDisconnected(4, 'Fixture', 'PROXY_AGENT', 'SERVICE_BOUND', 9, 'offline')).resolves.toBeUndefined();
    });
    it('logs connection identity and telemetry without any credential', async () => {
        const s = setup();
        await s.service.logConnected(4, 'Fixture', 'PROXY_AGENT', 'SERVICE_BOUND', 9, { hostname: 'fixture' });
        await s.service.logDisconnected(4, 'Fixture', 'PROXY_AGENT', 'SERVICE_BOUND', 9, 'closed', { version: '1.0.0' });
        const data = s.db.adminLog.create.mock.calls.map(call => (call[0] as {
            data: {
                details: string;
                targetId: number;
            };
        }).data);
        expect(data.map(item => item.targetId)).toEqual([4, 4]);
        expect(JSON.parse(data[1]!.details)).toMatchObject({ createdBy: 9, reason: 'closed', version: '1.0.0' });
        expect(data[0]!.details).not.toMatch(/tokenHash|na_agent_/);
    });
    it.each([true, false])('changes maintenance=%s only after transaction succeeds', async (enabled) => {
        const s = setup();
        runtime.activeConnectionsForAgent.mockReturnValue(2);
        await expect(s.service.setMaintenance(4, 9, 7, false, enabled)).resolves.toEqual({ maintenanceMode: enabled, activeConnections: 2 });
        expect(runtime.setMaintenance).toHaveBeenCalledWith(4, enabled);
        expect(s.db.$executeRaw.mock.calls[0]!.slice(1)).toEqual([enabled, enabled ? expect.any(Date) : null, 4, 7]);
        expect(s.db.adminLog.create.mock.invocationCallOrder[0]).toBeLessThan(runtime.setMaintenance.mock.invocationCallOrder[0]!);
        s.db.adminLog.create.mockRejectedValueOnce(new Error('audit failed'));
        await expect(s.service.setMaintenance(4, 9, 7, false, !enabled)).rejects.toThrow('audit failed');
        expect(runtime.setMaintenance).toHaveBeenCalledOnce();
    });
    it('uses highest runtime/session count when assessing revoke impact', async () => {
        const s = setup();
        s.db.$queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([{ count: 1n }]);
        runtime.activeConnectionsForAgent.mockReturnValue(3);
        runtime.getActiveById.mockReturnValue({ agentId: 4 });
        await expect(s.service.impact(4, 9, 7)).resolves.toEqual({ hostCount: 0, activeSessionCount: 3, online: true, safeToRevoke: false });
        runtime.activeConnectionsForAgent.mockReturnValue(0);
        runtime.getActiveById.mockReturnValue(undefined);
        await expect(s.service.impact(4, 9, 7)).resolves.toEqual({ hostCount: 0, activeSessionCount: 0, online: false, safeToRevoke: true });
    });
    it('default invalidator disconnects runtime only after persisted token rotation', async () => {
        const s = setup(), service = new AgentService(s.db as never, s.license as never);
        await service.rotateToken(4, 9, 7);
        expect(runtime.disconnectById).toHaveBeenCalledWith(4);
        expect(s.db.agent.update.mock.invocationCallOrder[0]).toBeLessThan(runtime.disconnectById.mock.invocationCallOrder[0]!);
    });
});
