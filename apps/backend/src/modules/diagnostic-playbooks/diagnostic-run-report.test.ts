import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.APP_FRONTEND_URL ||= 'https://nodeaccess.test'
  process.env.NODE_ENV ||= 'test'
})

import { DiagnosticRunService } from './diagnostic-run.service.js'

function createService() {
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
  const runRepo = {
    validateTraceabilityReferences: vi.fn().mockResolvedValue({ sessionValid: true, ticketValid: true, actionRunValid: true }),
    updateTraceability: vi.fn().mockResolvedValue(undefined),
  }
  const integrationRepo = { findByProvider: vi.fn().mockResolvedValue({ enabled: true, config: JSON.stringify({ authMode: 'api_token' }) }) }
  const jiraInteractionRepo = {
    findRecentByTicket: vi.fn().mockResolvedValue({ id: 'interaction-1' }),
    enqueue: vi.fn().mockResolvedValue(undefined),
  }
  const jira = { capabilities: vi.fn().mockReturnValue({ comment: true, attachment: true }) }
  const service = new DiagnosticRunService(
    runRepo as never,
    {} as never,
    {} as never,
    {} as never,
    logs as never,
    {} as never,
    {} as never,
    integrationRepo as never,
    jiraInteractionRepo as never,
    jira as never,
  )
  vi.spyOn(service, 'getById').mockResolvedValue({
    id: 9,
    hostId: 42,
    hostName: 'srv-db',
    hostIp: '10.0.0.42',
    playbookId: 3,
    playbookName: 'Diagnóstico de storage',
    status: 'completed',
    requestedById: 11,
    approvedById: null,
    triggerSource: 'manual',
    errorMessage: null,
    aiSummaryStatus: 'READY',
    aiSummaryText: 'Filesystem com uso elevado.',
    aiSummaryStructured: {
      riskLevel: 'medium',
      confidence: 'high',
      keyFindings: ['Uso em 91%'],
      nextActions: ['Revisar retenção'],
    },
    startedAt: new Date('2026-08-14T10:00:00.000Z'),
    finishedAt: new Date('2026-08-14T10:01:00.000Z'),
    createdAt: new Date('2026-08-14T09:59:00.000Z'),
    updatedAt: new Date('2026-08-14T10:01:10.000Z'),
    commands: [
      {
        id: 1,
        commandId: 'disk',
        command: 'df -h',
        status: 'completed',
        exitCode: 0,
        outputPreview: '/dev/sda 91%',
        outputBody: '/dev/sda 91%',
        redactionApplied: false,
        startedAt: new Date('2026-08-14T10:00:00.000Z'),
        finishedAt: new Date('2026-08-14T10:00:01.000Z'),
      },
      {
        id: 2,
        commandId: 'mounts',
        command: 'mount',
        status: 'failed',
        exitCode: 1,
        outputPreview: '[redacted]',
        outputBody: '[redacted]',
        redactionApplied: true,
        startedAt: new Date('2026-08-14T10:00:02.000Z'),
        finishedAt: new Date('2026-08-14T10:00:03.000Z'),
      },
    ],
  })
  return { service, logs, runRepo, integrationRepo, jiraInteractionRepo, jira }
}

const actor = { id: 9, tenantId: 7, userId: 11, role: 'ADMIN' as const }

describe('DiagnosticRunService report', () => {
  it('builds traceable evidence counters and a stable checksum', async () => {
    const { service } = createService()
    const first = await service.getReport(actor)
    const second = await service.getReport(actor)

    expect(first.evidence).toMatchObject({ total: 2, completed: 1, failed: 1, skipped: 0, redacted: 1 })
    expect(first.traceability).toMatchObject({ sessionId: null, ticketKey: null })
    expect(first.integrity.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(second.integrity.checksum).toBe(first.integrity.checksum)
  })

  it('audits exports with the report checksum', async () => {
    const { service, logs } = createService()
    const report = await service.exportRun(actor)

    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DIAGNOSTIC_RUN_EXPORTED',
      targetId: 9,
      details: expect.stringContaining(report.integrity.checksum),
    }))
  })

  it('compares only distinct runs from the same authorized host and audits the result', async () => {
    const { service, logs } = createService()
    const current = await service.getReport(actor)
    const getReport = vi.spyOn(service, 'getReport')
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, identity: { ...current.identity, runId: 8 } })

    const result = await service.compareRuns({ ...actor, baselineId: 8 })

    expect(getReport).toHaveBeenCalledTimes(2)
    expect(result.baseline.runId).toBe(8)
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DIAGNOSTIC_RUNS_COMPARED' }))
  })

  it('rejects comparisons across hosts after authorizing both runs', async () => {
    const { service } = createService()
    const current = await service.getReport(actor)
    vi.spyOn(service, 'getReport')
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, identity: { ...current.identity, runId: 8, hostId: 99 } })

    await expect(service.compareRuns({ ...actor, baselineId: 8 })).rejects.toThrow('mesmo host')
  })

  it('validates and audits explicit traceability links before persisting', async () => {
    const { service, logs, runRepo } = createService()
    const updated = await service.updateTraceability({
      ...actor,
      dto: { sessionId: 100, ticketKey: 'ops-77', actionRunId: 25 },
    })

    expect(updated.id).toBe(9)
    expect(runRepo.validateTraceabilityReferences).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 7,
      hostId: 42,
      sessionId: 100,
      ticketKey: 'OPS-77',
      actionRunId: 25,
    }))
    expect(runRepo.updateTraceability).toHaveBeenCalledWith(expect.objectContaining({ ticketKey: 'OPS-77' }))
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DIAGNOSTIC_RUN_TRACEABILITY_UPDATED' }))
  })

  it('rejects a cross-scope reference without updating the run', async () => {
    const { service, runRepo } = createService()
    runRepo.validateTraceabilityReferences.mockResolvedValue({ sessionValid: false, ticketValid: true, actionRunValid: true })

    await expect(service.updateTraceability({ ...actor, dto: { sessionId: 999 } }))
      .rejects.toThrow('mesmo tenant, host e escopo')
    expect(runRepo.updateTraceability).not.toHaveBeenCalled()
  })

  it('queues idempotent Jira comment and attachment keys derived from the checksum', async () => {
    const { service, jiraInteractionRepo } = createService()
    const baseReport = await service.getReport(actor)
    vi.spyOn(service, 'getReport').mockResolvedValue({
      ...baseReport,
      traceability: { sessionId: 100, ticketKey: 'OPS-77', actionRunId: 25, note: 'linked' },
    })

    const result = await service.publishReportToJira({
      ...actor,
      reportUrl: 'https://nodeaccess.test/diagnostic-runs/9',
      includeAttachment: true,
    })

    expect(result.queuedActions).toEqual(['COMMENT_DIAGNOSTIC_REPORT', 'ATTACH_DIAGNOSTIC_REPORT'])
    expect(jiraInteractionRepo.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      idempotencyKey: `diagnostic:9:${result.checksum}:comment`,
    }))
    expect(jiraInteractionRepo.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: `diagnostic:9:${result.checksum}:attachment`,
    }))
  })

  it('does not queue anything when attachment capability is unavailable', async () => {
    const { service, jira, jiraInteractionRepo } = createService()
    const baseReport = await service.getReport(actor)
    vi.spyOn(service, 'getReport').mockResolvedValue({
      ...baseReport,
      traceability: { sessionId: null, ticketKey: 'OPS-77', actionRunId: null, note: 'linked' },
    })
    jira.capabilities.mockReturnValue({ comment: true, attachment: false })

    await expect(service.publishReportToJira({
      ...actor,
      reportUrl: 'https://nodeaccess.test/diagnostic-runs/9',
      includeAttachment: true,
    })).rejects.toThrow('não permite anexar')
    expect(jiraInteractionRepo.enqueue).not.toHaveBeenCalled()
  })

  it('rejects an external report URL before reading or enqueueing data', async () => {
    const { service, jiraInteractionRepo } = createService()

    await expect(service.publishReportToJira({
      ...actor,
      reportUrl: 'https://attacker.example/diagnostic-runs/9',
      includeAttachment: false,
    })).rejects.toThrow('não pertence ao NodeAccess')
    expect(jiraInteractionRepo.enqueue).not.toHaveBeenCalled()
  })
})
