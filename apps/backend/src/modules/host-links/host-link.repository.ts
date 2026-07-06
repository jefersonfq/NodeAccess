import { Prisma, type PrismaClient } from '@prisma/client'

export interface HostLinkRow {
  id: number
  tenantId: number
  hostId: number
  createdByUserId: number
  tokenHash: string
  tokenEncrypted: string | null
  tokenIv: string | null
  pinHash: string | null
  pinEncrypted: string | null
  pinIv: string | null
  type: 'AUTHENTICATED' | 'PUBLIC_ONCE'
  expiresAt: Date
  lastOpenedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface HostLinkListRow extends HostLinkRow {
  hostName?: string
  hostIp?: string
  createdByName: string
  createdByEmail: string
  activeSessions: number
}

export class HostLinkRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(data: {
    tenantId: number
    hostId: number
    createdByUserId: number
    tokenHash: string
    tokenEncrypted?: string | null
    tokenIv?: string | null
    pinHash?: string | null
    pinEncrypted?: string | null
    pinIv?: string | null
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
          token_encrypted,
          token_iv,
          pin_hash,
          pin_encrypted,
          pin_iv,
          type,
          expires_at,
          created_at,
          updated_at
        ) VALUES (
          ${data.tenantId},
          ${data.hostId},
          ${data.createdByUserId},
          ${data.tokenHash},
          ${data.tokenEncrypted ?? null},
          ${data.tokenIv ?? null},
          ${data.pinHash ?? null},
          ${data.pinEncrypted ?? null},
          ${data.pinIv ?? null},
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
          token_encrypted AS tokenEncrypted,
          token_iv AS tokenIv,
          pin_hash AS pinHash,
          pin_encrypted AS pinEncrypted,
          pin_iv AS pinIv,
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
          token_encrypted AS tokenEncrypted,
          token_iv AS tokenIv,
          pin_hash AS pinHash,
          pin_encrypted AS pinEncrypted,
          pin_iv AS pinIv,
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

  async listByHost(tenantId: number, hostId: number, limit = 20): Promise<HostLinkListRow[]> {
    return this.db.$queryRaw<HostLinkListRow[]>(Prisma.sql`
      SELECT
        hl.id,
        hl.tenant_id AS tenantId,
        hl.host_id AS hostId,
        hl.created_by_user_id AS createdByUserId,
        hl.token_hash AS tokenHash,
        hl.token_encrypted AS tokenEncrypted,
        hl.token_iv AS tokenIv,
        hl.pin_hash AS pinHash,
        hl.pin_encrypted AS pinEncrypted,
        hl.pin_iv AS pinIv,
        hl.type,
        hl.expires_at AS expiresAt,
        hl.last_opened_at AS lastOpenedAt,
        hl.revoked_at AS revokedAt,
        hl.created_at AS createdAt,
        hl.updated_at AS updatedAt,
        u.name AS createdByName,
        u.email AS createdByEmail,
        (
          SELECT COUNT(*)
          FROM sessions s
          WHERE s.jit_link_id = hl.id
            AND s.active = true
        ) AS activeSessions
      FROM host_links hl
      INNER JOIN users u ON u.id = hl.created_by_user_id
      WHERE hl.tenant_id = ${tenantId}
        AND hl.host_id = ${hostId}
      ORDER BY hl.created_at DESC
      LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}
    `)
  }

  async listByTenant(
    tenantId: number,
    userId: number,
    role: 'ADMIN' | 'USER',
    canManageHosts = false,
    limit = 100,
  ): Promise<HostLinkListRow[]> {
    const visibility = role === 'ADMIN' || canManageHosts
      ? Prisma.empty
      : Prisma.sql`AND hl.created_by_user_id = ${userId}`

    return this.db.$queryRaw<HostLinkListRow[]>(Prisma.sql`
      SELECT
        hl.id,
        hl.tenant_id AS tenantId,
        hl.host_id AS hostId,
        hl.created_by_user_id AS createdByUserId,
        hl.token_hash AS tokenHash,
        hl.token_encrypted AS tokenEncrypted,
        hl.token_iv AS tokenIv,
        hl.pin_hash AS pinHash,
        hl.pin_encrypted AS pinEncrypted,
        hl.pin_iv AS pinIv,
        hl.type,
        hl.expires_at AS expiresAt,
        hl.last_opened_at AS lastOpenedAt,
        hl.revoked_at AS revokedAt,
        hl.created_at AS createdAt,
        hl.updated_at AS updatedAt,
        h.name AS hostName,
        h.ip AS hostIp,
        u.name AS createdByName,
        u.email AS createdByEmail,
        (
          SELECT COUNT(*)
          FROM sessions s
          WHERE s.jit_link_id = hl.id
            AND s.active = true
        ) AS activeSessions
      FROM host_links hl
      INNER JOIN users u ON u.id = hl.created_by_user_id
      INNER JOIN hosts h ON h.id = hl.host_id
      WHERE hl.tenant_id = ${tenantId}
        ${visibility}
      ORDER BY hl.created_at DESC
      LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}
    `)
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

  async endActiveSessionsByLink(id: number): Promise<number> {
    return this.db.$executeRaw(Prisma.sql`
      UPDATE sessions
      SET active = false,
          ended_at = NOW(),
          ended_reason = 'jit_link_revoked'
      WHERE jit_link_id = ${id}
        AND active = true
    `)
  }
}
