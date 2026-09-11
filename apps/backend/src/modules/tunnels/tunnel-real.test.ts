import net from 'node:net'
import { generateKeyPairSync, createHash } from 'node:crypto'
import { once } from 'node:events'
import { Server, utils } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
import { TunnelService } from './tunnel.service.js'

// Opt-in: real SSH and TCP on disposable loopback ports. No remote hosts or database.
describe.runIf(process.env.RUN_TUNNEL_REAL === 'true')('real SSH forwarding', () => {
  it.each(['direct', 'bastion'])('forwards bytes through %s, verifies trust, allocates a fallback port and closes', async route => {
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' })
    const echo = net.createServer(socket => { socket.on('error', () => {}); socket.pipe(socket) })
    const occupied = net.createServer()
    const peers: Array<{ end: () => void }> = []
    const ssh = new Server({ hostKeys: [key] }, client => {
      peers.push(client)
      client.on('error', () => {})
      client.on('authentication', ctx => ctx.accept())
      client.on('ready', () => client.on('tcpip', (accept, reject, info) => {
        const target = net.connect(info.destPort, '127.0.0.1')
        target.on('error', () => { reject(); target.destroy() })
        target.once('connect', () => {
          const stream = accept()
          stream.on('error', () => target.destroy())
          stream.on('close', () => target.destroy())
          target.pipe(stream).pipe(target)
        })
      }))
    })
    let service: TunnelService | undefined, tunnelId: string | undefined, client: net.Socket | undefined
    try {
      echo.listen(0, '127.0.0.1'); await once(echo, 'listening')
      occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening')
      ssh.listen(0, '127.0.0.1'); await once(ssh, 'listening')
      const sshPort = (ssh.address() as net.AddressInfo).port
      const localPort = (occupied.address() as net.AddressInfo).port
      const remotePort = (echo.address() as net.AddressInfo).port
      const host = { id: 7, tenantId: 1, name: 'disposable-ssh', ip: '127.0.0.1', port: sshPort, sshUser: 'test', authType: 'PASSWORD', connectionMode: 'DIRECT', trustedHostKeyFingerprint: `SHA256:${createHash('sha256').update((utils.parseKey(key) as import('ssh2').ParsedKey).getPublicSSH()).digest('base64')}`, bastion: route === 'bastion' ? { ip: '127.0.0.1', port: sshPort, sshUser: 'jump', authType: 'PASSWORD' } : null }
      service = new TunnelService({
        findHostWithCredentials: vi.fn().mockImplementation(async () => host),
        hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
      } as never, {} as never, { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never)
      const trusted = host.trustedHostKeyFingerprint
      for (const fingerprint of ['', 'SHA256:unexpected']) {
        host.trustedHostKeyFingerprint = fingerprint
        await expect(service.create(1100, 1, 'user', 7, 0, '127.0.0.1', remotePort)).rejects.toMatchObject({
          code: fingerprint ? 'HOST_KEY_CHANGED' : 'HOST_KEY_VERIFICATION_REQUIRED',
        })
        expect(service.listForUser(1100, 1)).toEqual([])
        expect((await service.testTarget(1100, 1, 'user', 7, '127.0.0.1', remotePort)).success).toBe(false)
      }
      host.trustedHostKeyFingerprint = trusted
      expect((await service.testTarget(1100, 1, 'user', 7, '127.0.0.1', remotePort)).success).toBe(true)
      const tunnel = await service.create(1100, 1, 'user', 7, localPort, '127.0.0.1', remotePort)
      tunnelId = tunnel.id
      expect(tunnel.usedPortFallback).toBe(true)
      expect(tunnel.assignedLocalPort).not.toBe(localPort)
      expect(tunnel.bindAddress).toBe('127.0.0.1')
      client = net.connect(tunnel.assignedLocalPort, '127.0.0.1')
      await once(client, 'connect')
      const response = once(client, 'data')
      client.write('tunnel-echo-ação')
      expect((await response)[0].toString()).toBe('tunnel-echo-ação')
      client.destroy()
      await service.closeForUser(tunnel.id, 1100, 1)
      expect(service.listForUser(1100, 1)).toEqual([])
      const probe = net.connect(tunnel.assignedLocalPort, '127.0.0.1')
      const [error] = await once(probe, 'error')
      expect(error.code).toBe('ECONNREFUSED')
      probe.destroy()
      const disconnected = await service.create(1100, 1, 'user', 7, 0, '127.0.0.1', remotePort)
      tunnelId = disconnected.id
      peers.at(-1)!.end()
      await vi.waitFor(() => expect(service!.listForUser(1100, 1)).toEqual([]))
    } finally {
      client?.destroy()
      if (service && tunnelId) await service.close(tunnelId)
      for (const peer of peers) peer.end()
      echo.close(); occupied.close(); ssh.close()
    }
  }, 20000)
})
