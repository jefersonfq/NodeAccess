import { configureCurrentSessionReader } from '../auth/current-session.js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { Server, utils, type Connection, type ParsedKey } from 'ssh2'
import { SftpService } from './sftp.service.js'
import { connectTunnelSsh } from '../tunnels/tunnel-ssh-connection.js'
import { encrypt } from '../../shared/crypto.js'
import type { AppEvent } from '../app-events/app-event.bus.js'

// Real loopback SSH/SFTP, synthetic repository/ACL/event delivery; no REST/UI claim.
describe.runIf(process.env.RUN_TUNNEL_REAL === 'true')('SSH identity and active SFTP revocation', () => {
  const servers: Server[] = []
  const peers = new Set<Connection>()
  const sockets = new Set<Socket>()
  async function fixture() {
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
    const fingerprint = `SHA256:${createHash('sha256').update((utils.parseKey(key) as ParsedKey).getPublicSSH()).digest('base64')}`
    const stats = { auth: 0, reads: 0, writes: 0 }
    const server = new Server({ hostKeys: [key] }, client => {
      peers.add(client)
      client.on('error', () => {})
      client.on('close', () => peers.delete(client))
      client.on('authentication', context => {
        if (context.method === 'password' && context.password === 'synthetic-only') { stats.auth++; context.accept() }
        else context.reject()
      })
      client.on('ready', () => {
        client.on('tcpip', (accept, reject, info) => {
          if (info.destIP !== '127.0.0.1') { reject(); return }
          const socket = connect(info.destPort, '127.0.0.1')
          sockets.add(socket)
          socket.on('close', () => sockets.delete(socket))
          socket.on('error', () => { reject(); socket.destroy() })
          socket.once('connect', () => {
            const channel = accept()
            channel.on('error', () => socket.destroy())
            channel.on('close', () => socket.destroy())
            socket.pipe(channel).pipe(socket)
          })
        })
        client.on('session', accept => accept().on('sftp', acceptSftp => {
          const stream = acceptSftp()
          stream.on('REALPATH', id => stream.name(id, [{ filename: '/', longname: '/', attrs: {} }]))
          stream.on('OPEN', id => stream.handle(id, Buffer.from('file')))
          stream.on('FSTAT', id => stream.attrs(id, { size: 1024, mode: 33188, uid: 1, gid: 1, atime: 1, mtime: 1 }))
          stream.on('READ', () => { stats.reads++ }) // deliberately pending until access is revoked
          stream.on('WRITE', () => { stats.writes++ })
          stream.on('CLOSE', id => stream.status(id, 0))
        }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    return { port: (server.address() as { port: number }).port, fingerprint, stats }
  }
  let target: Awaited<ReturnType<typeof fixture>>, bastion: Awaited<ReturnType<typeof fixture>>
  beforeAll(async () => { target = await fixture(); bastion = await fixture() })
  afterEach(() => configureCurrentSessionReader(undefined))
  afterAll(async () => {
    for (const socket of sockets) socket.destroy()
    for (const peer of peers) peer.end()
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  })
  function setup(targetKey: string | null | undefined, viaBastion = false, bastionKey: string | null | undefined = bastion.fingerprint) {
    const passwordEncrypted = JSON.stringify(encrypt('synthetic-only'))
    const credentials = { ip: '127.0.0.1', port: target.port, sshUser: 'probe', authType: 'PASSWORD', passwordEncrypted, pemKey: null }
    const host = { ...credentials, id: 1, tenantId: 7, deviceProfile: 'server_ssh', onePasswordRef: null,
      trustedHostKeyFingerprint: targetKey, bastion: viaBastion ? { ...credentials, port: bastion.port, sourceHostId: 2, trustedHostKeyFingerprint: bastionKey } : null }
    const repo = { findHostWithCredentials: vi.fn(() => Promise.resolve(host)), hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) }
    let listener: (event: AppEvent) => Promise<void>
    const bus = { onEvent: (callback: typeof listener) => { listener = callback } }
    const service = new SftpService(repo as never, {} as never, bus as never)
    return { service, repo, emit: (event: AppEvent) => listener(event), ping: () => service.ping(1, 9, 7, 'user') }
  }
  it.each([false, true])('accepts matching identities (bastion=%s)', async hop => {
    const s = setup(target.fingerprint, hop)
    await expect(s.ping()).resolves.toEqual({ ok: true, home: '/' })
    expect(s.repo.hasEffectiveHostPermission).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, null, '', 'SHA256:changed'])('rejects target key %s before target authentication', async key => {
    const before = target.stats.auth
    await expect(setup(key).ping()).rejects.toMatchObject({ code: key ? 'HOST_KEY_CHANGED' : 'HOST_KEY_VERIFICATION_REQUIRED' })
    expect(target.stats.auth).toBe(before)
  })
  it.each([undefined, null, '', 'SHA256:changed'])('rejects bastion key %s before either authentication', async key => {
    const before = [target.stats.auth, bastion.stats.auth]
    const s = setup(target.fingerprint, true, null)
    ;(await s.repo.findHostWithCredentials()).bastion!.trustedHostKeyFingerprint = key
    await expect(s.ping()).rejects.toMatchObject({ code: key ? 'BASTION_HOST_KEY_CHANGED' : 'BASTION_HOST_KEY_VERIFICATION_REQUIRED' })
    expect([target.stats.auth, bastion.stats.auth]).toEqual(before)
  })
  it('rejects swapped target key after trusted bastion without target authentication', async () => {
    const before = target.stats.auth
    await expect(setup(bastion.fingerprint, true).ping()).rejects.toMatchObject({ code: 'HOST_KEY_CHANGED' })
    expect(target.stats.auth).toBe(before)
  })
  it('verifies tunnel bastion independently of target', async () => {
    const config = (port: number) => ({ host: '127.0.0.1', port, username: 'probe', password: 'synthetic-only' })
    const before = bastion.stats.auth
    await expect(connectTunnelSsh(config(target.port), target.fingerprint, config(bastion.port), target.fingerprint)).rejects.toMatchObject({ code: 'BASTION_HOST_KEY_CHANGED' })
    expect(bastion.stats.auth).toBe(before)
    const client = await connectTunnelSsh(config(target.port), target.fingerprint, config(bastion.port), bastion.fingerprint)
    client.end()
  })
  const event = { type: 'inventory_acl_changed', tenantId: 7, inventoryNodeId: 1, hostId: 1, actorId: 2, principalType: 'USER', principalId: 9, action: 'delete', changedAt: '2026-11-15T12:00:00Z' } as const
  it('denies a permission removed while connecting before any SFTP operation', async () => {
    const s = setup(target.fingerprint, true)
    s.repo.hasEffectiveHostPermission.mockResolvedValueOnce(true).mockResolvedValue(false)
    await expect(s.ping()).rejects.toThrow('revogado')
  })
  it.each(['download', 'upload', 'readFile'] as const)('revokes active %s across target and bastion; unrelated tenant stays live', async operation => {
    const s = setup(target.fingerprint, true)
    const before = operation !== 'upload' ? target.stats.reads : target.stats.writes
    const transfer = operation === 'upload' ? s.service.upload(1, 9, 7, 'user', '/file', Buffer.from('partial')) : s.service[operation](1, 9, 7, 'user', '/file')
    let transferError: unknown
    const outcome = transfer.then(() => ({ completed: true }), error => { transferError = error; return { completed: false } })
    await vi.waitFor(() => { if (transferError) throw transferError instanceof Error ? transferError : new Error('Unexpected transfer failure', { cause: transferError }); expect(operation !== 'upload' ? target.stats.reads : target.stats.writes).toBeGreaterThan(before) }, { timeout: 5000 })
    await s.emit({ ...event, tenantId: 8 })
    expect((s.service as unknown as { connections: Set<unknown> }).connections.size).toBe(1)
    s.repo.hasEffectiveHostPermission.mockResolvedValue(false)
    await s.emit(event)
    expect(await outcome).toEqual({ completed: false })
    expect(transferError).toBeInstanceOf(Error)
    await vi.waitFor(() => expect((s.service as unknown as { connections: Set<unknown> }).connections.size).toBe(0))
    await expect(s.ping()).rejects.toThrow('Sem permissão')
  })
  const state = { tenantId: 1, active: false, deletedAt: null, tenantActive: true, targetTenantActive: true, sessionVersion: 2, role: 'USER', isPlatformAdmin: true, canManageHosts: true, canViewLiveSessions: true } as const
  const revoked = { type: 'user_sessions_revoked', tenantId: 1, userId: 9, sessionVersion: 2, reason: 'user_deactivated', changedAt: '2026-11-15T12:00:00Z' } as const
  it('revokes pending connection before transport starts, validating authentication origin', async () => {
    configureCurrentSessionReader(() => Promise.resolve(state))
    const s = setup(target.fingerprint)
    const host = await s.repo.findHostWithCredentials()
    let release!: () => void
    s.repo.findHostWithCredentials.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(host) }))
    const before = target.stats.auth
    const opening = s.ping()
    const outcome = opening.then(() => null, (error: unknown) => error)
    await s.emit({ ...revoked, tenantId: 8 })
    expect((s.service as unknown as { connections: Set<{ revoked: boolean }> }).connections.values().next().value?.revoked).toBe(false)
    await s.emit(revoked)
    release()
    expect(await outcome).toMatchObject({ message: 'Acesso SFTP revogado' })
    expect(target.stats.auth).toBe(before)
  })
  it('revokes a delegated live transfer by validated authentication tenant, preserving other users', async () => {
    configureCurrentSessionReader(() => Promise.resolve(state))
    const s = setup(target.fingerprint, true), before = target.stats.reads
    const outcome = s.service.download(1, 9, 7, 'user', '/file').then(() => null, (error: unknown) => error)
    await vi.waitFor(() => expect(target.stats.reads).toBeGreaterThan(before), { timeout: 5000 })
    await s.emit({ ...revoked, userId: 10 })
    expect((s.service as unknown as { connections: Set<unknown> }).connections.size).toBe(1)
    await s.emit(revoked)
    expect(await outcome).toBeInstanceOf(Error)
    await vi.waitFor(() => expect((s.service as unknown as { connections: Set<unknown> }).connections.size).toBe(0))
  })
  it('fails closed when current ACL cannot be read during membership change', async () => {
    const s = setup(target.fingerprint), before = target.stats.reads
    const outcome = s.service.download(1, 9, 7, 'user', '/file').then(() => null, (error: unknown) => error)
    await vi.waitFor(() => expect(target.stats.reads).toBeGreaterThan(before), { timeout: 5000 })
    s.repo.hasEffectiveHostPermission.mockRejectedValue(new Error('storage unavailable'))
    await s.emit({ type: 'user_acl_membership_changed', tenantId: 7, userId: 9, actorId: 2, previousGroupIds: [1], nextGroupIds: [], changedAt: event.changedAt })
    expect(await outcome).toBeInstanceOf(Error)
  })

})
