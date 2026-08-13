import { env } from '../../config/env.js'
import type { PrismaClient, User } from '@prisma/client'
import { createHash } from 'node:crypto'

export interface ExternalIdentityAdminRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  providerKey: string
  issuer: string
  emailAtLink: string | null
  active: boolean | number
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ResolvedExternalIdentity {
  identityId: number
  user: User
}

export interface ExternalIdentityLinkRequestRow {
  id: number
  userId: number
  userName: string
  userEmail: string
  providerKey: string
  issuer: string
  emailAtRequest: string
  privileged: boolean | number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class ExternalIdentityRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUser(tenantId: number, issuer: string, subject: string): Promise<User | null> {
    return (await this.findLinked(tenantId, issuer, subject))?.user ?? null
  }

  async findLinked(tenantId: number, issuer: string, subject: string): Promise<ResolvedExternalIdentity | null> {
    const rows = await this.db.$queryRaw<Array<{ id: number; userId: number }>>`
      SELECT id, user_id AS userId
      FROM external_identities
      WHERE tenant_id = ${tenantId}
        AND issuer_hash = ${identityHash(issuer)}
        AND subject_hash = ${identityHash(subject)}
        AND active = true
      LIMIT 1
    `
    const userId = rows[0]?.userId
    if (!userId) return null
    const user = await this.db.user.findFirst({ where: { id: userId, tenantId, deletedAt: null } })
    return user ? { identityId: rows[0]!.id, user } : null
  }

  async isRevoked(tenantId: number, issuer: string, subject: string): Promise<boolean> {
    const rows = await this.db.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found
      FROM external_identities
      WHERE tenant_id = ${tenantId}
        AND issuer_hash = ${identityHash(issuer)}
        AND subject_hash = ${identityHash(subject)}
        AND active = false
      LIMIT 1
    `
    return rows.length > 0
  }

  async revoke(tenantId: number, identityId: number): Promise<{ userId: number; changed: boolean } | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ userId: number; active: boolean | number }>>`
        SELECT user_id AS userId, active
        FROM external_identities
        WHERE id = ${identityId}
          AND tenant_id = ${tenantId}
        LIMIT 1
        FOR UPDATE
      `
      const identity = rows[0]
      if (!identity) return null
      const active = identity.active === true || identity.active === 1
      if (!active) return { userId: identity.userId, changed: false }

      await tx.$executeRaw`
        UPDATE external_identities
        SET active = false,
            revoked_at = ${new Date()},
            updated_at = ${new Date()}
        WHERE id = ${identityId}
          AND tenant_id = ${tenantId}
      `
      await tx.$executeRaw`
        DELETE FROM user_groups
        WHERE external_identity_id = ${identityId}
          AND source = 'OIDC'
      `
      await tx.$executeRaw`
        UPDATE users
        SET session_version = session_version + 1,
            updated_at = ${new Date()}
        WHERE id = ${identity.userId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL
      `
      return { userId: identity.userId, changed: true }
    })
  }

  async listForAdmin(tenantId: number): Promise<ExternalIdentityAdminRow[]> {
    return this.db.$queryRaw<ExternalIdentityAdminRow[]>`
      SELECT
        identity.id,
        identity.user_id AS userId,
        target_user.name AS userName,
        target_user.email AS userEmail,
        identity.provider_key AS providerKey,
        identity.issuer,
        identity.email_at_link AS emailAtLink,
        identity.active,
        identity.revoked_at AS revokedAt,
        identity.created_at AS createdAt,
        identity.updated_at AS updatedAt
      FROM external_identities identity
      INNER JOIN users target_user
        ON target_user.id = identity.user_id
       AND target_user.tenant_id = identity.tenant_id
      WHERE identity.tenant_id = ${tenantId}
      ORDER BY identity.active DESC, identity.updated_at DESC
      LIMIT 500
    `
  }

  async findUserByEmail(tenantId: number, email: string): Promise<User | null> {
    return this.db.user.findFirst({
      where: { tenantId, email, deletedAt: null },
    })
  }

  async requestLink(input: {
    tenantId: number
    userId: number
    providerKey: string
    issuer: string
    subject: string
    email: string
    privileged: boolean
  }): Promise<void> {
    await this.db.$executeRaw`
      INSERT INTO external_identity_link_requests
        (tenant_id, user_id, provider_key, issuer, issuer_hash, subject, subject_hash,
         email_at_request, privileged, status, reviewed_by_user_id, reviewed_at, created_at, updated_at)
      VALUES
        (${input.tenantId}, ${input.userId}, ${input.providerKey}, ${input.issuer}, ${identityHash(input.issuer)},
         ${input.subject}, ${identityHash(input.subject)}, ${input.email}, ${input.privileged}, 'PENDING', NULL, NULL,
         ${new Date()}, ${new Date()})
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id), email_at_request = VALUES(email_at_request),
        privileged = VALUES(privileged), status = 'PENDING', reviewed_by_user_id = NULL,
        reviewed_at = NULL, updated_at = VALUES(updated_at)
    `
  }

  listLinkRequests(tenantId: number): Promise<ExternalIdentityLinkRequestRow[]> {
    return this.db.$queryRaw<ExternalIdentityLinkRequestRow[]>`
      SELECT request.id, request.user_id AS userId, target_user.name AS userName,
             target_user.email AS userEmail, request.provider_key AS providerKey,
             request.issuer, request.email_at_request AS emailAtRequest,
             request.privileged, request.status, request.reviewed_at AS reviewedAt,
             request.created_at AS createdAt, request.updated_at AS updatedAt
      FROM external_identity_link_requests request
      INNER JOIN users target_user ON target_user.id = request.user_id
        AND target_user.tenant_id = request.tenant_id
      WHERE request.tenant_id = ${tenantId}
      ORDER BY request.status = 'PENDING' DESC, request.updated_at DESC
      LIMIT 500
    `
  }

  async reviewLinkRequest(input: { tenantId: number; requestId: number; adminId: number; approve: boolean }): Promise<{ changed: boolean; userId: number } | null> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        userId: number; providerKey: string; issuer: string; subject: string; email: string; status: string
      }>>`
        SELECT user_id AS userId, provider_key AS providerKey, issuer, subject,
               email_at_request AS email, status
        FROM external_identity_link_requests
        WHERE id = ${input.requestId} AND tenant_id = ${input.tenantId}
        LIMIT 1 FOR UPDATE
      `
      const request = rows[0]
      if (!request) return null
      if (request.status !== 'PENDING') return { changed: false, userId: request.userId }

      const user = await tx.user.findFirst({
        where: { id: request.userId, tenantId: input.tenantId, active: true, deletedAt: null },
      })
      if (!user) return null

      if (input.approve) {
        const duplicate = await tx.externalIdentity.findFirst({
          where: { tenantId: input.tenantId, issuerHash: identityHash(request.issuer), subjectHash: identityHash(request.subject) },
          select: { id: true, active: true },
        })
        if (duplicate) {
          await tx.externalIdentity.update({
            where: { id: duplicate.id },
            data: { userId: request.userId, active: true, revokedAt: null, emailAtLink: request.email },
          })
        } else {
          await tx.externalIdentity.create({
            data: {
              tenantId: input.tenantId, userId: request.userId, providerKey: request.providerKey,
              issuer: request.issuer, issuerHash: identityHash(request.issuer), subject: request.subject,
              subjectHash: identityHash(request.subject), emailAtLink: request.email,
            },
          })
        }
      }

      await tx.$executeRaw`
        UPDATE external_identity_link_requests
        SET status = ${input.approve ? 'APPROVED' : 'REJECTED'},
            reviewed_by_user_id = ${input.adminId}, reviewed_at = ${new Date()}, updated_at = ${new Date()}
        WHERE id = ${input.requestId} AND tenant_id = ${input.tenantId}
      `
      return { changed: true, userId: request.userId }
    })
  }

  async link(input: {
    tenantId: number
    userId: number
    providerKey: string
    issuer: string
    subject: string
    email: string
  }): Promise<ResolvedExternalIdentity> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: input.userId, tenantId: input.tenantId, deletedAt: null },
      })
      if (!user) throw new Error('Usuário não encontrado no tenant')
      const identity = await tx.externalIdentity.create({
        data: {
          tenantId: input.tenantId,
          userId: user.id,
          providerKey: input.providerKey,
          issuer: input.issuer,
          issuerHash: identityHash(input.issuer),
          subject: input.subject,
          subjectHash: identityHash(input.subject),
          emailAtLink: input.email,
        },
      })
      return { identityId: identity.id, user }
    })
  }

  async createJit(input: {
    tenantId: number
    providerKey: string
    issuer: string
    subject: string
    email: string
    name: string
  }): Promise<ResolvedExternalIdentity> {
    return this.db.$transaction(async (tx) => {
      // Serializa provisionamentos do mesmo tenant para que duas requisições
      // concorrentes não ultrapassem juntas o limite de licenças.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${input.tenantId} FOR UPDATE`
      const duplicateEmail = await tx.user.findFirst({
        where: { tenantId: input.tenantId, email: input.email, deletedAt: null },
        select: { id: true },
      })
      if (duplicateEmail) throw new Error('E-mail já pertence a um usuário do tenant')
      const license = await tx.license.findUnique({ where: { tenantId: input.tenantId } })
      const activeUsers = await tx.user.count({
        where: { tenantId: input.tenantId, active: true, licenseConsumed: true, deletedAt: null },
      })
      if (activeUsers >= (license?.maxUsers ?? env.LICENSE_MAX_USERS)) {
        throw new Error('Limite de usuários do tenant atingido')
      }
      const user = await tx.user.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          email: input.email,
          role: 'USER',
          canManageHosts: false,
          canViewLiveSessions: false,
          licenseConsumed: true,
          forcePasswordChange: false,
        },
      })
      const identity = await tx.externalIdentity.create({
        data: {
          tenantId: input.tenantId,
          userId: user.id,
          providerKey: input.providerKey,
          issuer: input.issuer,
          issuerHash: identityHash(input.issuer),
          subject: input.subject,
          subjectHash: identityHash(input.subject),
          emailAtLink: input.email,
        },
      })
      return { identityId: identity.id, user }
    })
  }
}

function identityHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
