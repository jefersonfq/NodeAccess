import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError } from '../../shared/errors.js'
import type { SessionCommandRule, SessionCommandRuleAction, SessionCommandRuleType } from './session-command-policy.evaluator.js'

export type SessionCommandBindingTargetType = 'global' | 'user' | 'user_group' | 'host' | 'host_group'

export interface SessionCommandPolicyGroupRecord {
  id: number
  tenantId: number
  name: string
  description: string | null
  enabled: boolean
  priority: number
  defaultAction: 'allow' | 'block'
  createdAt: Date
  updatedAt: Date
}

export interface SessionCommandPolicyRuleRecord extends SessionCommandRule {
  policyGroupId: number
  createdAt: Date
  updatedAt: Date
}

export interface SessionCommandPolicyBindingRecord {
  id: number
  policyGroupId: number
  targetType: SessionCommandBindingTargetType
  targetId: number | null
  createdAt: Date
}

function isMissingStorageError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2021') return true
  if (error.code === 'P2010') {
    const message = String((error.meta as { message?: string } | undefined)?.message ?? '')
    return message.includes('session_command_policy_') || message.includes('1146')
  }
  return false
}

function toBoolean(value: boolean | number | bigint): boolean {
  return value === true || value === 1 || value === BigInt(1)
}

export class SessionCommandPolicyRepository {
  constructor(private readonly db: PrismaClient) {}

  async listGroups(tenantId: number): Promise<SessionCommandPolicyGroupRecord[]> {
    try {
      const rows = await this.db.$queryRaw<Array<SessionCommandPolicyGroupRecord & { enabled: boolean | number | bigint }>>(Prisma.sql`
        SELECT
          id,
          tenant_id AS tenantId,
          name,
          description,
          enabled,
          priority,
          default_action AS defaultAction,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM session_command_policy_groups
        WHERE tenant_id = ${tenantId}
        ORDER BY priority DESC, name ASC
      `)
      return rows.map((row) => ({ ...row, enabled: toBoolean(row.enabled) }))
    } catch (error) {
      if (isMissingStorageError(error)) return []
      throw error
    }
  }

  async findGroup(tenantId: number, id: number): Promise<SessionCommandPolicyGroupRecord | null> {
    const rows = await this.listGroups(tenantId)
    return rows.find((row) => row.id === id) ?? null
  }

  async createGroup(input: {
    tenantId: number
    name: string
    description?: string | null
    enabled: boolean
    priority: number
    defaultAction: 'allow' | 'block'
  }): Promise<SessionCommandPolicyGroupRecord> {
    try {
      const rows = await this.db.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO session_command_policy_groups (
            tenant_id, name, description, enabled, priority, default_action, created_at, updated_at
          ) VALUES (
            ${input.tenantId}, ${input.name}, ${input.description ?? null}, ${input.enabled}, ${input.priority}, ${input.defaultAction}, NOW(), NOW()
          )
        `)
        return tx.$queryRaw<Array<{ id: bigint | number }>>(Prisma.sql`SELECT LAST_INSERT_ID() AS id`)
      })
      const created = await this.findGroup(input.tenantId, Number(rows[0]?.id))
      if (!created) throw new ConflictError('Politica de comandos nao foi carregada apos criacao.')
      return created
    } catch (error) {
      if (isMissingStorageError(error)) throw new ConflictError('Tabelas de politicas de comandos indisponiveis. Aplique a migration.')
      throw error
    }
  }

  async updateGroup(tenantId: number, id: number, input: {
    name?: string
    description?: string | null
    enabled?: boolean
    priority?: number
    defaultAction?: 'allow' | 'block'
  }): Promise<SessionCommandPolicyGroupRecord | null> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE session_command_policy_groups
        SET
          name = COALESCE(${input.name ?? null}, name),
          description = ${input.description === undefined ? Prisma.sql`description` : input.description},
          enabled = COALESCE(${input.enabled ?? null}, enabled),
          priority = COALESCE(${input.priority ?? null}, priority),
          default_action = COALESCE(${input.defaultAction ?? null}, default_action),
          updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND id = ${id}
      `)
      return this.findGroup(tenantId, id)
    } catch (error) {
      if (isMissingStorageError(error)) throw new ConflictError('Tabelas de politicas de comandos indisponiveis. Aplique a migration.')
      throw error
    }
  }

  async deleteGroup(tenantId: number, id: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      DELETE FROM session_command_policy_groups
      WHERE tenant_id = ${tenantId} AND id = ${id}
    `)
  }

  async listRules(tenantId: number, policyGroupId: number): Promise<SessionCommandPolicyRuleRecord[]> {
    const rows = await this.db.$queryRaw<Array<{
      id: number
      policyGroupId: number
      type: SessionCommandRuleType
      pattern: string
      action: SessionCommandRuleAction
      message: string | null
      enabled: boolean | number | bigint
      priority: number
      createdAt: Date
      updatedAt: Date
    }>>(Prisma.sql`
      SELECT
        r.id,
        r.policy_group_id AS policyGroupId,
        r.type,
        r.pattern,
        r.action,
        r.message,
        r.enabled,
        r.priority,
        r.created_at AS createdAt,
        r.updated_at AS updatedAt
      FROM session_command_policy_rules r
      INNER JOIN session_command_policy_groups g ON g.id = r.policy_group_id
      WHERE g.tenant_id = ${tenantId} AND r.policy_group_id = ${policyGroupId}
      ORDER BY r.priority DESC, r.id ASC
    `)

    return rows.map((row) => {
      const { message, ...rest } = row
      return {
        ...rest,
        id: String(row.id),
        enabled: toBoolean(row.enabled),
        ...(message !== null && { message }),
      }
    })
  }

  async createRule(tenantId: number, policyGroupId: number, input: {
    type: SessionCommandRuleType
    pattern: string
    action: SessionCommandRuleAction
    message?: string | null
    enabled: boolean
    priority: number
  }): Promise<SessionCommandPolicyRuleRecord[]> {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO session_command_policy_rules (
        policy_group_id, type, pattern, action, message, enabled, priority, created_at, updated_at
      )
      SELECT id, ${input.type}, ${input.pattern}, ${input.action}, ${input.message ?? null}, ${input.enabled}, ${input.priority}, NOW(), NOW()
      FROM session_command_policy_groups
      WHERE tenant_id = ${tenantId} AND id = ${policyGroupId}
    `)
    return this.listRules(tenantId, policyGroupId)
  }

  async deleteRule(tenantId: number, policyGroupId: number, ruleId: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      DELETE r FROM session_command_policy_rules r
      INNER JOIN session_command_policy_groups g ON g.id = r.policy_group_id
      WHERE g.tenant_id = ${tenantId} AND r.policy_group_id = ${policyGroupId} AND r.id = ${ruleId}
    `)
  }

  async listBindings(tenantId: number, policyGroupId: number): Promise<SessionCommandPolicyBindingRecord[]> {
    return this.db.$queryRaw<SessionCommandPolicyBindingRecord[]>(Prisma.sql`
      SELECT
        b.id,
        b.policy_group_id AS policyGroupId,
        b.target_type AS targetType,
        b.target_id AS targetId,
        b.created_at AS createdAt
      FROM session_command_policy_bindings b
      INNER JOIN session_command_policy_groups g ON g.id = b.policy_group_id
      WHERE g.tenant_id = ${tenantId} AND b.policy_group_id = ${policyGroupId}
      ORDER BY b.target_type ASC, b.target_id ASC
    `)
  }

  async createBinding(tenantId: number, policyGroupId: number, input: {
    targetType: SessionCommandBindingTargetType
    targetId?: number | null
  }): Promise<SessionCommandPolicyBindingRecord[]> {
    await this.db.$executeRaw(Prisma.sql`
      INSERT IGNORE INTO session_command_policy_bindings (
        policy_group_id, target_type, target_id, created_at
      )
      SELECT id, ${input.targetType}, ${input.targetId ?? null}, NOW()
      FROM session_command_policy_groups
      WHERE tenant_id = ${tenantId} AND id = ${policyGroupId}
    `)
    return this.listBindings(tenantId, policyGroupId)
  }

  async deleteBinding(tenantId: number, policyGroupId: number, bindingId: number): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      DELETE b FROM session_command_policy_bindings b
      INNER JOIN session_command_policy_groups g ON g.id = b.policy_group_id
      WHERE g.tenant_id = ${tenantId} AND b.policy_group_id = ${policyGroupId} AND b.id = ${bindingId}
    `)
  }

  async findEffectiveRules(input: { tenantId: number; userId: number; hostId: number }): Promise<SessionCommandRule[]> {
    const rows = await this.db.$queryRaw<Array<{
      id: number
      type: SessionCommandRuleType
      pattern: string
      action: SessionCommandRuleAction
      message: string | null
      enabled: boolean | number | bigint
      priority: number
      groupPriority: number
    }>>(Prisma.sql`
      SELECT DISTINCT
        r.id,
        r.type,
        r.pattern,
        r.action,
        r.message,
        r.enabled,
        r.priority,
        g.priority AS groupPriority
      FROM session_command_policy_rules r
      INNER JOIN session_command_policy_groups g ON g.id = r.policy_group_id
      INNER JOIN session_command_policy_bindings b ON b.policy_group_id = g.id
      LEFT JOIN user_groups ug ON ug.user_id = ${input.userId}
      LEFT JOIN hosts h ON h.id = ${input.hostId} AND h.tenant_id = ${input.tenantId} AND h.deleted_at IS NULL
      WHERE
        g.tenant_id = ${input.tenantId}
        AND g.enabled = TRUE
        AND r.enabled = TRUE
        AND (
          b.target_type = 'global'
          OR (b.target_type = 'user' AND b.target_id = ${input.userId})
          OR (b.target_type = 'user_group' AND b.target_id = ug.group_id)
          OR (b.target_type = 'host' AND b.target_id = ${input.hostId})
          OR (b.target_type = 'host_group' AND b.target_id = h.group_id)
        )
      ORDER BY g.priority DESC, r.priority DESC, r.id ASC
    `)

    return rows.map((row) => ({
      id: String(row.id),
      type: row.type,
      pattern: row.pattern,
      action: row.action,
      ...(row.message !== null && { message: row.message }),
      enabled: toBoolean(row.enabled),
      priority: row.groupPriority + row.priority,
    }))
  }

  async findEffectiveDefaultAction(input: { tenantId: number; userId: number; hostId: number }): Promise<SessionCommandRuleAction> {
    const rows = await this.db.$queryRaw<Array<{
      defaultAction: SessionCommandRuleAction
      priority: number
    }>>(Prisma.sql`
      SELECT DISTINCT
        g.default_action AS defaultAction,
        g.priority
      FROM session_command_policy_groups g
      INNER JOIN session_command_policy_bindings b ON b.policy_group_id = g.id
      LEFT JOIN user_groups ug ON ug.user_id = ${input.userId}
      LEFT JOIN hosts h ON h.id = ${input.hostId} AND h.tenant_id = ${input.tenantId} AND h.deleted_at IS NULL
      WHERE
        g.tenant_id = ${input.tenantId}
        AND g.enabled = TRUE
        AND (
          b.target_type = 'global'
          OR (b.target_type = 'user' AND b.target_id = ${input.userId})
          OR (b.target_type = 'user_group' AND b.target_id = ug.group_id)
          OR (b.target_type = 'host' AND b.target_id = ${input.hostId})
          OR (b.target_type = 'host_group' AND b.target_id = h.group_id)
        )
      ORDER BY g.priority DESC, CASE WHEN g.default_action = 'block' THEN 0 ELSE 1 END ASC
      LIMIT 1
    `)

    return rows[0]?.defaultAction ?? 'allow'
  }
}
