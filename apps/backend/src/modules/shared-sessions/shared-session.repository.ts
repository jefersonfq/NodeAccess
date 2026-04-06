import { Prisma, type PrismaClient } from '@prisma/client'

export interface SharedSessionRow {
  id: number
  tenantId: number
  hostId: number
  hostName: string
  ownerUserId: number
  ownerName: string
  ownerEmail: string | null
  sessionId: number
  status: 'ACTIVE' | 'ENDED' | 'REVOKED'
  joinTokenHash: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface SharedSessionParticipantRow {
  id: number
  sharedSessionId: number
  userId: number
  name: string
  email: string | null
  role: 'OWNER' | 'VIEWER'
  joinedAt: Date
  leftAt: Date | null
  lastSeenAt: Date | null
}

export interface SharedSessionControlLeaseRow {
  id: number
  sharedSessionId: number
  controllerUserId: number
  grantedByUserId: number
  startedAt: Date
  expiresAt: Date
  endedAt: Date | null
  endReason: 'REVOKED' | 'EXPIRED' | 'SESSION_ENDED' | 'OWNER_DISCONNECTED' | 'RELINQUISHED' | null
  revokeReason: string | null
}

export interface SharedSessionAuditContextRow {
  sharedSessionId: number
  sessionId: number
  ownerUserId: number
  ownerName: string
  status: 'ACTIVE' | 'ENDED' | 'REVOKED'
}

export interface ActiveSessionShareRow {
  sessionId: number
  hostId: number
  hostName: string
  ownerUserId: number
  ownerName: string
  ownerEmail: string | null
  tenantId: number
  active: boolean
}

export class SharedSessionRepository {
  constructor(private readonly db: PrismaClient) {}

  async findActiveSessionForShare(sessionId: number, tenantId: number): Promise<ActiveSessionShareRow | null> {
    const rows = await this.db.$queryRaw<ActiveSessionShareRow[]>(
      Prisma.sql`
        SELECT
          s.id AS sessionId,
          s.host_id AS hostId,
          h.name AS hostName,
          s.user_id AS ownerUserId,
          u.name AS ownerName,
          u.email AS ownerEmail,
          u.tenant_id AS tenantId,
          s.active AS active
        FROM sessions s
        INNER JOIN users u ON u.id = s.user_id
        INNER JOIN hosts h ON h.id = s.host_id
        WHERE s.id = ${sessionId}
          AND u.tenant_id = ${tenantId}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async create(data: {
    tenantId: number
    hostId: number
    ownerUserId: number
    sessionId: number
    joinTokenHash: string
    expiresAt: Date
  }): Promise<SharedSessionRow> {
    await this.db.$transaction([
      this.db.$executeRaw(
        Prisma.sql`
          INSERT INTO shared_sessions (
            tenant_id,
            host_id,
            owner_user_id,
            session_id,
            join_token_hash,
            expires_at,
            created_at,
            updated_at
          ) VALUES (
            ${data.tenantId},
            ${data.hostId},
            ${data.ownerUserId},
            ${data.sessionId},
            ${data.joinTokenHash},
            ${data.expiresAt},
            NOW(),
            NOW()
          )
        `,
      ),
      this.db.$executeRaw(
        Prisma.sql`
          INSERT INTO shared_session_participants (
            shared_session_id,
            user_id,
            role,
            joined_at,
            last_seen_at
          )
          SELECT
            id,
            ${data.ownerUserId},
            'OWNER',
            NOW(),
            NOW()
          FROM shared_sessions
          WHERE join_token_hash = ${data.joinTokenHash}
          LIMIT 1
        `,
      ),
    ])

    const created = await this.findByTokenHash(data.joinTokenHash)
    if (!created) {
      throw new Error('Failed to create shared session')
    }
    return created
  }

  async findById(id: number): Promise<SharedSessionRow | null> {
    const rows = await this.db.$queryRaw<SharedSessionRow[]>(
      Prisma.sql`
        SELECT
          ss.id,
          ss.tenant_id AS tenantId,
          ss.host_id AS hostId,
          h.name AS hostName,
          ss.owner_user_id AS ownerUserId,
          owner.name AS ownerName,
          owner.email AS ownerEmail,
          ss.session_id AS sessionId,
          ss.status,
          ss.join_token_hash AS joinTokenHash,
          ss.expires_at AS expiresAt,
          ss.created_at AS createdAt,
          ss.updated_at AS updatedAt
        FROM shared_sessions ss
        INNER JOIN hosts h ON h.id = ss.host_id
        INNER JOIN users owner ON owner.id = ss.owner_user_id
        WHERE ss.id = ${id}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async findByTokenHash(joinTokenHash: string): Promise<SharedSessionRow | null> {
    const rows = await this.db.$queryRaw<SharedSessionRow[]>(
      Prisma.sql`
        SELECT
          ss.id,
          ss.tenant_id AS tenantId,
          ss.host_id AS hostId,
          h.name AS hostName,
          ss.owner_user_id AS ownerUserId,
          owner.name AS ownerName,
          owner.email AS ownerEmail,
          ss.session_id AS sessionId,
          ss.status,
          ss.join_token_hash AS joinTokenHash,
          ss.expires_at AS expiresAt,
          ss.created_at AS createdAt,
          ss.updated_at AS updatedAt
        FROM shared_sessions ss
        INNER JOIN hosts h ON h.id = ss.host_id
        INNER JOIN users owner ON owner.id = ss.owner_user_id
        WHERE ss.join_token_hash = ${joinTokenHash}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async findParticipants(sharedSessionId: number): Promise<SharedSessionParticipantRow[]> {
    return this.db.$queryRaw<SharedSessionParticipantRow[]>(
      Prisma.sql`
        SELECT
          ssp.id,
          ssp.shared_session_id AS sharedSessionId,
          ssp.user_id AS userId,
          u.name,
          u.email,
          ssp.role,
          ssp.joined_at AS joinedAt,
          ssp.left_at AS leftAt,
          ssp.last_seen_at AS lastSeenAt
        FROM shared_session_participants ssp
        INNER JOIN users u ON u.id = ssp.user_id
        WHERE ssp.shared_session_id = ${sharedSessionId}
        ORDER BY ssp.joined_at ASC
      `,
    )
  }

  async findParticipant(sharedSessionId: number, userId: number): Promise<SharedSessionParticipantRow | null> {
    const rows = await this.db.$queryRaw<SharedSessionParticipantRow[]>(
      Prisma.sql`
        SELECT
          ssp.id,
          ssp.shared_session_id AS sharedSessionId,
          ssp.user_id AS userId,
          u.name,
          u.email,
          ssp.role,
          ssp.joined_at AS joinedAt,
          ssp.left_at AS leftAt,
          ssp.last_seen_at AS lastSeenAt
        FROM shared_session_participants ssp
        INNER JOIN users u ON u.id = ssp.user_id
        WHERE ssp.shared_session_id = ${sharedSessionId}
          AND ssp.user_id = ${userId}
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async findActiveControlLease(sharedSessionId: number): Promise<SharedSessionControlLeaseRow | null> {
    const rows = await this.db.$queryRaw<SharedSessionControlLeaseRow[]>(
      Prisma.sql`
        SELECT
          sscl.id,
          sscl.shared_session_id AS sharedSessionId,
          sscl.controller_user_id AS controllerUserId,
          sscl.granted_by_user_id AS grantedByUserId,
          sscl.started_at AS startedAt,
          sscl.expires_at AS expiresAt,
          sscl.ended_at AS endedAt,
          sscl.end_reason AS endReason,
          sscl.revoke_reason AS revokeReason
        FROM shared_session_control_leases sscl
        WHERE sscl.shared_session_id = ${sharedSessionId}
          AND sscl.ended_at IS NULL
          AND sscl.expires_at > NOW()
        ORDER BY sscl.started_at DESC
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async findBySessionId(sessionId: number): Promise<SharedSessionAuditContextRow | null> {
    const rows = await this.db.$queryRaw<SharedSessionAuditContextRow[]>(
      Prisma.sql`
        SELECT
          ss.id AS sharedSessionId,
          ss.session_id AS sessionId,
          ss.owner_user_id AS ownerUserId,
          owner.name AS ownerName,
          ss.status
        FROM shared_sessions ss
        INNER JOIN users owner ON owner.id = ss.owner_user_id
        WHERE ss.session_id = ${sessionId}
        ORDER BY ss.created_at DESC
        LIMIT 1
      `,
    )

    return rows[0] ?? null
  }

  async listActiveBySessionId(sessionId: number): Promise<SharedSessionRow[]> {
    return this.db.$queryRaw<SharedSessionRow[]>(
      Prisma.sql`
        SELECT
          ss.id,
          ss.tenant_id AS tenantId,
          ss.host_id AS hostId,
          h.name AS hostName,
          ss.owner_user_id AS ownerUserId,
          owner.name AS ownerName,
          owner.email AS ownerEmail,
          ss.session_id AS sessionId,
          ss.status,
          ss.join_token_hash AS joinTokenHash,
          ss.expires_at AS expiresAt,
          ss.created_at AS createdAt,
          ss.updated_at AS updatedAt
        FROM shared_sessions ss
        INNER JOIN hosts h ON h.id = ss.host_id
        INNER JOIN users owner ON owner.id = ss.owner_user_id
        WHERE ss.session_id = ${sessionId}
          AND ss.status = 'ACTIVE'
          AND ss.expires_at > NOW()
        ORDER BY ss.created_at DESC
      `,
    )
  }

  async findControlLeases(sharedSessionId: number): Promise<SharedSessionControlLeaseRow[]> {
    return this.db.$queryRaw<SharedSessionControlLeaseRow[]>(
      Prisma.sql`
        SELECT
          sscl.id,
          sscl.shared_session_id AS sharedSessionId,
          sscl.controller_user_id AS controllerUserId,
          sscl.granted_by_user_id AS grantedByUserId,
          sscl.started_at AS startedAt,
          sscl.expires_at AS expiresAt,
          sscl.ended_at AS endedAt,
          sscl.end_reason AS endReason,
          sscl.revoke_reason AS revokeReason
        FROM shared_session_control_leases sscl
        WHERE sscl.shared_session_id = ${sharedSessionId}
        ORDER BY sscl.started_at ASC
      `,
    )
  }

  async createControlLease(data: {
    sharedSessionId: number
    controllerUserId: number
    grantedByUserId: number
    expiresAt: Date
  }): Promise<SharedSessionControlLeaseRow> {
    await this.db.$executeRaw(
      Prisma.sql`
        INSERT INTO shared_session_control_leases (
          shared_session_id,
          controller_user_id,
          granted_by_user_id,
          started_at,
          expires_at
        ) VALUES (
          ${data.sharedSessionId},
          ${data.controllerUserId},
          ${data.grantedByUserId},
          NOW(),
          ${data.expiresAt}
        )
      `,
    )

    const created = await this.findActiveControlLease(data.sharedSessionId)
    if (!created) {
      throw new Error('Failed to create shared session control lease')
    }
    return created
  }

  async endActiveControlLease(
    sharedSessionId: number,
    endReason: 'REVOKED' | 'EXPIRED' | 'SESSION_ENDED' | 'OWNER_DISCONNECTED' | 'RELINQUISHED',
    revokeReason?: string,
  ): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE shared_session_control_leases
        SET
          ended_at = NOW(),
          end_reason = ${endReason},
          revoke_reason = ${revokeReason ?? null}
        WHERE shared_session_id = ${sharedSessionId}
          AND ended_at IS NULL
      `,
    )
  }

  async upsertViewerParticipant(sharedSessionId: number, userId: number): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        INSERT INTO shared_session_participants (
          shared_session_id,
          user_id,
          role,
          joined_at,
          left_at,
          last_seen_at
        ) VALUES (
          ${sharedSessionId},
          ${userId},
          'VIEWER',
          NOW(),
          NULL,
          NOW()
        )
        ON DUPLICATE KEY UPDATE
          left_at = NULL,
          last_seen_at = NOW()
      `,
    )
  }

  async markParticipantLeft(sharedSessionId: number, userId: number): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE shared_session_participants
        SET left_at = NOW(), last_seen_at = NOW()
        WHERE shared_session_id = ${sharedSessionId}
          AND user_id = ${userId}
          AND role = 'VIEWER'
      `,
    )
  }

  async touchParticipant(sharedSessionId: number, userId: number): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE shared_session_participants
        SET last_seen_at = NOW()
        WHERE shared_session_id = ${sharedSessionId}
          AND user_id = ${userId}
      `,
    )
  }

  async revoke(id: number): Promise<void> {
    await this.db.$executeRaw(
      Prisma.sql`
        UPDATE shared_sessions
        SET status = 'REVOKED', updated_at = NOW()
        WHERE id = ${id}
      `,
    )
  }
}
