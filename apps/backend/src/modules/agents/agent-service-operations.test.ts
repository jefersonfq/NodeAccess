import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AgentService } from './agent.service.js'

function setup(createdById = 9) {
  const db = {
    agent: {
      findFirst: vi.fn().mockResolvedValue({ id: 4, name: 'Gateway', agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', createdById }),
      update: vi.fn().mockResolvedValue({}),
    },
    adminLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
  }
  Object.assign(db, { $transaction: vi.fn(async (operation: (tx: typeof db) => unknown) => operation(db)) })
  const license = { requireFeature: vi.fn().mockResolvedValue(undefined) }
  const invalidate = vi.fn().mockResolvedValue(undefined)
  return { db, invalidate, service: new AgentService(db as never, license as never, invalidate) }
}

describe('agent lifecycle operations', () => {
  it('never declares revocation safe while database reports an active session', async () => {
    const { db, service } = setup()
    db.$queryRaw.mockResolvedValueOnce([{ count: 0 }] as never).mockResolvedValueOnce([{ count: 1 }] as never)
    const result = await service.impact(4, 9, 7, false)
    expect(result.activeSessionCount).toBe(1)
    expect(result.safeToRevoke).toBe(false)
  })
  it('rotates to a one-time token and persists only its hash', async () => {
    const { db, service, invalidate } = setup()
    const result = await service.rotateToken(4, 9, 7, false)
    expect(invalidate).toHaveBeenCalledWith(4)
    expect(db.agent.update.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0]!)
    expect(result.token).toMatch(/^na_agent_[a-f0-9]{64}$/)
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { tokenHash: createHash('sha256').update(result.token).digest('hex') } })
    expect(db.adminLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'agent_token_rotated' }) }))
  })

  it('blocks lifecycle operations from another owner', async () => {
    const { service } = setup(33)
    await expect(service.rotateToken(4, 9, 7, false)).rejects.toMatchObject({ statusCode: 403, code: 'AGENT_FORBIDDEN' })
  })
})

it.each(['revoke', 'permanentDelete', 'rotateToken'] as const)('does not invalidate or report success if audit fails for %s', async operation => {
  const { db, invalidate, service } = setup()
  db.adminLog.create.mockRejectedValueOnce(new Error('audit unavailable'))
  await expect(service[operation](4, 9, 7, false)).rejects.toThrow('audit unavailable')
  expect(invalidate).not.toHaveBeenCalled()
})

it('records pool edits with actor, tenant, previous and next values and no credential material', async () => {
  const { db, service } = setup()
  db.agent.findFirst.mockResolvedValue({ id: 4, name: 'Gateway', agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', createdById: 9, tenantId: 7, poolName: 'old', priority: 100 } as never)
  await service.configurePool(4, 9, 7, false, { poolName: 'branch', priority: 10 })
  const audit = db.adminLog.create.mock.calls[0]![0].data
  expect(audit).toMatchObject({ adminId: 9, action: 'agent_pool_updated', targetId: 4 })
  expect(JSON.parse(audit.details)).toMatchObject({ tenantId: 7, before: { poolName: 'old', priority: 100 }, after: { poolName: 'branch', priority: 10 }, accessMode: 'managed_acl' })
  expect(audit.details).not.toMatch(/tokenHash|na_agent_/)
})

it('retains history access after soft deletion and checks owner and tenant', async () => {
  const { db, service } = setup()
  await service.history(4, 9, 7, false)
  expect(db.agent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, tenantId: 7 } }))
  await expect(service.history(4, 12, 7, false)).rejects.toMatchObject({ code: 'AGENT_FORBIDDEN' })
  db.agent.findFirst.mockResolvedValue(null as never)
  await expect(service.history(4, 9, 8, true)).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' })
})
