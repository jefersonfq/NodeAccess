import { env } from '../../config/env.js'
import type { PrismaClient, User } from '@prisma/client'
import { createHash } from 'node:crypto'

export class ExternalIdentityRepository {
  constructor(private readonly db: PrismaClient) {}

  async findUser(tenantId: number, issuer: string, subject: string): Promise<User | null> {
    const identity = await this.db.externalIdentity.findUnique({
      where: {
        tenantId_issuerHash_subjectHash: {
          tenantId,
          issuerHash: identityHash(issuer),
          subjectHash: identityHash(subject),
        },
      },
      include: { user: true },
    })
    if (!identity || identity.user.deletedAt) return null
    return identity.user
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
