import api from './api'
import { sftpService } from './sftp.service'
import type {
  CreateDiagnosticPlaybookDto,
  CreateDiagnosticRunDto,
  DiagnosticPlaybookPublic,
  DiagnosticRunDetail,
  DiagnosticRunPublic,
  DiagnosticRunReport,
  DiagnosticRunComparison,
  DiagnosticRunHistory,
  UpdateDiagnosticPlaybookDto,
  UpdateDiagnosticRunTraceabilityDto,
  PublishDiagnosticRunReportToJiraDto,
  PublishDiagnosticRunReportToJiraResult,
} from '@nodeaccess/shared'

export interface DiagnosticPlaybookHistoryEntry {
  id: number
  action: string
  timestamp: string
  adminName: string
  details: string | null
}

export const diagnosticPlaybookService = {
  listForHost: (hostId: number) => api.get<DiagnosticPlaybookPublic[]>(`/hosts/${hostId}/diagnostic-playbooks`),
  listAdmin: () => api.get<DiagnosticPlaybookPublic[]>('/diagnostic-playbooks'),
  listAdminHistory: (id: number) => api.get<DiagnosticPlaybookHistoryEntry[]>(`/diagnostic-playbooks/${id}/history`),
  createAdmin: (dto: CreateDiagnosticPlaybookDto) => api.post<DiagnosticPlaybookPublic>('/diagnostic-playbooks', dto),
  updateAdmin: (id: number, dto: UpdateDiagnosticPlaybookDto) => api.patch<DiagnosticPlaybookPublic>(`/diagnostic-playbooks/${id}`, dto),
  deleteAdmin: (id: number) => api.delete(`/diagnostic-playbooks/${id}`),
  listRunsForHost: (hostId: number) => api.get<DiagnosticRunPublic[]>(`/hosts/${hostId}/diagnostic-runs`),
  getHistoryForHost: (hostId: number) => api.get<DiagnosticRunHistory>(`/hosts/${hostId}/diagnostic-runs/history`),
  requestRun: (hostId: number, dto: CreateDiagnosticRunDto) => api.post<DiagnosticRunDetail>(`/hosts/${hostId}/diagnostic-runs`, dto),
  getRun: (runId: number) => api.get<DiagnosticRunDetail>(`/diagnostic-runs/${runId}`),
  getReport: (runId: number) => api.get<DiagnosticRunReport>(`/diagnostic-runs/${runId}/report`),
  compareRuns: (runId: number, baselineRunId: number) =>
    api.get<DiagnosticRunComparison>(`/diagnostic-runs/${runId}/compare/${baselineRunId}`),
  updateTraceability: (runId: number, dto: UpdateDiagnosticRunTraceabilityDto) =>
    api.patch<DiagnosticRunDetail>(`/diagnostic-runs/${runId}/traceability`, dto),
  publishReportToJira: (runId: number, dto: PublishDiagnosticRunReportToJiraDto) =>
    api.post<PublishDiagnosticRunReportToJiraResult>(`/diagnostic-runs/${runId}/report/jira`, dto),
  regenerateSummary: (runId: number) => api.post<DiagnosticRunDetail>(`/diagnostic-runs/${runId}/ai-summary`),
  download: (runId: number) => api.get<Blob>(`/diagnostic-runs/${runId}/download`, { responseType: 'blob' }),
  saveBlobAs: sftpService.saveBlobAs,
}
