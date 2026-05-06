import api from './api'
import type { AiSshActionRunDetail, AiSshActionRunPublic, CreateAiSshActionRunDto } from '@nodeaccess/shared'

export const aiSshActionService = {
  listForHost: (hostId: number) => api.get<AiSshActionRunPublic[]>(`/hosts/${hostId}/ai-ssh-action-runs`),
  createForHost: (hostId: number, dto: Omit<CreateAiSshActionRunDto, 'hostId'>) => api.post<AiSshActionRunDetail>(`/hosts/${hostId}/ai-ssh-action-runs`, dto),
  getById: (runId: number) => api.get<AiSshActionRunDetail>(`/ai-ssh-action-runs/${runId}`),
  approve: (runId: number, approvalReason?: string | null) => api.post<AiSshActionRunDetail>(`/ai-ssh-action-runs/${runId}/approve`, { approvalReason }),
  reject: (runId: number, approvalReason?: string | null) => api.post<AiSshActionRunDetail>(`/ai-ssh-action-runs/${runId}/reject`, { approvalReason }),
  cancel: (runId: number) => api.post<AiSshActionRunDetail>(`/ai-ssh-action-runs/${runId}/cancel`),
}
