import type { PrismaClient } from '@prisma/client'

interface LocalAiProposedActionRow {
  id: number
  requesterUserId: number
  reviewedByUserId: number | null
  actionType: 'TEST_HOST_CONNECTION'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  targetType: string
  targetId: number
  title: string
  reason: string
  riskLevel: string
  requiresApproval: boolean
  executionEnabled: boolean
  reviewNote: string | null
  approvedAt: Date | null
  rejectedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  requesterId?: number
  requesterName?: string
  requesterEmail?: string
  reviewedById?: number | null
  reviewedByName?: string | null
  reviewedByEmail?: string | null
}

export class LocalAiProposedActionRepository {
  constructor(private readonly db: PrismaClient) {}

  async listMine(tenantId: number, requesterUserId: number) {
    const rows = await this.baseSelect(tenantId, {
      requesterUserId,
    })
    return rows.map(mapRow)
  }

  async listForAdmin(tenantId: number) {
    const rows = await this.baseSelect(tenantId)
    return rows.map(mapRow)
  }

  async findById(tenantId: number, id: number) {
    const rows = await this.db.$queryRaw<LocalAiProposedActionRow[]>`
      SELECT
        p.id AS id,
        p.requester_user_id AS requesterUserId,
        p.reviewed_by_user_id AS reviewedByUserId,
        p.action_type AS actionType,
        p.status AS status,
        p.target_type AS targetType,
        p.target_id AS targetId,
        p.title AS title,
        p.reason AS reason,
        p.risk_level AS riskLevel,
        p.requires_approval AS requiresApproval,
        p.execution_enabled AS executionEnabled,
        p.review_note AS reviewNote,
        p.approved_at AS approvedAt,
        p.rejected_at AS rejectedAt,
        p.expires_at AS expiresAt,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        requester.id AS requesterId,
        requester.name AS requesterName,
        requester.email AS requesterEmail,
        reviewer.id AS reviewedById,
        reviewer.name AS reviewedByName,
        reviewer.email AS reviewedByEmail
      FROM local_ai_proposed_actions p
      INNER JOIN users requester ON requester.id = p.requester_user_id
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by_user_id
      WHERE p.tenant_id = ${tenantId}
        AND p.id = ${id}
      LIMIT 1
    `

    return mapRow(rows[0] ?? null)
  }

  async create(input: {
    tenantId: number
    requesterUserId: number
    actionType: 'TEST_HOST_CONNECTION'
    targetType: 'host'
    targetId: number
    title: string
    reason: string
    expiresAt: Date
  }) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO local_ai_proposed_actions (
          tenant_id,
          requester_user_id,
          reviewed_by_user_id,
          action_type,
          status,
          target_type,
          target_id,
          title,
          reason,
          risk_level,
          requires_approval,
          execution_enabled,
          review_note,
          approved_at,
          rejected_at,
          expires_at,
          created_at,
          updated_at
        ) VALUES (
          ${input.tenantId},
          ${input.requesterUserId},
          NULL,
          ${input.actionType},
          'PENDING',
          ${input.targetType},
          ${input.targetId},
          ${input.title},
          ${input.reason},
          'low',
          true,
          false,
          NULL,
          NULL,
          NULL,
          ${input.expiresAt},
          NOW(),
          NOW()
        )
      `

      const rows = await tx.$queryRaw<LocalAiProposedActionRow[]>`
        SELECT
          p.id AS id,
          p.requester_user_id AS requesterUserId,
          p.reviewed_by_user_id AS reviewedByUserId,
          p.action_type AS actionType,
          p.status AS status,
          p.target_type AS targetType,
          p.target_id AS targetId,
          p.title AS title,
          p.reason AS reason,
          p.risk_level AS riskLevel,
          p.requires_approval AS requiresApproval,
          p.execution_enabled AS executionEnabled,
          p.review_note AS reviewNote,
          p.approved_at AS approvedAt,
          p.rejected_at AS rejectedAt,
          p.expires_at AS expiresAt,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          requester.id AS requesterId,
          requester.name AS requesterName,
          requester.email AS requesterEmail,
          reviewer.id AS reviewedById,
          reviewer.name AS reviewedByName,
          reviewer.email AS reviewedByEmail
        FROM local_ai_proposed_actions p
        INNER JOIN users requester ON requester.id = p.requester_user_id
        LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by_user_id
        WHERE p.tenant_id = ${input.tenantId}
          AND p.requester_user_id = ${input.requesterUserId}
        ORDER BY p.id DESC
        LIMIT 1
      `

      return mapRow(rows[0] ?? null)
    })
  }

  async review(input: {
    id: number
    reviewerUserId: number
    status: 'APPROVED' | 'REJECTED'
    reviewNote: string | null
  }) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE local_ai_proposed_actions
        SET
          reviewed_by_user_id = ${input.reviewerUserId},
          status = ${input.status},
          review_note = ${input.reviewNote},
          approved_at = ${input.status === 'APPROVED' ? new Date() : null},
          rejected_at = ${input.status === 'REJECTED' ? new Date() : null},
          updated_at = NOW()
        WHERE id = ${input.id}
      `

      const rows = await tx.$queryRaw<LocalAiProposedActionRow[]>`
        SELECT
          p.id AS id,
          p.requester_user_id AS requesterUserId,
          p.reviewed_by_user_id AS reviewedByUserId,
          p.action_type AS actionType,
          p.status AS status,
          p.target_type AS targetType,
          p.target_id AS targetId,
          p.title AS title,
          p.reason AS reason,
          p.risk_level AS riskLevel,
          p.requires_approval AS requiresApproval,
          p.execution_enabled AS executionEnabled,
          p.review_note AS reviewNote,
          p.approved_at AS approvedAt,
          p.rejected_at AS rejectedAt,
          p.expires_at AS expiresAt,
          p.created_at AS createdAt,
          p.updated_at AS updatedAt,
          requester.id AS requesterId,
          requester.name AS requesterName,
          requester.email AS requesterEmail,
          reviewer.id AS reviewedById,
          reviewer.name AS reviewedByName,
          reviewer.email AS reviewedByEmail
        FROM local_ai_proposed_actions p
        INNER JOIN users requester ON requester.id = p.requester_user_id
        LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by_user_id
        WHERE p.id = ${input.id}
        LIMIT 1
      `

      return mapRow(rows[0] ?? null)
    })
  }

  private baseSelect(
    tenantId: number,
    filters?: { requesterUserId?: number },
  ) {
    return this.db.$queryRaw<LocalAiProposedActionRow[]>`
      SELECT
        p.id AS id,
        p.requester_user_id AS requesterUserId,
        p.reviewed_by_user_id AS reviewedByUserId,
        p.action_type AS actionType,
        p.status AS status,
        p.target_type AS targetType,
        p.target_id AS targetId,
        p.title AS title,
        p.reason AS reason,
        p.risk_level AS riskLevel,
        p.requires_approval AS requiresApproval,
        p.execution_enabled AS executionEnabled,
        p.review_note AS reviewNote,
        p.approved_at AS approvedAt,
        p.rejected_at AS rejectedAt,
        p.expires_at AS expiresAt,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        requester.id AS requesterId,
        requester.name AS requesterName,
        requester.email AS requesterEmail,
        reviewer.id AS reviewedById,
        reviewer.name AS reviewedByName,
        reviewer.email AS reviewedByEmail
      FROM local_ai_proposed_actions p
      INNER JOIN users requester ON requester.id = p.requester_user_id
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by_user_id
      WHERE p.tenant_id = ${tenantId}
        AND (${filters?.requesterUserId ?? null} IS NULL OR p.requester_user_id = ${filters?.requesterUserId ?? null})
      ORDER BY p.created_at DESC
    `
  }
}

function mapRow(row: LocalAiProposedActionRow | null) {
  if (!row) return null

  return {
    id: row.id,
    requesterUserId: row.requesterUserId,
    reviewedByUserId: row.reviewedByUserId,
    actionType: row.actionType,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.title,
    reason: row.reason,
    riskLevel: row.riskLevel,
    requiresApproval: row.requiresApproval,
    executionEnabled: row.executionEnabled,
    reviewNote: row.reviewNote,
    approvedAt: row.approvedAt,
    rejectedAt: row.rejectedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    requester: row.requesterId && row.requesterName && row.requesterEmail
      ? { id: row.requesterId, name: row.requesterName, email: row.requesterEmail }
      : null,
    reviewedBy: row.reviewedById && row.reviewedByName && row.reviewedByEmail
      ? { id: row.reviewedById, name: row.reviewedByName, email: row.reviewedByEmail }
      : null,
  }
}
