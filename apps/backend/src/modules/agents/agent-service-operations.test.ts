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
  const license = { requireFeature: vi.fn().mockResolvedValue(undefined) }
  return { db, service: new AgentService(db as never, license as never) }
}

describe('agent lifecycle operations', () => {
  it('rotates to a one-time token and persists only its hash', async () => {
    const { db, service } = setup()
    const result = await service.rotateToken(4, 9, 7, false)
    expect(result.token).toMatch(/^na_agent_[a-f0-9]{64}$/)
    expect(db.agent.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { tokenHash: createHash('sha256').update(result.token).digest('hex') } })
    expect(db.adminLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'agent_token_rotated' }) }))
  })

  it('blocks lifecycle operations from another owner', async () => {
    const { service } = setup(33)
    await expect(service.rotateToken(4, 9, 7, false)).rejects.toMatchObject({ statusCode: 403, code: 'AGENT_FORBIDDEN' })
  })
})
