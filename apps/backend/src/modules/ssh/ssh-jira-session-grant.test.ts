import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'

process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters'
process.env.PEM_ENCRYPTION_KEY ??= '1'.repeat(64)

const { verifyJiraSessionGrant } = await import('./ssh.gateway.js')

describe('Jira SSH session grant', () => {
  const expected = { tenantId: 2, userId: 7, hostId: 11 }

  it('accepts a ticket grant bound to tenant, user and host', () => {
    const token = jwt.sign({ stage: 'jira_session_grant', ...expected, ticketKey: 'OPS-123', interactionId: 'interaction-1' }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    expect(verifyJiraSessionGrant(token, expected)).toBe(true)
  })

  it('rejects cross-host grants and grants without tickets', () => {
    const crossHost = jwt.sign({ stage: 'jira_session_grant', ...expected, ticketKey: 'OPS-123', interactionId: 'interaction-1' }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    const noTicket = jwt.sign({ stage: 'jira_session_grant', ...expected, ticketKey: null, interactionId: 'interaction-1' }, process.env.JWT_SECRET!, { expiresIn: '5m' })
    expect(verifyJiraSessionGrant(crossHost, { ...expected, hostId: 12 })).toBe(false)
    expect(verifyJiraSessionGrant(noTicket, expected)).toBe(false)
  })
})
