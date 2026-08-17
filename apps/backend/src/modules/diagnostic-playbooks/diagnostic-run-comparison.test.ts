import { describe, expect, it } from 'vitest'
import type { DiagnosticRunReport } from '@nodeaccess/shared'
import { compareDiagnosticRunReports } from './diagnostic-run-comparison.js'

function report(overrides: Partial<DiagnosticRunReport> & { runId: number }): DiagnosticRunReport {
  const { runId, ...rest } = overrides
  return {
    version: 1,
    generatedAt: '2026-08-14T12:00:00.000Z',
    identity: { runId, hostId: 42, hostName: 'srv-db', hostIp: '10.0.0.42', playbookId: 3, playbookName: 'Storage', status: 'completed', startedAt: null, finishedAt: '2026-08-14T12:00:00.000Z' },
    traceability: { sessionId: null, ticketKey: null, actionRunId: null, note: 'isolated' },
    summary: { status: 'READY', text: null, structured: { riskLevel: 'medium', confidence: 'high', keyFindings: ['Disk full', 'Persistent'], nextActions: [] } },
    evidence: {
      total: 2, completed: 1, failed: 1, skipped: 0, redacted: 0,
      commands: [
        { commandId: 'disk', command: 'df -h', status: 'failed', exitCode: 1, redactionApplied: false, output: 'full' },
        { commandId: 'mount', command: 'mount', status: 'completed', exitCode: 0, redactionApplied: false, output: 'ok' },
      ],
    },
    integrity: { algorithm: 'sha256', checksum: String(runId).padStart(64, '0') },
    ...rest,
  }
}

describe('compareDiagnosticRunReports', () => {
  it('classifies evidence improvement and exact normalized findings', () => {
    const baseline = report({ runId: 1 })
    const current = report({
      runId: 2,
      summary: { status: 'READY', text: null, structured: { riskLevel: 'low', confidence: 'high', keyFindings: [' persistent '], nextActions: [] } },
      evidence: {
        total: 2, completed: 2, failed: 0, skipped: 0, redacted: 0,
        commands: baseline.evidence.commands.map((item) => ({ ...item, status: 'completed', exitCode: 0 })),
      },
    })

    const result = compareDiagnosticRunReports(baseline, current)
    expect(result.verdict).toBe('improved')
    expect(result.findings).toEqual({ resolved: ['Disk full'], new: [], persistent: [' persistent '] })
    expect(result.commands.find((item) => item.commandId === 'disk')?.change).toBe('improved')
  })

  it('returns mixed when observable signals move in opposite directions', () => {
    const baseline = report({ runId: 1 })
    const current = report({
      runId: 2,
      summary: { status: 'READY', text: null, structured: { riskLevel: 'high', confidence: 'high', keyFindings: ['New issue'], nextActions: [] } },
      evidence: { ...baseline.evidence, completed: 2, failed: 0, commands: baseline.evidence.commands.map((item) => ({ ...item, status: 'completed', exitCode: 0 })) },
    })
    expect(compareDiagnosticRunReports(baseline, current).verdict).toBe('mixed')
  })

  it('warns when playbook and command composition differ', () => {
    const baseline = report({ runId: 1 })
    const current = report({
      runId: 2,
      identity: { ...baseline.identity, runId: 2, playbookId: 4, playbookName: 'Network' },
      evidence: { ...baseline.evidence, commands: baseline.evidence.commands.slice(0, 1), total: 1 },
    })
    const result = compareDiagnosticRunReports(baseline, current)
    expect(result.warnings).toHaveLength(2)
    expect(result.commands.find((item) => item.commandId === 'mount')?.change).toBe('removed')
  })
})
