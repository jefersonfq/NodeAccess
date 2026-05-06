import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError } from '../../shared/errors.js'

export interface AiSshActionCommandPolicyRecord {
  tenantId: number
  safePatterns: string[]
  approvalPatterns: string[]
  blockedPatterns: string[]
  createdAt: Date
  updatedAt: Date
}

function parseStringArray(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function isMissingStorageError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2021') return true
  if (error.code === 'P2010') {
    const message = String((error.meta as { message?: string } | undefined)?.message ?? '')
    return message.includes('ai_ssh_action_command_policies') || message.includes('1146')
  }
  return false
}

export class AiSshActionCommandPolicyRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByTenant(tenantId: number): Promise<AiSshActionCommandPolicyRecord | null> {
    try {
      const rows = await this.db.$queryRaw<Array<{
        tenantId: number
        safePatternsJson: unknown
        approvalPatternsJson: unknown
        blockedPatternsJson: unknown
        createdAt: Date
        updatedAt: Date
      }>>(Prisma.sql`
        SELECT
          tenant_id AS tenantId,
          safe_patterns_json AS safePatternsJson,
          approval_patterns_json AS approvalPatternsJson,
          blocked_patterns_json AS blockedPatternsJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM ai_ssh_action_command_policies
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `)

      const row = rows[0]
      if (!row) return null

      return {
        tenantId: row.tenantId,
        safePatterns: parseStringArray(row.safePatternsJson),
        approvalPatterns: parseStringArray(row.approvalPatternsJson),
        blockedPatterns: parseStringArray(row.blockedPatternsJson),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    } catch (error) {
      if (isMissingStorageError(error)) return null
      throw error
    }
  }

  async upsert(input: {
    tenantId: number
    safePatterns: string[]
    approvalPatterns: string[]
    blockedPatterns: string[]
  }): Promise<AiSshActionCommandPolicyRecord> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        INSERT INTO ai_ssh_action_command_policies (
          tenant_id,
          safe_patterns_json,
          approval_patterns_json,
          blocked_patterns_json,
          created_at,
          updated_at
        ) VALUES (
          ${input.tenantId},
          ${JSON.stringify(input.safePatterns)},
          ${JSON.stringify(input.approvalPatterns)},
          ${JSON.stringify(input.blockedPatterns)},
          NOW(),
          NOW()
        )
        ON DUPLICATE KEY UPDATE
          safe_patterns_json = VALUES(safe_patterns_json),
          approval_patterns_json = VALUES(approval_patterns_json),
          blocked_patterns_json = VALUES(blocked_patterns_json),
          updated_at = NOW()
      `)

      const record = await this.findByTenant(input.tenantId)
      if (!record) throw new ConflictError('Policy de comandos SSH por IA nao foi carregada apos salvar.')
      return record
    } catch (error) {
      if (isMissingStorageError(error)) {
        throw new ConflictError('As tabelas de policy de comandos SSH por IA ainda nao estao disponiveis. Aplique a migration antes de configurar esta frente.')
      }
      throw error
    }
  }
}
