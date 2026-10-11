import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})

import { SessionAuditPolicyRepository } from './session-audit-policy.repository.js'

describe('SessionAuditPolicyRepository defaults', () => {
  it('audits all sessions when licensed and no explicit policy exists', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ sessionAuditEnabled: 1 }]).mockResolvedValueOnce([]) }
    const state = await new SessionAuditPolicyRepository(db as never).getState(7)
    expect(state).toEqual({ licensed: true, enabled: true, mode: 'ALL', userIds: [], groupIds: [] })
  })

  it('stays disabled without the module license', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ sessionAuditEnabled: 0 }]).mockResolvedValueOnce([]) }
    const state = await new SessionAuditPolicyRepository(db as never).getState(7)
    expect(state).toEqual({ licensed: false, enabled: false, mode: 'DISABLED', userIds: [], groupIds: [] })
  })
})
