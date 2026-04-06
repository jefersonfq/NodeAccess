import { Prisma, type PrismaClient } from '@prisma/client'

export interface HostLinkRow {
  id: number
  tenantId: number
  hostId: number
  createdByUserId: number
  tokenHash: string
  type: 'AUTHENTICATED' | 'PUBLIC_ONCE'
  expiresAt: Date
  lastOpenedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export class HostLinkRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: {
    tenantId: number
    hostId: number
    createdByUserId: number
    tokenHash: string
    type: 'AUTHENTICATED' | 'PUBLIC_ONCE'
    expiresAt: Date
  }): Promise<HostLinkRow> {
    await this.db.$executeRaw(
      Prisma.sql`
        INSERT INTO host_links (
          tenant_id,
          host_id,
          created_by_user_id,
          token_hash,
          type,
          expires_at,
          created_at,
          updated_at
        ) VALUES (
          ${data.tenantId},
          ${data.hostId},
          ${data.createdByUserId},
          ${data.tokenHash},
          ${data.type},
          ${data.expiresAt},
          NOW(),
          NOW()
        )
      `,
    )

    const created = await this.findByTokenHash(data.tokenHash)
    if (!created) {
      throw new Error('Failed to create host link')
    }

    return created
  }

  async findByTokenHash(tokenHash: string): Promise<HostLinkRow | null> {
    const rows = await this.db.$queryRaw<HostLinkRow[]>(
      Prisma.sql`
        SELECT
          id,
          tenant_id AS tenantId,
          host_id AS hostId,
          created_by_user_id AS createdByUserId,
          token_hash AS tokenHash,
          type,
          expires_at AS expiresAt,
          last_opened_at AS lastOpenedAt,
          revoked_at AS revokedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM host_links
        WHERE token_hash = ${tokenHash}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async findById(id: number): Promise<HostLinkRow | null> {
    const rows = await this.db.$queryRaw<HostLinkRow[]>(
      Prisma.sql`
        SELECT
          id,
          tenant_id AS tenantId,
          host_id AS hostId,
          created_by_user_id AS createdByUserId,
          token_hash AS tokenHash,
          type,
          expires_at AS expiresAt,
          last_opened_at AS lastOpenedAt,
          revoked_at AS revokedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM host_links
        WHERE id = ${id}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async markOpened(id: number): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE host_links
        SET last_opened_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `,
    )
  }

  async revoke(id: number): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE host_links
        SET revoked_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `,
    )
  }
}
