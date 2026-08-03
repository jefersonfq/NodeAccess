import { Prisma, type PrismaClient } from '@prisma/client'
import type { SessionAuditPolicyMode } from '@nodeaccess/shared'
import { logger } from '../../config/logger.js'

export interface SessionAuditPolicyState {
  licensed: boolean
  enabled: boolean
  mode: SessionAuditPolicyMode
  userIds: number[]
  groupIds: number[]
}

export interface SaveSessionAuditPolicyInput {
  tenantId: number
  enabled: boolean
  mode: SessionAuditPolicyMode
  userIds: number[]
  groupIds: number[]
}

export class SessionAuditPolicyRepository {
  private warnedMissingTable = false

  constructor(private readonly db: PrismaClient) {}

  async getState(tenantId: number): Promise<SessionAuditPolicyState> {
    try {
      const licenseRows = await this.db.$queryRaw<Array<{ sessionAuditEnabled: number | boolean }>>(Prisma.sql`
        SELECT session_audit_enabled AS sessionAuditEnabled
        FROM licenses
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `)

      const policyRows = await this.db.$queryRaw<Array<{ id: number; enabled: number | boolean; mode: SessionAuditPolicyState['mode'] }>>(Prisma.sql`
        SELECT id, enabled, mode
        FROM session_audit_policies
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `)

      const policy = policyRows[0]
      if (!policy) {
        return {
          licensed: toBoolean(licenseRows[0]?.sessionAuditEnabled),
          enabled: false,
          mode: 'DISABLED',
          userIds: [],
          groupIds: [],
        }
      }

      const [userRows, groupRows] = await Promise.all([
        this.db.$queryRaw<Array<{ userId: number }>>(Prisma.sql`
          SELECT user_id AS userId
          FROM session_audit_policy_users
          WHERE policy_id = ${policy.id}
        `),
        this.db.$queryRaw<Array<{ groupId: number }>>(Prisma.sql`
          SELECT group_id AS groupId
          FROM session_audit_policy_groups
          WHERE policy_id = ${policy.id}
        `),
      ])

      return {
        licensed: toBoolean(licenseRows[0]?.sessionAuditEnabled),
        enabled: toBoolean(policy.enabled),
        mode: policy.mode,
        userIds: userRows.map((row) => row.userId),
        groupIds: groupRows.map((row) => row.groupId),
      }
    } catch (err) {
      this.handleError(err, tenantId)
      return {
        licensed: false,
        enabled: false,
        mode: 'DISABLED',
        userIds: [],
        groupIds: [],
      }
    }
  }

  async save(input: SaveSessionAuditPolicyInput): Promise<void> {
    try {
      await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO session_audit_policies (
            tenant_id,
            enabled,
            mode,
            created_at,
            updated_at
          ) VALUES (
            ${input.tenantId},
            ${input.enabled},
            ${input.mode},
            NOW(),
            NOW()
          )
          ON DUPLICATE KEY UPDATE
            enabled = VALUES(enabled),
            mode = VALUES(mode),
            updated_at = NOW()
        `)

        const policyRows = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
          SELECT id
          FROM session_audit_policies
          WHERE tenant_id = ${input.tenantId}
          LIMIT 1
        `)

        const policyId = policyRows[0]?.id
        if (!policyId) return

        await tx.$executeRaw(Prisma.sql`DELETE FROM session_audit_policy_users WHERE policy_id = ${policyId}`)
        await tx.$executeRaw(Prisma.sql`DELETE FROM session_audit_policy_groups WHERE policy_id = ${policyId}`)

        for (const userId of input.userIds) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO session_audit_policy_users (policy_id, user_id, created_at)
            SELECT ${policyId}, ${userId}, NOW()
            FROM users
            WHERE id = ${userId}
              AND tenant_id = ${input.tenantId}
          `)
        }

        for (const groupId of input.groupIds) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO session_audit_policy_groups (policy_id, group_id, created_at)
            SELECT ${policyId}, ${groupId}, NOW()
            FROM \`groups\`
            WHERE id = ${groupId}
              AND tenant_id = ${input.tenantId}
          `)
        }
      })
    } catch (err) {
      this.handleError(err, input.tenantId)
    }
  }

  private handleError(err: unknown, tenantId: number): void {
    if (isPolicyTableMissingError(err)) {
      if (!this.warnedMissingTable) {
        this.warnedMissingTable = true
        logger.warn({ err, tenantId }, 'Session audit policy tables not available yet; audit policy disabled')
      }
      return
    }
    logger.error({ err, tenantId }, 'Session audit policy query failed')
  }
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1
}

function isPolicyTableMissingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes('session_audit_policies')
    || err.message.includes('session_audit_policy_users')
    || err.message.includes('session_audit_policy_groups')
    || err.message.includes('session_audit_enabled')
}
