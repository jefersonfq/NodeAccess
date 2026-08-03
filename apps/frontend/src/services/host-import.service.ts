import type {
  GuacamoleImportCommitRequest,
  GuacamoleImportCommitResponse,
  GuacamoleImportPreviewRequest,
  GuacamoleImportPreviewResponse,
} from '@nodeaccess/shared'
import api from './api'

export const hostImportService = {
  previewGuacamole: (payload: GuacamoleImportPreviewRequest) =>
    api.post<GuacamoleImportPreviewResponse>('/host-imports/guacamole/preview', payload),
  commitGuacamole: (payload: GuacamoleImportCommitRequest) =>
    api.post<GuacamoleImportCommitResponse>('/host-imports/guacamole/commit', payload),
}
