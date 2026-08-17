import { describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters'
process.env.PEM_ENCRYPTION_KEY ??= '1'.repeat(64)

const { JiraOutboxWorker } = await import('./jira-outbox.worker.js')

describe('JiraOutboxWorker', () => {
  it('completes an idempotent comment event', async () => {
    const event = { id: 1, tenantId: 2, interactionId: 'i1', action: 'COMMENT_END', idempotencyKey: 'i1:COMMENT_END', payloadJson: { ticketKey: 'OPS-1', auditUrl: 'https://nodeaccess.test/audit/1' }, status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null, createdAt: new Date(), updatedAt: new Date() }
    const outbox = { listDue: vi.fn().mockResolvedValue([event]), completeOutbox: vi.fn(), retryOutbox: vi.fn() }
    const integrations = { findByProvider: vi.fn().mockResolvedValue({ enabled: true, config: JSON.stringify({ authMode: 'api_token', baseUrl: 'https://jira.test', serviceAccountEmail: 'svc@test', apiTokenEncrypted: 'x', apiTokenIv: 'y' }) }) }
    const jira = { buildBasicAuthorization: vi.fn().mockReturnValue('Basic redacted'), normalizeBaseUrl: vi.fn((v) => v), addComment: vi.fn(), attachAuditLink: vi.fn(), transitionIssue: vi.fn() }
    const worker = new JiraOutboxWorker(outbox as never, integrations as never, jira as never)
    await worker.tick()
    expect(jira.addComment).toHaveBeenCalledOnce()
    expect(outbox.completeOutbox).toHaveBeenCalledWith(1)
    expect(outbox.retryOutbox).not.toHaveBeenCalled()
  })

  it('schedules retry with a sanitized provider error', async () => {
    const event = { id: 2, tenantId: 2, action: 'COMMENT_END', payloadJson: { ticketKey: 'OPS-1', auditUrl: 'https://audit' }, attempts: 1 }
    const outbox = { listDue: vi.fn().mockResolvedValue([event]), completeOutbox: vi.fn(), retryOutbox: vi.fn() }
    const integrations = { findByProvider: vi.fn().mockResolvedValue(null) }
    const worker = new JiraOutboxWorker(outbox as never, integrations as never, {} as never)
    await worker.tick()
    expect(outbox.retryOutbox).toHaveBeenCalledWith(2, 2, 'Integração Jira desabilitada')
  })

  it('uploads a diagnostic JSON attachment through the outbox', async () => {
    const event = { id: 3, tenantId: 2, interactionId: 'i1', action: 'ATTACH_DIAGNOSTIC_REPORT', payloadJson: { ticketKey: 'OPS-1', reportJson: '{"version":1}', fileName: 'nodeaccess-diagnostic-9.json' }, attempts: 0 }
    const outbox = { listDue: vi.fn().mockResolvedValue([event]), completeOutbox: vi.fn(), retryOutbox: vi.fn() }
    const integrations = { findByProvider: vi.fn().mockResolvedValue({ enabled: true, config: JSON.stringify({ authMode: 'api_token', baseUrl: 'https://jira.test' }) }) }
    const jira = { buildBasicAuthorization: vi.fn().mockReturnValue('Basic redacted'), normalizeBaseUrl: vi.fn((value) => value), attachJson: vi.fn() }
    const worker = new JiraOutboxWorker(outbox as never, integrations as never, jira as never)

    await worker.tick()

    expect(jira.attachJson).toHaveBeenCalledWith(expect.objectContaining({
      ticketKey: 'OPS-1',
      fileName: 'nodeaccess-diagnostic-9.json',
      content: '{"version":1}',
    }))
    expect(outbox.completeOutbox).toHaveBeenCalledWith(3)
  })
})
