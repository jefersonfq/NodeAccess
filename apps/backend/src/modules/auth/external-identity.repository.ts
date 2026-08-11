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

export class ExternalIdentityRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUser(tenantId: number, issuer: string, subject: string): Promise<User | null> {
    const rows = await this.db.$queryRaw<Array<{ userId: number }>>`
      SELECT user_id AS userId
      FROM external_identities
      WHERE tenant_id = ${tenantId}
        AND issuer_hash = ${identityHash(issuer)}
        AND subject_hash = ${identityHash(subject)}
        AND active = true
      LIMIT 1
    `
    const userId = rows[0]?.userId
    if (!userId) return null
    return this.db.user.findFirst({ where: { id: userId, tenantId, deletedAt: null } })
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

  async link(input: {
    tenantId: number
    userId: number
    providerKey: string
    issuer: string
    subject: string
    email: string
  }): Promise<User> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: input.userId, tenantId: input.tenantId, deletedAt: null },
      })
      if (!user) throw new Error('Usuário não encontrado no tenant')
      await tx.externalIdentity.create({
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
      return user
    })
  }

  async createJit(input: {
    tenantId: number
    providerKey: string
    issuer: string
    subject: string
    email: string
    name: string
  }): Promise<User> {
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
      await tx.externalIdentity.create({
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
      return user
    })
  }
}

function identityHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
