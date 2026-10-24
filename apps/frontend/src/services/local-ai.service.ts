import type { AxiosResponse } from 'axios'
import api from './api'
import type {
  CreateLocalAiProposedActionDto,
  CreateLocalAiKnowledgeLinkDocumentDto,
  CreateLocalAiKnowledgeTextDocumentDto,
  LocalAiChatResponse,
  LocalAiKnowledgeDocument,
  LocalAiProposedAction,
  LocalAiStatus,
  LocalAiDiagnosticPlan,
  LocalAiDiagnosticPlanRequest,
  LocalAiTerminalAssist,
  LocalAiTerminalAssistRequest,
  LocalAiUsageSummary,
  AiInteractionList,
  AiScriptArtifactDetail,
  CreateAiScriptArtifactDto,
  AiSshActionRunDetail,
  ReviewLocalAiProposedActionDto,
} from '@nodeaccess/shared'

export const localAiService = {
  status: (): Promise<AxiosResponse<LocalAiStatus>> => api.get<LocalAiStatus>('/local-ai/status'),
  usage: (days = 30): Promise<AxiosResponse<LocalAiUsageSummary>> => api.get<LocalAiUsageSummary>('/local-ai/admin/usage', { params: { days } }),
  interactions: (limit = 50): Promise<AxiosResponse<AiInteractionList>> => api.get<AiInteractionList>('/local-ai/admin/interactions', { params: { limit } }),
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
  }): Promise<AxiosResponse<LocalAiChatResponse>> =>
    api.post<LocalAiChatResponse>('/local-ai/chat', input),
  generateDiagnosticPlan: (dto: LocalAiDiagnosticPlanRequest): Promise<AxiosResponse<LocalAiDiagnosticPlan>> =>
    api.post<LocalAiDiagnosticPlan>('/local-ai/diagnostic-plan', dto),
  terminalAssist: (dto: LocalAiTerminalAssistRequest, signal?: AbortSignal): Promise<AxiosResponse<LocalAiTerminalAssist>> =>
    api.post<LocalAiTerminalAssist>('/local-ai/terminal-assist', dto, { signal, timeout: 25000 }),
  createScriptArtifact: (dto: CreateAiScriptArtifactDto): Promise<AxiosResponse<AiScriptArtifactDetail>> => api.post<AiScriptArtifactDetail>('/local-ai/script-artifacts', dto),
  getScriptArtifact: (id: number): Promise<AxiosResponse<AiScriptArtifactDetail>> => api.get<AiScriptArtifactDetail>(`/local-ai/script-artifacts/${id}`),
  requestScriptExecution: (id: number, approvalReason?: string | null): Promise<AxiosResponse<AiSshActionRunDetail>> => api.post<AiSshActionRunDetail>(`/local-ai/script-artifacts/${id}/request-execution`, { approvalReason }),
  listMineProposedActions: (): Promise<AxiosResponse<LocalAiProposedAction[]>> => api.get<LocalAiProposedAction[]>('/local-ai/proposed-actions'),
  createProposedAction: (dto: CreateLocalAiProposedActionDto): Promise<AxiosResponse<LocalAiProposedAction>> =>
    api.post<LocalAiProposedAction>('/local-ai/proposed-actions', dto),
  listAdminProposedActions: (): Promise<AxiosResponse<LocalAiProposedAction[]>> => api.get<LocalAiProposedAction[]>('/local-ai/admin/proposed-actions'),
  reviewProposedAction: (id: number, dto: ReviewLocalAiProposedActionDto): Promise<AxiosResponse<LocalAiProposedAction>> =>
    api.patch<LocalAiProposedAction>(`/local-ai/admin/proposed-actions/${id}/review`, dto),
  listAdminDocuments: (): Promise<AxiosResponse<LocalAiKnowledgeDocument[]>> => api.get<LocalAiKnowledgeDocument[]>('/local-ai/admin/documents'),
  createTextDocument: (dto: CreateLocalAiKnowledgeTextDocumentDto): Promise<AxiosResponse<LocalAiKnowledgeDocument>> =>
    api.post<LocalAiKnowledgeDocument>('/local-ai/admin/documents/text', dto),
  createLinkDocument: (dto: CreateLocalAiKnowledgeLinkDocumentDto): Promise<AxiosResponse<LocalAiKnowledgeDocument>> =>
    api.post<LocalAiKnowledgeDocument>('/local-ai/admin/documents/link', dto),
  uploadDocument: (file: File): Promise<AxiosResponse<LocalAiKnowledgeDocument>> => {
    const form = new FormData()
    form.append('file', file)
    return api.post<LocalAiKnowledgeDocument>('/local-ai/admin/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  deleteDocument: (id: number): Promise<AxiosResponse<unknown>> => api.delete(`/local-ai/admin/documents/${id}`),
}
