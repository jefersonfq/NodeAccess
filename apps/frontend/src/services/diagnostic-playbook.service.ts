import api from './api'
import { sftpService } from './sftp.service'
import type {
  CreateDiagnosticPlaybookDto,
  CreateDiagnosticRunDto,
  DiagnosticPlaybookPublic,
  DiagnosticRunDetail,
  DiagnosticRunPublic,
  UpdateDiagnosticPlaybookDto,
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
  requestRun: (hostId: number, dto: CreateDiagnosticRunDto) => api.post<DiagnosticRunDetail>(`/hosts/${hostId}/diagnostic-runs`, dto),
  getRun: (runId: number) => api.get<DiagnosticRunDetail>(`/diagnostic-runs/${runId}`),
  regenerateSummary: (runId: number) => api.post<DiagnosticRunDetail>(`/diagnostic-runs/${runId}/ai-summary`),
  download: (runId: number) => api.get<Blob>(`/diagnostic-runs/${runId}/download`, { responseType: 'blob' }),
  saveBlobAs: sftpService.saveBlobAs,
}
