import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { DashboardStatsSchema, DiagnosticRunDetailSchema, DiagnosticRunReportSchema, DiagnosticRunComparisonSchema, PublishDiagnosticRunReportToJiraResultSchema } from '@nodeaccess/shared'
const fixtures = createRequire(import.meta.url)('../../../../tools/frontend/sonar-flow-fixtures.cjs') as {
  diagnosticFixture(): { run: unknown; report: unknown; comparison: unknown }
  dashboardFixture(): unknown
  jiraResult: unknown
}
describe('browser flow fixtures match public API schemas', () => {
  it('uses valid diagnostic, evidence and comparison payloads', () => {
    const data = fixtures.diagnosticFixture()
    expect(DiagnosticRunDetailSchema.parse(data.run).id).toBe(41)
    expect(DiagnosticRunReportSchema.parse(data.report).identity.runId).toBe(41)
    expect(DiagnosticRunComparisonSchema.parse(data.comparison).baseline.runId).toBe(40)
  })
  it('uses valid aggregated dashboard and authentication event payloads', () => {
    expect(DashboardStatsSchema.parse(fixtures.dashboardFixture()).adoption.userDrilldowns).toHaveLength(1)
  })
  it('uses the actual Jira publication response contract', () => {
    expect(PublishDiagnosticRunReportToJiraResultSchema.parse(fixtures.jiraResult).queuedActions).toEqual(['COMMENT_DIAGNOSTIC_REPORT'])
  })
})
