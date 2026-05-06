import type { PrismaClient } from '@prisma/client'

interface FeedbackRow {
  id: number
  type: 'SUGGESTION' | 'PROBLEM' | 'QUESTION'
  title: string
  message: string
  status: 'NEW' | 'IN_REVIEW' | 'ACCEPTED' | 'NOT_PLANNED' | 'COMPLETED'
  adminResponse: string | null
  contextRoute: string | null
  contextScreen: string | null
  createdAt: Date
  updatedAt: Date
  closedAt: Date | null
  deletedAt: Date | null
  userId?: number
  userName?: string
  userEmail?: string
  deletedByUserId?: number
  deletedByUserName?: string
  deletedByUserEmail?: string
}

export interface CreateFeedbackInput {
  tenantId: number
  userId: number
  type: 'SUGGESTION' | 'PROBLEM' | 'QUESTION'
  title: string
  message: string
  contextRoute?: string | null
  contextScreen?: string | null
}

export interface UpdateFeedbackInput {
  status: 'NEW' | 'IN_REVIEW' | 'ACCEPTED' | 'NOT_PLANNED' | 'COMPLETED'
  adminResponse?: string | null
  closedAt?: Date | null
}

export interface DeleteFeedbackInput {
  deletedAt: Date
  deletedByUserId: number
}

export interface FeedbackAdminFilters {
  status?: 'NEW' | 'IN_REVIEW' | 'ACCEPTED' | 'NOT_PLANNED' | 'COMPLETED'
  type?: 'SUGGESTION' | 'PROBLEM' | 'QUESTION'
  userId?: number
}

export class FeedbackRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateFeedbackInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO feedbacks (
          tenant_id,
          user_id,
          type,
          title,
          message,
          status,
          admin_response,
          context_route,
          context_screen,
          closed_at,
          deleted_at,
          deleted_by_user_id,
          created_at,
          updated_at
        )
        VALUES (
          ${input.tenantId},
          ${input.userId},
          ${input.type},
          ${input.title},
          ${input.message},
          'NEW',
          NULL,
          ${input.contextRoute ?? null},
          ${input.contextScreen ?? null},
          NULL,
          NULL,
          NULL,
          NOW(),
          NOW()
        )
      `

      const rows = await tx.$queryRaw<FeedbackRow[]>`
        SELECT
          f.id AS id,
          f.type AS type,
          f.title AS title,
          f.message AS message,
          f.status AS status,
          f.admin_response AS adminResponse,
          f.context_route AS contextRoute,
          f.context_screen AS contextScreen,
          f.created_at AS createdAt,
          f.updated_at AS updatedAt,
          f.closed_at AS closedAt,
          f.deleted_at AS deletedAt,
          u.id AS userId,
          u.name AS userName,
          u.email AS userEmail
        FROM feedbacks f
        INNER JOIN users u ON u.id = f.user_id
        WHERE f.tenant_id = ${input.tenantId}
          AND f.user_id = ${input.userId}
        ORDER BY f.id DESC
        LIMIT 1
      `

      return mapRow(rows[0] ?? null)
    })
  }

  async listMine(tenantId: number, userId: number) {
    const rows = await this.db.$queryRaw<FeedbackRow[]>`
      SELECT
        f.id AS id,
        f.type AS type,
        f.title AS title,
        f.message AS message,
        f.status AS status,
        f.admin_response AS adminResponse,
        f.context_route AS contextRoute,
        f.context_screen AS contextScreen,
        f.created_at AS createdAt,
        f.updated_at AS updatedAt,
        f.closed_at AS closedAt,
        f.deleted_at AS deletedAt
      FROM feedbacks f
      WHERE f.tenant_id = ${tenantId}
        AND f.user_id = ${userId}
        AND f.deleted_at IS NULL
      ORDER BY f.created_at DESC
    `

    return rows.map((row) => mapRow(row))
  }

  async listForAdmin(tenantId: number, filters: FeedbackAdminFilters) {
    const rows = await this.db.$queryRaw<FeedbackRow[]>`
      SELECT
        f.id AS id,
        f.type AS type,
        f.title AS title,
        f.message AS message,
        f.status AS status,
        f.admin_response AS adminResponse,
        f.context_route AS contextRoute,
        f.context_screen AS contextScreen,
        f.created_at AS createdAt,
        f.updated_at AS updatedAt,
        f.closed_at AS closedAt,
        f.deleted_at AS deletedAt,
        u.id AS userId,
        u.name AS userName,
        u.email AS userEmail,
        d.id AS deletedByUserId,
        d.name AS deletedByUserName,
        d.email AS deletedByUserEmail
      FROM feedbacks f
      INNER JOIN users u ON u.id = f.user_id
      LEFT JOIN users d ON d.id = f.deleted_by_user_id
      WHERE f.tenant_id = ${tenantId}
        AND (${filters.status ?? null} IS NULL OR f.status = ${filters.status ?? null})
        AND (${filters.type ?? null} IS NULL OR f.type = ${filters.type ?? null})
        AND (${filters.userId ?? null} IS NULL OR f.user_id = ${filters.userId ?? null})
      ORDER BY f.created_at DESC
    `

    return rows.map((row) => mapRow(row))
  }

  async findById(tenantId: number, id: number) {
    const rows = await this.db.$queryRaw<FeedbackRow[]>`
      SELECT
        f.id AS id,
        f.type AS type,
        f.title AS title,
        f.message AS message,
        f.status AS status,
        f.admin_response AS adminResponse,
        f.context_route AS contextRoute,
        f.context_screen AS contextScreen,
        f.created_at AS createdAt,
        f.updated_at AS updatedAt,
        f.closed_at AS closedAt,
        f.deleted_at AS deletedAt,
        u.id AS userId,
        u.name AS userName,
        u.email AS userEmail,
        d.id AS deletedByUserId,
        d.name AS deletedByUserName,
        d.email AS deletedByUserEmail
      FROM feedbacks f
      INNER JOIN users u ON u.id = f.user_id
      LEFT JOIN users d ON d.id = f.deleted_by_user_id
      WHERE f.tenant_id = ${tenantId}
        AND f.id = ${id}
      LIMIT 1
    `

    return mapRow(rows[0] ?? null)
  }

  async update(id: number, input: UpdateFeedbackInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE feedbacks
        SET
          status = ${input.status},
          admin_response = ${input.adminResponse ?? null},
          closed_at = ${input.closedAt ?? null},
          updated_at = NOW()
        WHERE id = ${id}
          AND deleted_at IS NULL
      `

      const rows = await tx.$queryRaw<FeedbackRow[]>`
        SELECT
          f.id AS id,
          f.type AS type,
          f.title AS title,
          f.message AS message,
          f.status AS status,
          f.admin_response AS adminResponse,
          f.context_route AS contextRoute,
          f.context_screen AS contextScreen,
          f.created_at AS createdAt,
          f.updated_at AS updatedAt,
          f.closed_at AS closedAt,
          f.deleted_at AS deletedAt,
          u.id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          d.id AS deletedByUserId,
          d.name AS deletedByUserName,
          d.email AS deletedByUserEmail
        FROM feedbacks f
        INNER JOIN users u ON u.id = f.user_id
        LEFT JOIN users d ON d.id = f.deleted_by_user_id
        WHERE f.id = ${id}
        LIMIT 1
      `

      return mapRow(rows[0] ?? null)
    })
  }

  async softDelete(id: number, input: DeleteFeedbackInput) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE feedbacks
        SET
          deleted_at = ${input.deletedAt},
          deleted_by_user_id = ${input.deletedByUserId},
          updated_at = NOW()
        WHERE id = ${id}
          AND deleted_at IS NULL
      `

      const rows = await tx.$queryRaw<FeedbackRow[]>`
        SELECT
          f.id AS id,
          f.type AS type,
          f.title AS title,
          f.message AS message,
          f.status AS status,
          f.admin_response AS adminResponse,
          f.context_route AS contextRoute,
          f.context_screen AS contextScreen,
          f.created_at AS createdAt,
          f.updated_at AS updatedAt,
          f.closed_at AS closedAt,
          f.deleted_at AS deletedAt,
          u.id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          d.id AS deletedByUserId,
          d.name AS deletedByUserName,
          d.email AS deletedByUserEmail
        FROM feedbacks f
        INNER JOIN users u ON u.id = f.user_id
        LEFT JOIN users d ON d.id = f.deleted_by_user_id
        WHERE f.id = ${id}
        LIMIT 1
      `

      return mapRow(rows[0] ?? null)
    })
  }
}

function mapRow(row: FeedbackRow | null) {
  if (!row) return null

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    status: row.status,
    adminResponse: row.adminResponse,
    contextRoute: row.contextRoute,
    contextScreen: row.contextScreen,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
    deletedAt: row.deletedAt,
    user: typeof row.userId === 'number'
      ? {
          id: row.userId,
          name: row.userName ?? '',
          email: row.userEmail ?? '',
        }
      : null,
    deletedBy: typeof row.deletedByUserId === 'number'
      ? {
          id: row.deletedByUserId,
          name: row.deletedByUserName ?? '',
          email: row.deletedByUserEmail ?? '',
        }
      : null,
  }
}
