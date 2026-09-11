import { describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ clients: [] as Array<{ emit: (event: string) => void }> }))

vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events')
  let nextPort = 24000
  class FakeServer extends EventEmitter {
    private port = 0
    listen(port: number, _host: string, callback: () => void) {
      this.port = port > 0 ? port : nextPort++
      queueMicrotask(callback)
      return this
    }
    address() { return { address: '127.0.0.1', family: 'IPv4', port: this.port } }
    close() { this.emit('close'); return this }
  }
  return { default: { createServer: () => new FakeServer() } }
})
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    constructor() { super(); transport.clients.push(this) }
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

function fixture() {
  const host = { id: 7, tenantId: 1, name: 'host-7', ip: '10.0.0.7', port: 22, sshUser: 'root', authType: 'PASSWORD', passwordEncrypted: null, pemKey: null, onePasswordRef: null, connectionMode: 'DIRECT' }
  const repo = {
    getAutoStartForwardings: vi.fn().mockResolvedValue([{ id: 50, localPort: 0, remoteHost: '127.0.0.1', remotePort: 8080, bindAddress: '127.0.0.1', description: 'web' }]),
    findHostWithCredentials: vi.fn().mockResolvedValue(host), hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
    findHostIdsWithEffectivePermission: vi.fn().mockResolvedValue(new Set()),
  }
  const service = new TunnelService(repo as never, { resolve: vi.fn() } as never, { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never)
  return { repo, service, host }
}

describe('tunnel lifecycle resilience', () => {
  it('deduplicates genuinely simultaneous starts across tabs', async () => {
    const { service } = fixture()
    const [a, b] = await Promise.all([service.autoStartForSession('parallel-a', 201, 1, 7, 'user'), service.autoStartForSession('parallel-b', 201, 1, 7, 'user')])
    expect(a.ok[0].id).toBe(b.ok[0].id)
    expect(service.listForUser(201)).toHaveLength(1)
    await service.closeForSession('parallel-a')
    expect(service.listForUser(201)).toHaveLength(1)
    await service.closeForSession('parallel-b')
    expect(service.listForUser(201)).toHaveLength(0)
  })
  it('does not leave a ghost if the tab closes during SSH startup', async () => {
    const { repo, service, host } = fixture()
    let resume!: (value: typeof host) => void
    repo.findHostWithCredentials.mockImplementationOnce(() => new Promise(resolve => { resume = resolve }))
    const pending = service.autoStartForSession('closing-start', 202, 1, 7, 'user')
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    await service.closeForSession('closing-start')
    resume(host)
    expect((await pending).ok).toEqual([])
    expect(service.listForUser(202)).toEqual([])
  })
  it('cancels before configuration lookup finishes without opening SSH', async () => {
    const { repo, service } = fixture()
    let resume!: (rows: unknown[]) => void
    repo.getAutoStartForwardings.mockImplementationOnce(() => new Promise(resolve => { resume = resolve }))
    const pending = service.autoStartForSession('closing-query', 203, 1, 7, 'user')
    await service.closeForSession('closing-query')
    resume([{ id: 50 }])
    expect((await pending).ok).toEqual([])
    expect(repo.findHostWithCredentials).not.toHaveBeenCalled()
  })
  it('isolates tenants and refuses another user closing a tunnel', async () => {
    const { service } = fixture()
    const tunnel = await service.create(204, 1, 'user', 7, 0, 'localhost', 80)
    expect(service.listForUser(204, 2)).toEqual([])
    await expect(service.closeForUser(tunnel.id, 205, 1)).rejects.toMatchObject({ code: 'TUNNEL_FORBIDDEN' })
    await expect(service.closeForUser(tunnel.id, 204, 2)).rejects.toMatchObject({ code: 'TUNNEL_NOT_FOUND' })
    expect(service.listForUser(204, 1)).toHaveLength(1)
    await service.closeForUser(tunnel.id, 204, 1)
  })
  it('removes presence after transport close even without an end event', async () => {
    const { service } = fixture()
    await service.create(206, 1, 'user', 7, 0, 'localhost', 80)
    transport.clients.at(-1)!.emit('close')
    expect(service.listForUser(206)).toEqual([])
  })
  it('blocks unauthorized hosts and reports auto-start failure without leaking a tunnel', async () => {
    const { service, repo } = fixture()
    repo.hasEffectiveHostPermission.mockResolvedValue(false)
    const result = await service.autoStartForSession('denied', 207, 1, 7, 'user')
    expect(result.errors[0]).toMatchObject({ code: 'HOST_FORBIDDEN' })
    expect(service.listForUser(207)).toEqual([])
  })
  it('closes a live tunnel after ACL revocation', async () => {
    const { service } = fixture()
    await service.create(208, 1, 'user', 7, 0, 'localhost', 80)
    expect(await service.closeRevokedByAclChange(1)).toBe(1)
    expect(service.listForUser(208)).toEqual([])
  })
  it('rejects an ACL revoked while the tunnel was opening', async () => {
    const { service, repo } = fixture()
    repo.hasEffectiveHostPermission.mockResolvedValueOnce(true).mockResolvedValue(false)
    await expect(service.create(210, 1, 'user', 7, 0, 'localhost', 80)).rejects.toMatchObject({ code: 'HOST_FORBIDDEN' })
    expect(service.listForUser(210)).toEqual([])
  })
  it('does not report success if SSH closes while startup audit is pending', async () => {
    const { repo } = fixture()
    const service = new TunnelService(repo as never, {} as never, {
      logAdminEvent: vi.fn(async event => { if (event.action === 'USER_TUNNEL_OPENED') transport.clients.at(-1)!.emit('close') }),
    } as never)
    await expect(service.create(211, 1, 'user', 7, 0, 'localhost', 80)).rejects.toMatchObject({ code: 'TUNNEL_CLOSED_DURING_STARTUP' })
    expect(service.listForUser(211)).toEqual([])
  })
  it('does not silently bypass a required offline agent', async () => {
    const { service, host } = fixture()
    host.connectionMode = 'AGENT_USER'
    const before = transport.clients.length
    await expect(service.create(209, 1, 'user', 7, 0, 'localhost', 80)).rejects.toThrow()
    expect(transport.clients.length).toBe(before)
    expect(service.listForUser(209)).toEqual([])
  })
})

it('AUTO mode cannot fall back to direct transport after an agent ACL denial', async () => {
  const { agentRegistry } = await import('../agents/agent.registry.js')
  const { agentAccessDenied } = await import('../agents/agent-access.service.js')
  const { service, host } = fixture()
  host.connectionMode = 'AUTO'
  const resolve = vi.spyOn(agentRegistry, 'resolveForConnectionMode').mockReturnValue({ agent: { agentId: 1 } as never, source: 'user' })
  const connect = vi.spyOn(agentRegistry, 'createAuthorizedConnection').mockRejectedValue(agentAccessDenied())
  const before = transport.clients.length
  try {
    await expect(service.create(209, 1, 'user', 7, 0, 'localhost', 80)).rejects.toMatchObject({ code: 'AGENT_ACCESS_DENIED' })
    expect(transport.clients.length).toBe(before)
    expect(service.listForUser(209)).toEqual([])
  } finally { resolve.mockRestore(); connect.mockRestore() }
})
