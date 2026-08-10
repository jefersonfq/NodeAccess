import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('ready')); return this }
    end() { this.emit('end') }
    forwardOut(_sourceHost: string, _sourcePort: number, _remoteHost: string, _remotePort: number, callback: (error?: Error) => void) { callback() }
  }
  return { Client }
})

import { describeConcurrentHostTunnels, TunnelService, type TunnelInfo } from './tunnel.service.js'

function tunnel(id: string, hostId: number, sessionId: string): TunnelInfo {
  return {
    id, userId: 1, tenantId: 1, hostId, hostName: `host-${hostId}`, connectionMethod: 'direct',
    bindAddress: '127.0.0.1', localPort: 8000, requestedLocalPort: 8000, assignedLocalPort: 8000,
    usedPortFallback: false, remoteHost: '127.0.0.1', remotePort: 80, createdAt: new Date(), sessionId,
  }
}

describe('describeConcurrentHostTunnels', () => {
  it('informa túneis do mesmo host em outras abas', () => {
    const message = describeConcurrentHostTunnels([
      tunnel('a', 7, 'session-1'), tunnel('b', 7, 'session-2'), tunnel('c', 7, 'session-2'),
    ], 7, 'session-3')
    expect(message).toContain('3 túnel(is)')
    expect(message).toContain('2 outra(s) aba(s)')
    expect(message).toContain('reutilizará os mesmos túneis')
  })

  it('ignora a sessão atual e outros hosts', () => {
    expect(describeConcurrentHostTunnels([tunnel('a', 7, 'session-3'), tunnel('b', 8, 'session-2')], 7, 'session-3')).toBeNull()
  })

  it('reutiliza um único túnel entre abas do mesmo usuário e fecha somente após a última', async () => {
    const sshRepo = {
      getAutoStartForwardings: vi.fn().mockResolvedValue([{ id: 50, localPort: 0, remoteHost: '127.0.0.1', remotePort: 8080, bindAddress: '127.0.0.1', description: 'web' }]),
      findHostWithCredentials: vi.fn().mockResolvedValue({ id: 7, tenantId: 1, name: 'host-7', ip: '10.0.0.7', port: 22, sshUser: 'root', authType: 'PASSWORD', passwordEncrypted: null, pemKey: null, onePasswordRef: null, connectionMode: 'DIRECT' }),
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
    }
    const service = new TunnelService(
      sshRepo as never,
      { resolve: vi.fn() } as never,
      { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
    )

    const first = await service.autoStartForSession('session-1', 101, 1, 7, 'user')
    const second = await service.autoStartForSession('session-2', 101, 1, 7, 'user')
    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    expect(second.ok[0]?.id).toBe(first.ok[0]?.id)
    expect(service.listForUser(101)).toHaveLength(1)

    const anotherUser = await service.autoStartForSession('session-other-user', 102, 1, 7, 'user')
    expect(anotherUser.ok[0]?.id).not.toBe(first.ok[0]?.id)
    expect(service.listForUser(102)).toHaveLength(1)

    await service.closeForSession('session-1')
    expect(service.listForUser(101)).toHaveLength(1)
    await service.closeForSession('session-2')
    expect(service.listForUser(101)).toHaveLength(0)
    expect(service.listForUser(102)).toHaveLength(1)
    await service.closeForSession('session-other-user')
  })
})
