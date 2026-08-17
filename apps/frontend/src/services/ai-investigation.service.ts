import type { AiInvestigation, CompleteAiInvestigationDto } from '@nodeaccess/shared'
import api from './api'
export const aiInvestigationService = {
  list: () => api.get<Array<AiInvestigation & { actionRunCount?: number }>>('/ai-investigations'),
  get: (id:number) => api.get<AiInvestigation>(`/ai-investigations/${id}`),
  complete: (id:number,dto:CompleteAiInvestigationDto) => api.post<AiInvestigation>(`/ai-investigations/${id}/complete`,dto),
  abandon: (id:number) => api.post<AiInvestigation>(`/ai-investigations/${id}/abandon`),
}
