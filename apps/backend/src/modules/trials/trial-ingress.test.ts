import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { EventEmitter } from 'node:events'
vi.mock('../../config/env.js', () => ({ env: { JWT_SECRET: 'trial-test-secret', PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
import { configureTrialPolicy } from './trial-policy.js'
import { ManagedSshSessionService } from '../ssh/managed-ssh-session.service.js'
import { SshIsolatedAiActionRunner } from '../ai-ssh-actions/ai-ssh-action.execution.js'
import { AgentGateway } from '../agents/agent.gateway.js'
import { AgentRegistry } from '../agents/agent.registry.js'
import { GraphicalGateway } from '../graphical/graphical.gateway.js'
import { HostLinkService } from '../host-links/host-link.service.js'
import { McpInteractiveSshService } from '../mcp/mcp-interactive-ssh.service.js'
import { SshRepository } from '../ssh/ssh.repository.js'

class Socket extends EventEmitter {
  OPEN = 1
  readyState = 1
  send = vi.fn()
  close = vi.fn((code: number) => { this.readyState = 3; this.emit('close', code) })
}
beforeEach(() => configureTrialPolicy(() => Promise.resolve(({ status: 'ACTIVE', expiresAt: new Date(Date.now() + 60000), profileJson: {} }))))
afterEach(() => configureTrialPolicy(() => Promise.resolve(null)))

describe('trial alternate ingress', () => {
  it('denies native managed SSH before creating session records', async () => {
    const repo = { startSession: vi.fn() }
    const service = new ManagedSshSessionService(repo as never, {} as never, {} as never, {} as never)
    await expect(service.open({ user: { tenantId: 2 } } as never)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    expect(repo.startSession).not.toHaveBeenCalled()
    await expect(service.openResolved({ user: { tenantId: 2 }, source: 'native_ssh_gateway' } as never)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
  it('denies graphical websocket before resolving host credentials', async () => {
    const repo = { findHostWithCredentials: vi.fn() }
    const socket = new Socket()
    const token = jwt.sign({ stage: 'authenticated', sub: '1', tenantId: 2, role: 'user' }, 'trial-test-secret')
    await new GraphicalGateway(repo as never, {} as never, {} as never, {} as never).handleConnection(socket as never, token, 1)
    expect(socket.close).toHaveBeenCalledWith(1008)
    expect(repo.findHostWithCredentials).not.toHaveBeenCalled()
  })
  it('denies valid agent credentials before registry admission', async () => {
    const registry = new AgentRegistry()
    const service = { authenticate: vi.fn().mockResolvedValue({ tenantId: 2, id: 1 }), markConnected: vi.fn() }
    const socket = new Socket()
    await new AgentGateway(service as never, registry).handleConnection(socket as never, 'opaque-token')
    expect(socket.close).toHaveBeenCalledWith(1008)
    expect(registry.getForTenant(2)).toBeUndefined()
    expect(service.markConnected).not.toHaveBeenCalled()
  })
  it('denies public JIT metadata and resolution before consuming the link', async () => {
    const links = { findByTokenHash: vi.fn().mockResolvedValue({ type: 'PUBLIC_ONCE', tenantId: 2 }), markOpened: vi.fn() }
    const service = new HostLinkService(links as never, {} as never, {} as never, {} as never)
    await expect(service.getPublicInfo('opaque')).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    await expect(service.resolvePublic('opaque','Visitor')).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    expect(links.markOpened).not.toHaveBeenCalled()
  })
  it('denies MCP persisted admin credentials before resolving destination', async () => {
    const repo = { findHostWithCredentials: vi.fn() }
    const service = new McpInteractiveSshService(repo as never, {} as never, {} as never, {} as never, {} as never)
    await expect(service.open({ role: 'admin', tenantId: 2, sub: '1' } as never, { hostId: 1, reason: 'test' }, { mode: 'persisted_token', tokenId: 1 })).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    expect(repo.findHostWithCredentials).not.toHaveBeenCalled()
  })
  it('denies AI execution before resolving secrets or opening transport', async () => {
    const secrets = { resolve: vi.fn() }
    await expect(new SshIsolatedAiActionRunner(secrets as never).run({ host: { tenantId: 2 } as never, steps: [] })).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    expect(secrets.resolve).not.toHaveBeenCalled()
  })
})

describe('trial session admission transaction', () => {
  function fixture(status = 'ACTIVE', total = 0, maxSessions: unknown = 2) {
    const queries: string[] = []
    const tx = {
      $queryRaw: vi.fn((sql: { strings: string[] }) => {
        const query = sql.strings.join('?'); queries.push(query)
        if (query.includes('trial_registrations')) return Promise.resolve([{ status, expiresAt: new Date(Date.now() + 60000), profileJson: { maxSessions } }])
        if (query.includes('COUNT')) return Promise.resolve([{ total }])
        return Promise.resolve([{ id: 99 }])
      }),
      $executeRaw: vi.fn(() => Promise.resolve(1)),
    }
    const db = { $transaction: vi.fn((run: (tx: unknown) => unknown) => Promise.resolve(run(tx))) }
    return { tx, queries, repo: new SshRepository(db as never) }
  }
  it('locks trial row, checks current quota, then inserts in the same transaction', async () => {
    const { repo, tx, queries } = fixture()
    await expect(repo.startSession(1, 5, {}, 2)).resolves.toBe(99)
    expect(queries[0]).toContain('FOR UPDATE')
    expect(queries[1]).toContain('COUNT')
    expect(tx.$executeRaw).toHaveBeenCalledOnce()
  })
  it('does not add trial queries to ordinary session creation', async () => {
    const { repo, queries } = fixture()
    await expect(repo.startSession(1, 5)).resolves.toBe(99)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain('LAST_INSERT_ID')
  })
  it('denies concurrent winner quota exhaustion before insertion', async () => {
    const { repo, tx } = fixture('ACTIVE', 2)
    await expect(repo.startSession(1, 5, {}, 2)).rejects.toMatchObject({ code: 'TRIAL_SESSION_LIMIT' })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })
  it('denies cancellation that won row lock before session admission', async () => {
    const { repo, tx } = fixture('EXPIRED')
    await expect(repo.startSession(1, 5, {}, 2)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })
  it.each([undefined, 0, -1, '2', 1.5])('denies invalid session quota %s', async max => {
    const { repo, tx } = fixture('ACTIVE', 0, max === undefined ? null : max)
    await expect(repo.startSession(1, 5, {}, 2)).rejects.toMatchObject({ code: 'TRIAL_CAPACITY_UNAVAILABLE' })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })
})
