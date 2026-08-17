import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/env.js', () => ({
  env: {
    PEM_ENCRYPTION_KEY: '0'.repeat(64),
  },
}))

import { ForbiddenError } from '../../shared/errors.js'
import { DiagnosticRunService } from './diagnostic-run.service.js'

describe('DiagnosticRunService ACL', () => {
  it('bloqueia execucao de diagnostico quando usuario nao tem permissao de conexao', async () => {
    const runRepo = {
      createRequestedRun: vi.fn(),
    }
    const playbookRepo = {
      findById: vi.fn(),
    }
    const sshRepo = {
      hasEffectiveHostPermission: vi.fn().mockResolvedValue(false),
    }
    const service = new DiagnosticRunService(
      runRepo as never,
      playbookRepo as never,
      sshRepo as never,
      {} as never,
      { logAdminEvent: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    await expect(service.createForHost({
      hostId:   10,
      tenantId: 1,
      userId:   20,
      role:     'USER',
      dto:      { playbookId: 30 },
    })).rejects.toBeInstanceOf(ForbiddenError)

    expect(sshRepo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 1, 20, 'connect', 'USER')
    expect(playbookRepo.findById).not.toHaveBeenCalled()
    expect(runRepo.createRequestedRun).not.toHaveBeenCalled()
  })

  it('consolida tendência e achados recorrentes sem inferência semântica', async () => {
    const runRepo = {
      findHistoryByHost: vi.fn().mockResolvedValue([
        {
          runId: 2, playbookId: 3, playbookName: 'Storage', status: 'failed',
          createdAt: new Date('2026-08-14T12:00:00.000Z'), finishedAt: new Date('2026-08-14T12:01:00.000Z'),
          aiSummaryStructured: { riskLevel: 'high', confidence: 'high', keyFindings: [' Disk full '], nextActions: [] },
          completedCommands: 1, failedCommands: 2, skippedCommands: 0,
        },
        {
          runId: 1, playbookId: 3, playbookName: 'Storage', status: 'completed',
          createdAt: new Date('2026-08-13T12:00:00.000Z'), finishedAt: new Date('2026-08-13T12:01:00.000Z'),
          aiSummaryStructured: { riskLevel: 'medium', confidence: 'high', keyFindings: ['disk   FULL'], nextActions: [] },
          completedCommands: 2, failedCommands: 0, skippedCommands: 0,
        },
      ]),
    }
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new DiagnosticRunService(
      runRepo as never, {} as never,
      { hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) } as never,
      {} as never, logs as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    )

    const history = await service.getHistoryForHost({ hostId: 10, tenantId: 1, userId: 20, role: 'USER' })

    expect(history.totals).toEqual({ runs: 2, completed: 1, failed: 1, commandFailures: 2, highRisk: 1 })
    expect(history.trend.map((point) => point.runId)).toEqual([1, 2])
    expect(history.recurringFindings).toEqual([expect.objectContaining({ finding: 'Disk full', occurrences: 2, runIds: [2, 1] })])
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'DIAGNOSTIC_RUN_HISTORY_VIEWED' }))
  })

  it('não consulta histórico quando o usuário perdeu acesso ao host', async () => {
    const runRepo = { findHistoryByHost: vi.fn() }
    const service = new DiagnosticRunService(
      runRepo as never, {} as never,
      { hasEffectiveHostPermission: vi.fn().mockResolvedValue(false) } as never,
      {} as never, { logAdminEvent: vi.fn() } as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    )

    await expect(service.getHistoryForHost({ hostId: 10, tenantId: 1, userId: 20, role: 'USER' }))
      .rejects.toBeInstanceOf(ForbiddenError)
    expect(runRepo.findHistoryByHost).not.toHaveBeenCalled()
  })
})
