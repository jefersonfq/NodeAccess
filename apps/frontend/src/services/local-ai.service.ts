import api from './api'
import type {
  CreateLocalAiProposedActionDto,
  CreateLocalAiKnowledgeLinkDocumentDto,
  CreateLocalAiKnowledgeTextDocumentDto,
  LocalAiChatResponse,
  LocalAiKnowledgeDocument,
  LocalAiProposedAction,
  LocalAiStatus,
  ReviewLocalAiProposedActionDto,
} from '@nodeaccess/shared'

export const localAiService = {
  status: () => api.get<LocalAiStatus>('/local-ai/status'),
  chat: (input: {
    message: string
    contextRoute?: string | null
    contextScreen?: string | null
    terminalContext?: {
      sessionId?: number | null
      hostId?: number | null
      hostName?: string | null
      hostIp?: string | null
      connectionStatus?: string | null
      selection?: string | null
      recentOutput?: string | null
      bufferTail?: string | null
    } | null
  }) =>
    api.post<LocalAiChatResponse>('/local-ai/chat', input),
  listMineProposedActions: () => api.get<LocalAiProposedAction[]>('/local-ai/proposed-actions'),
  createProposedAction: (dto: CreateLocalAiProposedActionDto) =>
    api.post<LocalAiProposedAction>('/local-ai/proposed-actions', dto),
  listAdminProposedActions: () => api.get<LocalAiProposedAction[]>('/local-ai/admin/proposed-actions'),
  reviewProposedAction: (id: number, dto: ReviewLocalAiProposedActionDto) =>
    api.patch<LocalAiProposedAction>(`/local-ai/admin/proposed-actions/${id}/review`, dto),
  listAdminDocuments: () => api.get<LocalAiKnowledgeDocument[]>('/local-ai/admin/documents'),
  createTextDocument: (dto: CreateLocalAiKnowledgeTextDocumentDto) =>
    api.post<LocalAiKnowledgeDocument>('/local-ai/admin/documents/text', dto),
  createLinkDocument: (dto: CreateLocalAiKnowledgeLinkDocumentDto) =>
    api.post<LocalAiKnowledgeDocument>('/local-ai/admin/documents/link', dto),
  uploadDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<LocalAiKnowledgeDocument>('/local-ai/admin/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  deleteDocument: (id: number) => api.delete(`/local-ai/admin/documents/${id}`),
}
