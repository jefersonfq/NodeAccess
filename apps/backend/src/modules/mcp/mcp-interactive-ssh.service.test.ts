import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Duplex, PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { encrypt } from '../../shared/crypto.js';
import type { JwtPayload } from '../../shared/guards.js';
import { McpInteractiveSshService } from './mcp-interactive-ssh.service.js';
const io = vi.hoisted(() => ({ clients: [] as unknown[], failures: [] as Array<string | undefined> }));
const trial = vi.hoisted(() => ({ capability: vi.fn(), user: vi.fn(), host: vi.fn(), monitor: vi.fn<(tenantId: number, trialId: number | null, revoke: () => void, user: unknown, host: unknown) => () => void>(), stop: vi.fn() }));
vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64), MCP_INTERACTIVE_SSH_DEFAULT_TTL_SECONDS: 120, MCP_INTERACTIVE_SSH_MAX_TTL_SECONDS: 180, MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN: 2, MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT: 3 } }));
vi.mock('../trials/trial-policy.js', () => ({ assertTrialCapability: trial.capability, assertTrialUserAccess: trial.user, assertTrialHostAccess: trial.host, monitorTrialAccess: trial.monitor }));
vi.mock('ssh2', () => ({ Client: class extends EventEmitter {
        config: Record<string, unknown> = {};
        failure = io.failures.shift();
        writes: string[] = [];
        channel = Object.assign(new Duplex({ read() { }, write: (chunk: Buffer, _encoding, callback) => { this.writes.push(chunk.toString()); callback(); } }), { setWindow: vi.fn() });
        shellOptions: unknown;
        end = vi.fn(() => { this.emit('close'); });
        destroy = vi.fn(() => { this.emit('close'); });
        constructor() { super(); io.clients.push(this); }
        connect(config: Record<string, unknown>) { this.config = config; queueMicrotask(() => this.failure === 'connect' ? this.emit('error', new Error('fixture connection failed')) : this.emit('ready')); return this; }
        shell(options: unknown, callback: (error: Error | null, stream?: Duplex) => void) { this.shellOptions = options; callback(this.failure === 'shell' ? new Error('fixture shell failed') : null, this.channel); }
        forwardOut = vi.fn((_host: string, _port: number, _dest: string, _destPort: number, callback: (error: Error | null, stream?: Duplex) => void) => callback(this.failure === 'forward' ? new Error('fixture forward failed') : null, new PassThrough()));
    } }));
type FakeClient = EventEmitter & {
    config: Record<string, unknown>;
    writes: string[];
    channel: Duplex & {
        setWindow: ReturnType<typeof vi.fn>;
    };
    shellOptions: unknown;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    forwardOut: ReturnType<typeof vi.fn>;
};
const clients = () => io.clients as FakeClient[];
const user = { sub: '9', tenantId: 7, role: 'admin', sessionVersion: 3 } as JwtPayload;
const audit = { mode: 'persisted_token', tokenId: 11 } as const;
const input = { hostId: 10, reason: 'Verify deployment' };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function setup() {
    const host = { id: 10, tenantId: 7, name: 'Fixture host', deviceProfile: 'server_ssh', connectionMode: 'DIRECT', ip: 'fixture.internal', port: 2222, sshUser: 'fixture', authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt('fixture-password')), pemKey: null as null | {
            encryptedKey: string;
            iv: string;
            encryptedPassphrase?: string;
            passphraseIv?: string;
        }, onePasswordRef: null as string | null, bastion: null as Record<string, unknown> | null, trustedHostKeyFingerprint: null as string | null };
    const repo = { findHostWithCredentials: vi.fn().mockResolvedValue(host), hasEffectiveHostPermission: vi.fn().mockResolvedValue(true), startSession: vi.fn().mockResolvedValue(41), endSession: vi.fn().mockResolvedValue(undefined) };
    const secrets = { resolve: vi.fn().mockResolvedValue('fixture-resolved-secret') }, logs = { logAdminEvent: vi.fn<(event: { action: string; details: string; adminId?: number }) => Promise<void>>().mockResolvedValue(undefined) }, db = { $executeRaw: vi.fn<(query: { values: unknown[] }) => Promise<number>>().mockResolvedValue(1) }, webhooks = { publishEvent: vi.fn().mockResolvedValue(undefined) };
    const service = new McpInteractiveSshService(repo as never, secrets as never, logs as never, db as never, webhooks as never);
    return { host, repo, secrets, logs, db, webhooks, service, open: () => service.open(user, input, audit) };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.clearAllMocks(); io.clients.length = 0; io.failures.length = 0; trial.capability.mockResolvedValue(null); trial.user.mockResolvedValue(undefined); trial.host.mockResolvedValue(undefined); trial.monitor.mockReturnValue(trial.stop); env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN = 2; env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT = 3; });
afterEach(async () => {
    await vi.runAllTimersAsync();
    for (const client of clients())
        client.channel.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
describe('MCP interactive authorization and credentials', () => {
    it.each([{ role: 'user' }, { mode: 'jwt' }, { mode: 'static_token' }, { tokenId: 0 }])('rejects unsupported identity before secrets/SSH: %j', async (variant) => {
        const s = setup(), actor = { ...user, ...('role' in variant ? { role: variant.role } : {}) } as JwtPayload, context = { ...audit, ...variant } as typeof audit;
        await expect(s.service.open(actor, input, context)).rejects.toMatchObject({ statusCode: 403 });
        expect(s.repo.findHostWithCredentials).not.toHaveBeenCalled();
        expect(io.clients).toHaveLength(0);
    });
    it.each([0, -1, 1.2, NaN])('rejects hostId %s', async (hostId) => { const s = setup(); await expect(s.service.open(user, { ...input, hostId }, audit)).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_INVALID_INPUT' }); expect(io.clients).toHaveLength(0); });
    it('requires a meaningful reason before opening SSH', async () => { const s = setup(); await expect(s.service.open(user, { ...input, reason: '  ' }, audit)).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_REASON_REQUIRED' }); expect(s.repo.findHostWithCredentials).not.toHaveBeenCalled(); });
    it.each(['missing', 'acl', 'profile', 'route', 'trial'])('fails closed on %s before resolving credentials', async (failure) => {
        const s = setup();
        s.host.onePasswordRef = 'op://fixture/vault/item';
        if (failure === 'missing')
            s.repo.findHostWithCredentials.mockResolvedValue(null);
        if (failure === 'acl')
            s.repo.hasEffectiveHostPermission.mockResolvedValue(false);
        if (failure === 'profile')
            s.host.deviceProfile = 'network_generic';
        if (failure === 'route')
            s.host.connectionMode = 'AGENT';
        if (failure === 'trial')
            trial.capability.mockRejectedValueOnce(new Error('trial denied'));
        await expect(s.open()).rejects.toThrow();
        expect(s.secrets.resolve).not.toHaveBeenCalled();
        expect(io.clients).toHaveLength(0);
    });
    it('opens scoped direct SSH with actual decryption, pinned host key and default TTL', async () => {
        const s = setup(), key = Buffer.from('fixture-host-key');
        s.host.trustedHostKeyFingerprint = `SHA256:${createHash('sha256').update(key).digest('base64')}`;
        const result = await s.open(), client = clients()[0]!;
        expect(s.repo.findHostWithCredentials).toHaveBeenCalledWith(10, 7);
        expect(s.repo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 7, 9, 'connect', 'ADMIN');
        expect(client.config).toMatchObject({ host: 'fixture.internal', port: 2222, username: 'fixture', password: 'fixture-password', readyTimeout: 15000, keepaliveInterval: 10000 });
        const verify = client.config.hostVerifier as (key: Buffer) => boolean;
        expect(verify(key)).toBe(true);
        expect(verify(Buffer.from('different'))).toBe(false);
        expect(client.shellOptions).toEqual({ term: 'xterm-256color', cols: 120, rows: 32 });
        expect(Date.parse(result.expiresAt) - Date.now()).toBe(120000);
        expect(result).toMatchObject({ capability: 'open_interactive_ssh_session', hostId: 10, hostName: 'Fixture host', cursor: 0 });
        expect(trial.monitor).toHaveBeenCalledWith(7, null, expect.any(Function), { id: 9, sessionVersion: 3 }, s.host);
        expect(s.webhooks.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, eventType: 'mcp_interactive_ssh_session.opened' }));
        expect(s.db.$executeRaw.mock.calls[0]![0].values).toContain(result.sessionId);
        await s.service.close(user, { sessionId: result.sessionId }, audit);
    });
    it('rejects unknown host fingerprint in verifier', async () => { const s = setup(); await s.open(); expect((clients()[0]!.config.hostVerifier as (key: Buffer) => boolean)(Buffer.from('key'))).toBe(false); });
    it.each(['PASSWORD', 'PEM', 'PEM_PASSWORD'])('uses tenant-scoped 1Password for %s', async (authType) => { const s = setup(); s.host.authType = authType; s.host.onePasswordRef = 'op://fixture/vault/item'; await s.open(); expect(s.secrets.resolve).toHaveBeenCalledWith(7, 'op://fixture/vault/item'); expect(clients()[0]!.config[authType === 'PEM' ? 'privateKey' : 'password']).toBe('fixture-resolved-secret'); });
    it('decrypts PEM/password/passphrase and forwards through bastion', async () => {
        const s = setup(), pem = encrypt('fixture-pem'), phrase = encrypt('fixture-passphrase');
        s.host.authType = 'PEM_PASSWORD';
        s.host.pemKey = { encryptedKey: pem.encrypted, iv: pem.iv, encryptedPassphrase: phrase.encrypted, passphraseIv: phrase.iv };
        s.host.bastion = { ...s.host, ip: 'bastion.fixture', port: 2200, bastion: null };
        const opened = await s.open(), [bastion, target] = clients();
        expect(bastion!.config.hostVerifier).toBeUndefined();
        expect(bastion!.forwardOut).toHaveBeenCalledWith('127.0.0.1', 0, 'fixture.internal', 2222, expect.any(Function));
        expect(target!.config).toMatchObject({ password: 'fixture-password', privateKey: 'fixture-pem', passphrase: 'fixture-passphrase', sock: expect.any(PassThrough) as unknown });
        await s.service.close(user, { sessionId: opened.sessionId }, audit);
        expect(bastion!.destroy).toHaveBeenCalledOnce();
        expect(target!.destroy).toHaveBeenCalledOnce();
    });
    it.each(['connect', 'shell'])('closes direct resources on %s failure', async (failure) => { const s = setup(); trial.capability.mockResolvedValue({ id: 1 }); io.failures.push(failure); await expect(s.open()).rejects.toThrow('fixture'); expect(clients()[0]!.end).toHaveBeenCalledOnce(); expect(s.repo.endSession).toHaveBeenCalledWith(41); });
    it.each(['bastion', 'forward', 'target'])('closes bastion resources on %s failure', async (failure) => {
        const s = setup();
        s.host.bastion = { ...s.host, ip: 'bastion.fixture' };
        io.failures.push(failure === 'bastion' ? 'connect' : failure === 'forward' ? 'forward' : undefined);
        if (failure === 'target')
            io.failures.push('connect');
        await expect(s.open()).rejects.toThrow('fixture');
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
        if (failure === 'target')
            expect(clients()[1]!.end).toHaveBeenCalledOnce();
    });
    it('rechecks trial after connecting and closes when access expired', async () => { const s = setup(); trial.capability.mockResolvedValue({ id: 1 }); trial.user.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('trial expired')); await expect(s.open()).rejects.toThrow('trial expired'); expect(clients()[0]!.end).toHaveBeenCalledOnce(); expect(s.repo.endSession).toHaveBeenCalledWith(41); });
});
describe('MCP interactive session contracts', () => {
    it('writes UTF-8 bytes and records sanitized evidence without plaintext secrets', async () => {
        const s = setup(), opened = await s.open(), data = 'echo café; token=fixture-sensitive\n';
        const result = await s.service.write(user, { sessionId: opened.sessionId, data }, audit);
        expect(clients()[0]!.writes).toEqual([data]);
        expect(result.acceptedBytes).toBe(Buffer.byteLength(data));
        const event = s.logs.logAdminEvent.mock.calls.find(([value]) => value.action === 'MCP_INTERACTIVE_SSH_INPUT')![0], details = JSON.parse(event.details) as { inputPreview: string };
        expect(details).toMatchObject({ tenantId: 7, tokenId: 11, inputBytes: Buffer.byteLength(data), inputSha256: createHash('sha256').update(data).digest('hex') });
        expect(details.inputPreview).toContain('[redacted]');
        expect(event.details).not.toContain('fixture-sensitive');
        expect(s.db.$executeRaw.mock.calls.at(-1)![0].values).toEqual([Buffer.byteLength(data), opened.sessionId]);
    });
    it.each(['', 'x'.repeat(16001)])('rejects empty or oversized writes', async (data) => { const s = setup(), opened = await s.open(); await expect(s.service.write(user, { sessionId: opened.sessionId, data }, audit)).rejects.toMatchObject({ code: data ? 'MCP_INTERACTIVE_SSH_WRITE_TOO_LARGE' : 'MCP_INTERACTIVE_SSH_DATA_REQUIRED' }); expect(clients()[0]!.writes).toEqual([]); });
    it('reads real output streams by cursor, accounts bytes and marks stream closure', async () => {
        const s = setup(), opened = await s.open(), channel = clients()[0]!.channel;
        channel.push(Buffer.from('first\nsecond'));
        await tick();
        const first = await s.service.read(user, { sessionId: opened.sessionId, maxBytes: 6 }, audit);
        expect(first).toMatchObject({ output: 'first\n', cursor: 6, bufferStartCursor: 0, closed: false });
        const second = await s.service.read(user, { sessionId: opened.sessionId, cursor: first.cursor }, audit);
        expect(second.output).toBe('second');
        expect(second.cursor).toBe(12);
        channel.emit('close');
        expect((await s.service.read(user, { sessionId: opened.sessionId, cursor: 12 }, audit)).closed).toBe(true);
    });
    it('bounds output buffer and clamps stale cursors and read length', async () => {
        const s = setup(), opened = await s.open();
        clients()[0]!.channel.push('a'.repeat(512010));
        await tick();
        const result = await s.service.read(user, { sessionId: opened.sessionId, cursor: 0, maxBytes: 100000 }, audit);
        expect(result.bufferStartCursor).toBe(10);
        expect(result.output.length).toBe(64000);
        expect(result.cursor).toBe(64010);
        expect((await s.service.read(user, { sessionId: opened.sessionId, cursor: 10, maxBytes: NaN }, audit)).output).toBe('a');
    });
    it('reports shell errors as closed output and supports resize without setWindow', async () => {
        const s = setup(), opened = await s.open(), channel = clients()[0]!.channel;
        channel.emit('error', new Error('fixture channel failure'));
        const read = await s.service.read(user, { sessionId: opened.sessionId }, audit);
        expect(read.closed).toBe(true);
        expect(read.output).toContain('fixture channel failure');
        const resized = await s.service.resize(user, { sessionId: opened.sessionId, cols: 999, rows: NaN }, audit);
        expect(resized).toMatchObject({ cols: 240, rows: 10, closed: true });
        expect(channel.setWindow).toHaveBeenCalledWith(10, 240, 0, 0);
        delete (channel as Partial<typeof channel>).setWindow;
        await expect(s.service.resize(user, { sessionId: opened.sessionId, cols: 40, rows: 80 }, audit)).resolves.toMatchObject({ cols: 40, rows: 80 });
    });
    it.each([{ tenantId: 8 }, { sub: '10' }, { tokenId: 12 }])('isolates session by tenant/user/token %j', async (other) => {
        const s = setup(), opened = await s.open(), actor = { ...user, ...other } as JwtPayload, context = { ...audit, ...other };
        await expect(s.service.read(actor, { sessionId: opened.sessionId }, context)).rejects.toMatchObject({ statusCode: 'tokenId' in other ? 403 : 404 });
        expect(clients()[0]!.destroy).not.toHaveBeenCalled();
    });
    it('requires session ID and prevents use after close', async () => { const s = setup(); await expect(s.service.read(user, { sessionId: ' ' }, audit)).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_SESSION_ID_REQUIRED' }); const opened = await s.open(); await s.service.close(user, { sessionId: opened.sessionId }, audit); await expect(s.service.read(user, { sessionId: opened.sessionId }, audit)).rejects.toMatchObject({ statusCode: 404 }); expect(trial.stop).toHaveBeenCalledOnce(); expect(clients()[0]!.destroy).toHaveBeenCalledOnce(); });
    it('allows same-tenant admin termination but rejects user, missing ID and foreign tenant', async () => { const s = setup(), opened = await s.open(); await expect(s.service.closeAsAdmin({ ...user, role: 'user' }, { sessionId: opened.sessionId })).rejects.toMatchObject({ statusCode: 403 }); await expect(s.service.closeAsAdmin(user, { sessionId: '' })).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_SESSION_ID_REQUIRED' }); await expect(s.service.closeAsAdmin({ ...user, tenantId: 8 }, { sessionId: opened.sessionId })).rejects.toMatchObject({ statusCode: 404 }); await expect(s.service.closeAsAdmin({ ...user, sub: '20' }, { sessionId: opened.sessionId })).resolves.toMatchObject({ closed: true, reason: 'admin_closed' }); expect(s.logs.logAdminEvent.mock.calls.at(-1)![0]).toMatchObject({ adminId: 20 }); });
    it('clamps TTL/size and expires exactly at deadline', async () => { const s = setup(), opened = await s.service.open(user, { ...input, ttlSeconds: 1, cols: 1, rows: 999 }, audit); expect(Date.parse(opened.expiresAt) - Date.now()).toBe(60000); expect(clients()[0]!.shellOptions).toMatchObject({ cols: 40, rows: 80 }); await vi.advanceTimersByTimeAsync(59999); expect(clients()[0]!.destroy).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(clients()[0]!.destroy).toHaveBeenCalledOnce(); expect((JSON.parse(s.logs.logAdminEvent.mock.calls.at(-1)![0].details) as { reason: string }).reason).toBe('ttl_expired'); await expect(s.service.read(user, { sessionId: opened.sessionId }, audit)).rejects.toMatchObject({ statusCode: 404 }); });
    it('closes on connection and trial events, including trial tracking', async () => { const s = setup(); trial.capability.mockResolvedValue({ id: 1 }); await s.open(); expect(s.repo.startSession).toHaveBeenCalledWith(9, 10, { connectionMethod: 'direct', routeSnapshot: { trialResource: 'mcp_interactive' } }, 7); const revoke = trial.monitor.mock.calls[0]![2]; revoke(); await tick(); expect(clients()[0]!.destroy).toHaveBeenCalledOnce(); expect(s.repo.endSession).toHaveBeenCalledWith(41); await s.open(); clients()[1]!.emit('close'); await tick(); expect(clients()[1]!.destroy).toHaveBeenCalledOnce(); });
    it('preserves access and cleanup when telemetry, persistence or cleanup fail', async () => { const s = setup(); s.logs.logAdminEvent.mockRejectedValue(new Error('logs offline')); s.db.$executeRaw.mockRejectedValue(new Error('db offline')); s.webhooks.publishEvent.mockRejectedValue(new Error('webhook offline')); const opened = await s.open(); clients()[0]!.destroy.mockImplementation(() => { throw Error('already gone'); }); await expect(s.service.close(user, { sessionId: opened.sessionId }, audit)).resolves.toMatchObject({ closed: true }); await vi.runAllTimersAsync(); expect(s.logs.logAdminEvent).toHaveBeenCalledTimes(2); });
    it('enforces sequential limits per token and tenant while isolating tenants', async () => { const s = setup(); await s.open(); await s.open(); await expect(s.open()).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_TOKEN_SESSION_LIMIT' }); await s.service.open(user, input, { ...audit, tokenId: 12 }); await expect(s.service.open(user, input, { ...audit, tokenId: 13 })).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_TENANT_SESSION_LIMIT' }); await expect(s.service.open({ ...user, tenantId: 8 }, input, audit)).resolves.toHaveProperty('sessionId'); expect(io.clients).toHaveLength(4); });
    it('truncates long reason and clamps maximum TTL', async () => { const s = setup(), result = await s.service.open(user, { ...input, reason: 'r'.repeat(501), ttlSeconds: 99999 }, audit); expect(Date.parse(result.expiresAt) - Date.now()).toBe(180000); expect(s.db.$executeRaw.mock.calls[0]![0].values).toContain('r'.repeat(500) + '...[truncado]'); });
});
describe('MCP regression probes', () => {
    it('reserves per-token capacity while concurrent opens are pending', async () => {
        const s = setup();
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN = 1;
        const results = await Promise.allSettled([s.open(), s.open()]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    });
    it('respects maxBytes for multibyte UTF-8 output', async () => {
        const s = setup(), opened = await s.open();
        clients()[0]!.channel.push(Buffer.from('éé'));
        await tick();
        const result = await s.service.read(user, { sessionId: opened.sessionId, maxBytes: 3 }, audit);
        expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(3);
        expect(result.output).toBe('é');
    });
});
describe('MCP reservation lifetime and UTF-8 cursors', () => {
    it('bounds a burst of simultaneous opens before creating SSH clients', async () => {
        const s = setup();
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN = 3;
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT = 3;
        const results = await Promise.allSettled(Array.from({ length: 20 }, () => s.open()));
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(17);
        expect(io.clients).toHaveLength(3);
    });
    it('reserves tenant capacity across tokens but leaves other tenants independent', async () => {
        const s = setup();
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT = 1;
        let release!: (value: typeof s.host) => void;
        s.repo.findHostWithCredentials.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = s.open();
        await tick();
        await expect(s.service.open(user, input, { ...audit, tokenId: 12 })).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_TENANT_SESSION_LIMIT' });
        await expect(s.service.open({ ...user, tenantId: 8 }, input, audit)).resolves.toHaveProperty('sessionId');
        release(s.host);
        await expect(pending).resolves.toHaveProperty('sessionId');
        expect(io.clients).toHaveLength(2);
    });
    it.each(['host', 'acl', 'trial', 'provider', 'credential', 'connect'])('releases reservation after %s failure so the next attempt can use the slot', async (failure) => {
        const s = setup();
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN = 1;
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT = 1;
        if (failure === 'host')
            s.repo.findHostWithCredentials.mockResolvedValueOnce(null);
        if (failure === 'acl')
            s.repo.hasEffectiveHostPermission.mockResolvedValueOnce(false);
        if (failure === 'trial')
            trial.capability.mockRejectedValueOnce(new Error('fixture denied'));
        if (failure === 'provider') {
            s.host.onePasswordRef = 'op://fixture';
            s.secrets.resolve.mockRejectedValueOnce(new Error('fixture provider offline'));
        }
        if (failure === 'credential')
            s.host.passwordEncrypted = 'invalid encrypted payload';
        if (failure === 'connect')
            io.failures.push('connect');
        await expect(s.open()).rejects.toThrow();
        s.host.passwordEncrypted = JSON.stringify(encrypt('fixture-password'));
        await expect(s.open()).resolves.toHaveProperty('sessionId');
        expect(io.clients).toHaveLength(failure === 'connect' ? 2 : 1);
    });
    it('promotes pending to active without double-counting while persistence is pending', async () => {
        const s = setup();
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT = 2;
        let persist!: (value: number) => void;
        s.db.$executeRaw.mockImplementationOnce(() => new Promise(resolve => { persist = resolve; }));
        const first = s.open();
        await tick();
        expect(s.db.$executeRaw).toHaveBeenCalledOnce();
        await expect(s.open()).resolves.toHaveProperty('sessionId');
        expect(io.clients).toHaveLength(2);
        persist(1);
        await first;
        await expect(s.open()).rejects.toMatchObject({ code: 'MCP_INTERACTIVE_SSH_TENANT_SESSION_LIMIT' });
    });
    it('reuses capacity after closing the previous session', async () => {
        const s = setup();
        env.MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN = 1;
        const opened = await s.open();
        await s.service.close(user, { sessionId: opened.sessionId }, audit);
        await expect(s.open()).resolves.toHaveProperty('sessionId');
        expect(io.clients).toHaveLength(2);
    });
    it('preserves string cursor units across astral and multibyte characters', async () => {
        const s = setup(), opened = await s.open();
        clients()[0]!.channel.push(Buffer.from('😀xé'));
        await tick();
        const first = await s.service.read(user, { sessionId: opened.sessionId, maxBytes: 4 }, audit);
        expect(first).toMatchObject({ output: '😀', cursor: 2 });
        const second = await s.service.read(user, { sessionId: opened.sessionId, cursor: first.cursor, maxBytes: 1 }, audit);
        expect(second).toMatchObject({ output: 'x', cursor: 3 });
        const third = await s.service.read(user, { sessionId: opened.sessionId, cursor: second.cursor, maxBytes: 2 }, audit);
        expect(third).toMatchObject({ output: 'é', cursor: 4 });
        const counters = s.db.$executeRaw.mock.calls.slice(-3).map(([query]) => query.values[0]);
        expect(counters).toEqual([4, 1, 2]);
    });
    it('does not split a codepoint or consume cursor when the byte budget is too small', async () => {
        const s = setup(), opened = await s.open();
        clients()[0]!.channel.push(Buffer.from('😀'));
        await tick();
        const small = await s.service.read(user, { sessionId: opened.sessionId, maxBytes: 3 }, audit);
        expect(small).toMatchObject({ output: '', cursor: 0 });
        const enough = await s.service.read(user, { sessionId: opened.sessionId, cursor: small.cursor, maxBytes: 4 }, audit);
        expect(enough).toMatchObject({ output: '😀', cursor: 2 });
    });
});
