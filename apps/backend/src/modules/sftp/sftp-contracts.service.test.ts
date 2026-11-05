import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable, PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { encrypt } from '../../shared/crypto.js';
import { SftpService } from './sftp.service.js';
const io = vi.hoisted<{
    clients: unknown[];
    api: Record<string, unknown>;
    failures: Array<'connect' | 'forward' | 'sftp' | undefined>;
}>(() => ({ clients: [], api: {}, failures: [] }));
const trial = vi.hoisted(() => ({ host: vi.fn(), user: vi.fn(), resource: vi.fn(), monitor: vi.fn(), stop: vi.fn() }));
vi.mock('../trials/trial-policy.js', () => ({ assertTrialHostAccess: trial.host, assertTrialUserAccess: trial.user, assertTrialResource: trial.resource, monitorTrialAccess: trial.monitor, trialDenied: () => new Error('trial expired') }));
vi.mock('../../config/logger.js', () => ({ logger: { error: vi.fn() } }));
vi.mock('ssh2', () => ({ Client: class extends EventEmitter {
        config: unknown;
        failure = io.failures.shift();
        end = vi.fn(() => { this.emit('close'); });
        destroy = vi.fn(() => { this.emit('close'); });
        constructor() { super(); io.clients.push(this); }
        connect(config: unknown) { this.config = config; queueMicrotask(() => this.failure === 'connect' ? this.emit('error', new Error('connection failed')) : this.emit('ready')); return this; }
        sftp(callback: (error: Error | null, sftp?: unknown) => void) { callback(this.failure === 'sftp' ? new Error('subsystem failed') : null, io.api); }
        forwardOut(_host: string, _port: number, _dest: string, _destPort: number, callback: (error: Error | null, stream?: unknown) => void) { callback(this.failure === 'forward' ? new Error('forward failed') : null, new PassThrough()); }
    } }));
type FakeClient = EventEmitter & {
    config: Record<string, unknown>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
};
function clients() { return io.clients as FakeClient[]; }
function setup() {
    const host = { id: 10, tenantId: 7, deviceProfile: 'server_ssh', ip: 'fixture.internal', port: 2222, sshUser: 'fixture', authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt('fixture-password')), pemKey: null as null | {
            encryptedKey: string;
            iv: string;
            encryptedPassphrase?: string;
            passphraseIv?: string;
        }, onePasswordRef: null as string | null, bastion: null as Record<string, unknown> | null };
    const repo = { findHostWithCredentials: vi.fn().mockResolvedValue(host), hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) };
    const secrets = { resolve: vi.fn().mockResolvedValue('resolved-secret') };
    const service = new SftpService(repo as never, secrets as never);
    return { host, repo, secrets, service };
}
const args = [10, 9, 7, 'user'] as const;
beforeEach(() => {
    io.clients.length = 0;
    io.failures.length = 0;
    vi.clearAllMocks();
    trial.host.mockResolvedValue(null);
    trial.user.mockResolvedValue({ id: 7 });
    trial.resource.mockResolvedValue(undefined);
    trial.monitor.mockReturnValue(trial.stop);
    io.api = { realpath: vi.fn((_path: string, cb: (error: Error | null, path?: string) => void) => cb(null, '/home/fixture')) };
});
describe('SFTP connection contracts', () => {
    it('decrypts direct password and closes after ping with scoped ACL check', async () => {
        const s = setup();
        await expect(s.service.ping(...args)).resolves.toEqual({ ok: true, home: '/home/fixture' });
        expect(s.repo.findHostWithCredentials).toHaveBeenCalledWith(10, 7);
        expect(s.repo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 7, 9, 'connect', 'USER');
        expect(clients()[0]!.config).toMatchObject({ host: 'fixture.internal', port: 2222, username: 'fixture', password: 'fixture-password', readyTimeout: 15000, keepaliveInterval: 10000 });
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
    it('rejects missing host and denied ACL before connecting or resolving secrets', async () => {
        const s = setup();
        s.repo.findHostWithCredentials.mockResolvedValueOnce(null);
        await expect(s.service.ping(...args)).rejects.toThrow('Host');
        s.repo.hasEffectiveHostPermission.mockResolvedValueOnce(false);
        await expect(s.service.ping(...args)).rejects.toThrow('Sem permissão');
        expect(io.clients).toHaveLength(0);
        expect(s.secrets.resolve).not.toHaveBeenCalled();
    });
    it('decrypts combined PEM/password/passphrase and normalizes admin ACL role', async () => {
        const s = setup(), pem = encrypt('fixture-pem'), passphrase = encrypt('fixture-passphrase');
        s.host.authType = 'PEM_PASSWORD';
        s.host.pemKey = { encryptedKey: pem.encrypted, iv: pem.iv, encryptedPassphrase: passphrase.encrypted, passphraseIv: passphrase.iv };
        await s.service.ping(10, 9, 7, 'AdMiN');
        expect(clients()[0]!.config).toMatchObject({ privateKey: 'fixture-pem', passphrase: 'fixture-passphrase', password: 'fixture-password' });
        expect(s.repo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 7, 9, 'connect', 'ADMIN');
    });
    it.each(['PASSWORD', 'PEM', 'PEM_PASSWORD'])('resolves scoped 1Password credential for %s', async (authType) => {
        const s = setup();
        s.host.authType = authType;
        s.host.onePasswordRef = 'op://fixture/vault/item';
        await s.service.ping(...args);
        expect(s.secrets.resolve).toHaveBeenCalledWith(7, 'op://fixture/vault/item');
        expect(clients()[0]!.config[authType === 'PEM' ? 'privateKey' : 'password']).toBe('resolved-secret');
    });
    it('sanitizes provider failure before opening a socket', async () => {
        const s = setup();
        s.host.onePasswordRef = 'op://fixture';
        s.secrets.resolve.mockRejectedValueOnce(new Error('secret diagnostic'));
        await expect(s.service.ping(...args)).rejects.toThrow('Falha ao buscar credencial no 1Password');
        expect(io.clients).toHaveLength(0);
    });
    it.each(['connect', 'sftp'] as const)('rejects direct %s failure and closes failed subsystem', async (failure) => {
        const s = setup();
        io.failures.push(failure);
        await expect(s.service.ping(...args)).rejects.toThrow(failure === 'connect' ? 'connection failed' : 'subsystem failed');
        if (failure === 'sftp')
            expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
    it('falls back to root when home resolution fails', async () => {
        io.api.realpath = (_path: string, cb: (error: Error) => void) => cb(new Error('unsupported'));
        await expect(setup().service.ping(...args)).resolves.toEqual({ ok: true, home: '/' });
    });
    it('opens via bastion and closes both connections after operation', async () => {
        const s = setup();
        s.host.bastion = { ...s.host, ip: 'bastion.internal', port: 22 };
        await s.service.ping(...args);
        expect(clients()).toHaveLength(2);
        expect(clients()[0]!.config.host).toBe('bastion.internal');
        expect(clients()[1]!.config.sock).toBeInstanceOf(PassThrough);
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
        expect(clients()[1]!.end).toHaveBeenCalledOnce();
    });
    it.each(['forward', 'target'] as const)('cleans bastion on %s failure', async (failure) => {
        const s = setup();
        s.host.bastion = { ...s.host };
        io.failures.push(failure === 'forward' ? 'forward' : undefined, 'connect');
        await expect(s.service.ping(...args)).rejects.toThrow(failure === 'forward' ? 'forward failed' : 'connection failed');
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
    it('enforces trial resource/user both before and after connection and stops monitor on close', async () => {
        const s = setup();
        trial.host.mockResolvedValue({ id: 7 });
        await s.service.ping(...args);
        expect(trial.resource).toHaveBeenCalledWith(7, 'sftp');
        expect(trial.user).toHaveBeenCalledTimes(2);
        expect(trial.monitor).toHaveBeenCalledWith(7, { id: 7 }, expect.any(Function), { id: 9 }, { id: 10, ip: 'fixture.internal', port: 2222 });
        expect(trial.stop).toHaveBeenCalledOnce();
    });
    it('destroys connections if trial expires while connecting', async () => {
        const s = setup();
        s.host.bastion = { ...s.host };
        trial.host.mockResolvedValue({ id: 7 });
        trial.user.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce(null);
        await expect(s.service.ping(...args)).rejects.toThrow('trial expired');
        expect(clients()[0]!.destroy).toHaveBeenCalledOnce();
        expect(clients()[1]!.destroy).toHaveBeenCalledOnce();
    });
});
describe('SFTP file operation contracts', () => {
    it('maps permissions/types/metadata and normalizes paths including defaults', async () => {
        io.api.readdir = (_path: string, cb: (error: null, entries: unknown[]) => void) => cb(null, [
            { filename: 'dir', attrs: { mode: 0o040755, uid: 10, gid: 20, size: 50, mtime: 100 } },
            { filename: 'link', attrs: { mode: 0o120777 } }, { filename: 'file', attrs: {} },
        ]);
        const result = await setup().service.list(...args, '/home/');
        expect(result.path).toBe('/home/');
        expect(result.entries).toEqual([
            { name: 'dir', path: '/home/dir', type: 'directory', size: 50, permissions: 'rwxr-xr-x', owner: 10, group: 20, modifiedAt: new Date(100000).toISOString() },
            { name: 'link', path: '/home/link', type: 'symlink', size: 0, permissions: 'rwxrwxrwx', owner: 0, group: 0, modifiedAt: new Date(0).toISOString() },
            { name: 'file', path: '/home/file', type: 'file', size: 0, permissions: '---------', owner: 0, group: 0, modifiedAt: new Date(0).toISOString() },
        ]);
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
    it('downloads actual chunks and uploads exact bytes with exclusive flags', async () => {
        let uploaded = Buffer.alloc(0);
        const read = vi.fn(() => Readable.from([Buffer.from('one'), Buffer.from('two')]));
        const write = vi.fn(() => new Writable({ write(chunk: Buffer, _encoding, callback) { uploaded = Buffer.concat([uploaded, chunk]); callback(); } }));
        io.api.createReadStream = read;
        io.api.createWriteStream = write;
        const s = setup();
        await expect(s.service.download(...args, '/input')).resolves.toEqual(Buffer.from('onetwo'));
        await s.service.upload(...args, '/output', Buffer.from([0, 255, 2]), { mode: 0o600, flags: 'wx' });
        expect(uploaded).toEqual(Buffer.from([0, 255, 2]));
        expect(write).toHaveBeenCalledWith('/output', { mode: 0o600, flags: 'wx' });
        expect(read).toHaveBeenCalledWith('/input');
        expect(clients().every(client => client.end.mock.calls.length === 1)).toBe(true);
    });
    it.each(['mkdir', 'rename'] as const)('passes paths through %s and closes after callback errors', async (operation) => {
        const calls: unknown[][] = [];
        io.api[operation] = (...values: unknown[]) => { calls.push(values.slice(0, -1)); (values.at(-1) as (error: Error | null) => void)(calls.length === 1 ? null : new Error('denied')); };
        const s = setup(), run = () => operation === 'mkdir' ? s.service.mkdir(...args, '/new') : s.service.rename(...args, '/old', '/new');
        await run();
        await expect(run()).rejects.toThrow('denied');
        expect(calls).toEqual([operation === 'mkdir' ? ['/new'] : ['/old', '/new'], operation === 'mkdir' ? ['/new'] : ['/old', '/new']]);
        expect(clients().every(client => client.end.mock.calls.length === 1)).toBe(true);
    });
    it.each([null, { code: 2 }, { code: '2' }, new Error('ENOENT')])('replaces file if unlink succeeds or destination absent: %s', async (error) => {
        const rename = vi.fn((_old: string, _new: string, cb: (error: null) => void) => cb(null));
        io.api.unlink = (_path: string, cb: (error: unknown) => void) => cb(error);
        io.api.rename = rename;
        await setup().service.replaceExistingFile(...args, '/temp', '/dest');
        expect(rename).toHaveBeenCalledWith('/temp', '/dest', expect.any(Function));
    });
    it('does not rename after failed unlink and propagates rename failure', async () => {
        const rename = vi.fn((_old: string, _new: string, cb: (error: Error) => void) => cb(new Error('rename failed')));
        io.api.rename = rename;
        io.api.unlink = (_path: string, cb: (error: Error) => void) => cb(new Error('permission denied'));
        const s = setup();
        await expect(s.service.replaceExistingFile(...args, '/temp', '/dest')).rejects.toThrow('permission denied');
        expect(rename).not.toHaveBeenCalled();
        io.api.unlink = (_path: string, cb: (error: null) => void) => cb(null);
        await expect(s.service.replaceExistingFile(...args, '/temp', '/dest')).rejects.toThrow('rename failed');
    });
    it('reads normalized file metadata', async () => {
        io.api.stat = (_path: string, cb: (error: null, attrs: object) => void) => cb(null, { mode: 0o100640, uid: 10, gid: 20, atime: 100, mtime: 200 });
        await expect(setup().service.statFile(...args, '/file')).resolves.toEqual({ mode: 0o640, owner: 10, group: 20, accessedAtEpoch: 100, modifiedAtEpoch: 200 });
    });
    it.each([false, true])('reports each metadata outcome independently (failure=%s)', async (fail) => {
        for (const key of ['chmod', 'chown', 'utimes'])
            io.api[key] = vi.fn((...values: unknown[]) => { (values.at(-1) as (error: unknown) => void)(fail ? new Error(`${key} denied`) : null); });
        const s = setup();
        const result = await s.service.applyFileMetadata(...args, '/file', { mode: 0o640, owner: 10, group: 20, accessedAtEpoch: 100, modifiedAtEpoch: 200 });
        expect(result).toEqual({ mode: !fail, ownership: !fail, timestamps: !fail, skipped: [], errors: fail ? ['chmod: chmod denied', 'chown: chown denied', 'utimes: utimes denied'] : [] });
        expect(io.api.chmod).toHaveBeenCalledWith('/file', 0o640, expect.any(Function));
        expect(io.api.chown).toHaveBeenCalledWith('/file', 10, 20, expect.any(Function));
        expect(io.api.utimes).toHaveBeenCalledWith('/file', 100, 200, expect.any(Function));
    });
    it('skips absent metadata rather than inventing values', async () => {
        await expect(setup().service.applyFileMetadata(...args, '/file', {})).resolves.toEqual({ mode: false, ownership: false, timestamps: false, skipped: ['mode', 'ownership', 'timestamps'], errors: [] });
    });
    it.each([0o040755, 0o100644, undefined])('chooses directory/file delete for mode %s', async (mode) => {
        io.api.stat = (_path: string, cb: (error: null, attrs: object) => void) => cb(null, { mode });
        const remove = vi.fn((_path: string, cb: (error: null) => void) => cb(null)), unlink = vi.fn((_path: string, cb: (error: null) => void) => cb(null));
        io.api.rmdir = remove;
        io.api.unlink = unlink;
        await setup().service.delete(...args, '/target');
        expect(mode === 0o040755 ? remove : unlink).toHaveBeenCalledWith('/target', expect.any(Function));
        expect(mode === 0o040755 ? unlink : remove).not.toHaveBeenCalled();
    });
    it.each(['none', 'open', 'close'])('creates file and closes handle with %s failure', async (failure) => {
        const handle = Buffer.from('handle'), close = vi.fn((_handle: Buffer, cb: (error: Error | null) => void) => cb(failure === 'close' ? new Error('close failed') : null));
        const open = vi.fn((_path: string, _flags: string, cb: (error: Error | null, handle: Buffer) => void) => cb(failure === 'open' ? new Error('open failed') : null, handle));
        io.api.open = open;
        io.api.close = close;
        const operation = setup().service.createFile(...args, '/file');
        if (failure === 'none')
            await operation;
        else
            await expect(operation).rejects.toThrow(`${failure} failed`);
        expect(open).toHaveBeenCalledWith('/file', 'w', expect.any(Function));
        if (failure !== 'open')
            expect(close).toHaveBeenCalledWith(handle, expect.any(Function));
        else
            expect(close).not.toHaveBeenCalled();
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
    it('reads UTF8 content, checksum and metadata using real streams', async () => {
        const content = Buffer.from('config=ação\n');
        io.api.stat = (_path: string, cb: (error: null, attrs: object) => void) => cb(null, { size: content.length, mode: 0o100600, uid: 10, gid: 20, atime: 100, mtime: 200 });
        io.api.createReadStream = () => Readable.from([content]);
        await expect(setup().service.readFile(...args, '/file')).resolves.toEqual({ content: content.toString(), size: content.length, truncated: false, hash: createHash('sha256').update(content).digest('hex'), mode: 0o600, owner: 10, group: 20, accessedAt: new Date(100000).toISOString(), modifiedAt: new Date(200000).toISOString(), accessedAtEpoch: 100, modifiedAtEpoch: 200 });
    });
    it.each(['single', 'boundary'])('truncates oversized %s stream at1MiB and omits misleading checksum', async (kind) => {
        io.api.stat = (_path: string, cb: (error: Error) => void) => cb(new Error('stat unavailable'));
        io.api.createReadStream = () => Readable.from(kind === 'single' ? [Buffer.alloc(1048577, 'a')] : [Buffer.alloc(1048576, 'a'), Buffer.from('extra')]);
        const result = await setup().service.readFile(...args, '/large');
        expect(result.content).toHaveLength(1048576);
        expect(result.truncated).toBe(true);
        expect(result.hash).toBeNull();
        expect(result.mode).toBeNull();
        expect(result.owner).toBeNull();
        expect(result.modifiedAt).toBeNull();
    });
    it.each(['list', 'statFile', 'delete'] as const)('propagates %s callback errors and closes connection', async (operation) => {
        const error = new Error('permission denied');
        io.api.readdir = (_path: string, cb: (error: Error) => void) => cb(error);
        io.api.stat = io.api.readdir;
        await expect(setup().service[operation](...args, '/file')).rejects.toBe(error);
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
    it.each(['download', 'readFile'] as const)('propagates %s stream errors and closes connection', async (operation) => {
        io.api.stat = (_path: string, cb: (error: Error) => void) => cb(new Error('no stat'));
        io.api.createReadStream = () => new Readable({ read() { this.destroy(new Error('stream failed')); } });
        await expect(setup().service[operation](...args, '/file')).rejects.toThrow('stream failed');
        expect(clients()[0]!.end).toHaveBeenCalledOnce();
    });
});
