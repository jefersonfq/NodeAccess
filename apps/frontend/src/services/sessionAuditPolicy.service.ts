import api from './api'
import type { SessionAuditPolicyPublic, UpdateSessionAuditPolicyDto } from '@nodeaccess/shared'

export const sessionAuditPolicyService = {
  get() {
    return api.get<SessionAuditPolicyPublic>('/session-audit-policy')
  },

  update(dto: UpdateSessionAuditPolicyDto) {
    return api.put<SessionAuditPolicyPublic>('/session-audit-policy', dto)
  },
}
