import { NotFoundError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { ExternalIdentityRepository } from './external-identity.repository.js'

export interface ExternalIdentityAdminItem {
  id: number
  user: { id: number; name: string; email: string }
  providerKey: string
  issuer: string
  emailAtLink: string | null
  active: boolean
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ExternalIdentityLinkRequestItem {
  id: number
  user: { id: number; name: string; email: string }
  providerKey: string
  issuer: string
  emailAtRequest: string
  privileged: boolean
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class ExternalIdentityAdminService {
  constructor(
    private readonly identities: ExternalIdentityRepository,
    private readonly users: UserRepository,
  ) {}

  async list(tenantId: number): Promise<ExternalIdentityAdminItem[]> {
    const rows = await this.identities.listForAdmin(tenantId)
    return rows.map((row) => ({
      id: row.id,
      user: { id: row.userId, name: row.userName, email: row.userEmail },
      providerKey: row.providerKey,
      issuer: row.issuer,
      emailAtLink: row.emailAtLink,
      active: row.active === true || row.active === 1,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  async revoke(identityId: number, tenantId: number, adminId: number): Promise<{ changed: boolean }> {
    const result = await this.identities.revoke(tenantId, identityId)
    if (!result) throw new NotFoundError('Vínculo de identidade')
    if (result.changed) {
      await this.users.logAdminEvent({
        adminId,
        action: 'REVOKE_EXTERNAL_IDENTITY',
        targetType: 'ExternalIdentity',
        targetId: identityId,
        details: JSON.stringify({ userId: result.userId }),
      }).catch(() => {})
    }
    return { changed: result.changed }
  }

  async listLinkRequests(tenantId: number): Promise<ExternalIdentityLinkRequestItem[]> {
    return (await this.identities.listLinkRequests(tenantId)).map((row) => ({
      id: row.id,
      user: { id: row.userId, name: row.userName, email: row.userEmail },
      providerKey: row.providerKey,
      issuer: row.issuer,
      emailAtRequest: row.emailAtRequest,
      privileged: row.privileged === true || row.privileged === 1,
      status: row.status,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  async reviewLinkRequest(requestId: number, tenantId: number, adminId: number, approve: boolean): Promise<{ changed: boolean }> {
    const result = await this.identities.reviewLinkRequest({ tenantId, requestId, adminId, approve })
    if (!result) throw new NotFoundError('Solicitação de vínculo')
    if (result.changed) {
      await this.users.logAdminEvent({
        adminId,
        action: approve ? 'APPROVE_EXTERNAL_IDENTITY_LINK' : 'REJECT_EXTERNAL_IDENTITY_LINK',
        targetType: 'ExternalIdentityLinkRequest',
        targetId: requestId,
        details: JSON.stringify({ userId: result.userId }),
      }).catch(() => {})
    }
    return { changed: result.changed }
  }
}
