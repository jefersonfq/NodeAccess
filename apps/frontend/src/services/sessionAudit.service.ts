import api from './api'
import { sftpService } from './sftp.service'
import type { Paginated, SessionAuditAiArtifactPublic, SessionAuditAiJobPublic, SessionAuditCommand, SessionAuditCommandStats, SessionAuditPreviewEvent, SessionAuditPublic, SessionAuditReconstruction } from '@nodeaccess/shared'

type SessionAuditRetrySummaryDto = {
  template: 'summary-v1' | 'cab-v1' | 'risk-v1'
}

type SessionAuditLinkTicketDto = {
  ticketKey: string
}

export const sessionAuditService = {
  list(params: { search?: string; ticketKey?: string; status?: string; aiState?: 'with-ai' | 'without-ai'; aiRiskLevel?: string; hostState?: 'active' | 'deleted'; hostId?: number; periodDays?: number; minCommandCount?: number; page?: number; limit?: number }) {
    return api.get<Paginated<SessionAuditPublic>>('/session-audit', { params })
  },

  getBySessionId(sessionId: number) {
    return api.get<SessionAuditPublic>(`/session-audit/${sessionId}`)
  },

  preview(sessionId: number, limit = 200) {
    return api.get<SessionAuditPreviewEvent[]>(`/session-audit/${sessionId}/preview`, {
      params: { limit },
    })
  },

  commands(sessionId: number, limit = 100) {
    return api.get<SessionAuditCommand[]>(`/session-audit/${sessionId}/commands`, {
      params: { limit },
    })
  },

  commandStats(sessionId: number) {
    return api.get<SessionAuditCommandStats>(`/session-audit/${sessionId}/command-stats`)
  },

  jobs(sessionId: number) {
    return api.get<SessionAuditAiJobPublic[]>(`/session-audit/${sessionId}/jobs`)
  },

  artifacts(sessionId: number) {
    return api.get<SessionAuditAiArtifactPublic[]>(`/session-audit/${sessionId}/artifacts`)
  },

  retrySummary(sessionId: number, dto: SessionAuditRetrySummaryDto) {
    return api.post<{ ok: boolean }>(`/session-audit/${sessionId}/retry-summary`, dto)
  },

  linkTicket(sessionId: number, dto: SessionAuditLinkTicketDto) {
    return api.post<SessionAuditPublic>(`/session-audit/${sessionId}/link-ticket`, dto)
  },

  download(sessionId: number) {
    return api.get<Blob>(`/session-audit/${sessionId}/download`, {
      responseType: 'blob',
    })
  },

  transcript(sessionId:number,format:'terminal'|'commands'|'technical'='terminal') { return api.get<Blob>(`/session-audit/${sessionId}/transcript`,{params:{format},responseType:'blob'}) },
  reconstruction(sessionId:number) { return api.get<SessionAuditReconstruction>(`/session-audit/${sessionId}/reconstruction`) },
  reprocess(sessionId:number) { return api.post<SessionAuditReconstruction>(`/session-audit/${sessionId}/reconstruction`) },
  reconstructionHistory(sessionId:number) { return api.get<SessionAuditReconstruction[]>(`/session-audit/${sessionId}/reconstructions`) },
  compareReconstruction(sessionId:number,runId:string) { return api.get<{added:number;removed:number;modified:number;truncated:boolean;changes:Array<{index:number;before:string|null;after:string|null;beforeChars:number;afterChars:number;outputChanged:boolean;actorChanged:boolean}>}>(`/session-audit/${sessionId}/reconstructions/${runId}/compare`) },

  saveBlobAs: sftpService.saveBlobAs,
}
