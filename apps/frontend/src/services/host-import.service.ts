import type {
  HostImportCommitRequest,
  HostImportCommitResponse,
  HostImportHistoryResponse,
  HostImportPreviewRequest,
  HostImportPreviewResponse,
  HostImportRevertResponse,
} from '@nodeaccess/shared'
import api from './api'

export const hostImportService = {
  preview: (payload: HostImportPreviewRequest) =>
    api.post<HostImportPreviewResponse>('/host-imports/preview', payload),
  commit: (payload: HostImportCommitRequest) =>
    api.post<HostImportCommitResponse>('/host-imports/commit', payload),
  history: () => api.get<HostImportHistoryResponse>('/host-imports/history'),
  revert: (id: number) => api.post<HostImportRevertResponse>(`/host-imports/${id}/revert`),
}
