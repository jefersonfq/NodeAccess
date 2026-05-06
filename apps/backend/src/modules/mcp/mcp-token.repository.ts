import { Prisma, type PrismaClient } from '@prisma/client'
import { randomBytes, createHash } from 'node:crypto'
import { ConflictError, NotFoundError } from '../../shared/errors.js'

function generateToken(): string {
  return `na_mcp_${randomBytes(32).toString('hex')}`
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function parseCapabilities(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function parseActionModes(value: unknown): string[] {
  return parseCapabilities(value)
}

function parseHostIds(value: unknown): number[] {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value
    if (!Array.isArray(parsed)) return []
    return Array.from(new Set(parsed
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0)))
  } catch {
    return []
  }
}

function isMissingTable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code === 'P2021') return true
  if (error.code === 'P2010') {
    const message = String((error.meta as { message?: string } | undefined)?.message ?? '')
    return message.includes('mcp_tokens') || message.includes('1146')
  }
  return false
}

export interface McpTokenPublicRecord {
  id: number
  name: string
  active: boolean
  allowedCapabilities: string[]
  allowedActionModes: string[]
  allowedHostIds: number[]
  lastUsage: {
    action: string
    capability: string | null
    authMode: string | null
    hostId: number | null
    runId: number | null
    timestamp: Date
  } | null
  expiresAt: Date | null
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdByName: string
  revokedByName: string | null
}

export interface McpTokenAuthRecord {
  id: number
  tenantId: number
  name: string
  allowedCapabilities: string[]
  allowedActionModes: string[]
  allowedHostIds: number[]
  expiresAt: Date | null
  createdBy: {
    id: number
    email: string
    role: 'admin' | 'user'
    canManageHosts: boolean
    forcePasswordChange: boolean
    isPlatformAdmin: boolean
    active: boolean
  }
}

export class McpTokenRepository {
  constructor(private readonly db: PrismaClient) {}

  async listByTenant(tenantId: number): Promise<McpTokenPublicRecord[]> {
    try {
      const rows = await this.db.$queryRaw<Array<{
        id: number
        name: string
        active: boolean | number | bigint
        allowedCapabilitiesJson: unknown
        allowedActionModesJson: unknown
        allowedHostIdsJson: unknown
        expiresAt: Date | null
        lastUsedAt: Date | null
        revokedAt: Date | null
        createdAt: Date
        updatedAt: Date
        createdByName: string
        revokedByName: string | null
      }>>(Prisma.sql`
        SELECT
          t.id,
          t.name,
          t.active,
          t.allowed_capabilities_json AS allowedCapabilitiesJson,
          t.allowed_action_modes_json AS allowedActionModesJson,
          t.allowed_host_ids_json AS allowedHostIdsJson,
          t.expires_at AS expiresAt,
          t.last_used_at AS lastUsedAt,
          t.revoked_at AS revokedAt,
          t.created_at AS createdAt,
          t.updated_at AS updatedAt,
          creator.name AS createdByName,
          revoker.name AS revokedByName
        FROM mcp_tokens t
        INNER JOIN users creator ON creator.id = t.created_by
        LEFT JOIN users revoker ON revoker.id = t.revoked_by
        WHERE t.tenant_id = ${tenantId}
        ORDER BY t.created_at DESC
      `)

      const usageByToken = await this.findRecentUsageByToken(tenantId)

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active === true || row.active === 1 || row.active === BigInt(1),
        allowedCapabilities: parseCapabilities(row.allowedCapabilitiesJson),
        allowedActionModes: parseActionModes(row.allowedActionModesJson),
        allowedHostIds: parseHostIds(row.allowedHostIdsJson),
        lastUsage: usageByToken.get(row.id) ?? null,
        expiresAt: row.expiresAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        createdByName: row.createdByName,
        revokedByName: row.revokedByName,
      }))
    } catch (error) {
      if (isMissingTable(error)) {
        throw new ConflictError('As tabelas de tokens MCP ainda nao estao disponiveis. Aplique a migration antes de usar a governanca do MCP.')
      }
      throw error
    }
  }

  private async findRecentUsageByToken(tenantId: number): Promise<Map<number, McpTokenPublicRecord['lastUsage']>> {
    const rows = await this.db.$queryRaw<Array<{
      action: string
      details: string | null
      timestamp: Date
    }>>(Prisma.sql`
      SELECT
        l.action,
        l.details,
        l.timestamp
      FROM admin_logs l
      INNER JOIN users u ON u.id = l.admin_id
      WHERE u.tenant_id = ${tenantId}
        AND l.target_type = 'MCP'
        AND l.details LIKE '%"tokenId":%'
      ORDER BY l.timestamp DESC
      LIMIT 500
    `)

    const result = new Map<number, McpTokenPublicRecord['lastUsage']>()
    for (const row of rows) {
      if (!row.details) continue
      try {
        const details = JSON.parse(row.details) as Record<string, unknown>
        const tokenId = typeof details.tokenId === 'number' ? details.tokenId : null
        if (tokenId === null || result.has(tokenId)) continue

        result.set(tokenId, {
          action: row.action,
          capability: typeof details.capability === 'string' ? details.capability : null,
          authMode: typeof details.authMode === 'string' ? details.authMode : null,
          hostId: typeof details.hostId === 'number' ? details.hostId : null,
          runId: typeof details.runId === 'number' ? details.runId : null,
          timestamp: row.timestamp,
        })
      } catch {
        continue
      }
    }
    return result
  }

  async create(input: {
    tenantId: number
    createdById: number
    name: string
    allowedCapabilities: string[]
    allowedActionModes: string[]
    allowedHostIds: number[]
    expiresAt: Date | null
  }): Promise<{ token: string; record: McpTokenPublicRecord }> {
    const token = generateToken()
    const tokenHash = hashToken(token)

    try {
      await this.db.$executeRaw(Prisma.sql`
        INSERT INTO mcp_tokens (
          tenant_id,
          created_by,
          name,
          token_hash,
          allowed_capabilities_json,
          allowed_action_modes_json,
          allowed_host_ids_json,
          active,
          expires_at,
          created_at,
          updated_at
        ) VALUES (
          ${input.tenantId},
          ${input.createdById},
          ${input.name},
          ${tokenHash},
          ${JSON.stringify(input.allowedCapabilities)},
          ${JSON.stringify(input.allowedActionModes)},
          ${JSON.stringify(input.allowedHostIds)},
          true,
          ${input.expiresAt},
          NOW(),
          NOW()
        )
      `)
    } catch (error) {
      if (isMissingTable(error)) {
        throw new ConflictError('As tabelas de tokens MCP ainda nao estao disponiveis. Aplique a migration antes de usar a governanca do MCP.')
      }
      throw error
    }

    const [record] = await this.db.$queryRaw<Array<{
      id: number
    }>>(Prisma.sql`
      SELECT id
      FROM mcp_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `)

    if (!record) {
      throw new NotFoundError('Token MCP')
    }

    return {
      token,
      record: await this.findPublicById(input.tenantId, record.id),
    }
  }

  async revoke(input: {
    id: number
    tenantId: number
    revokedById: number
  }): Promise<McpTokenPublicRecord> {
    try {
      const affected = await this.db.$executeRaw(Prisma.sql`
        UPDATE mcp_tokens
        SET
          active = false,
          revoked_at = IFNULL(revoked_at, NOW()),
          revoked_by = IFNULL(revoked_by, ${input.revokedById}),
          updated_at = NOW()
        WHERE id = ${input.id}
          AND tenant_id = ${input.tenantId}
      `)

      if (affected === 0) throw new NotFoundError('Token MCP')
      return this.findPublicById(input.tenantId, input.id)
    } catch (error) {
      if (isMissingTable(error)) {
        throw new ConflictError('As tabelas de tokens MCP ainda nao estao disponiveis. Aplique a migration antes de usar a governanca do MCP.')
      }
      throw error
    }
  }

  async update(input: {
    id: number
    tenantId: number
    name: string
    allowedCapabilities: string[]
    allowedActionModes: string[]
    allowedHostIds: number[]
    expiresAt: Date | null
  }): Promise<McpTokenPublicRecord> {
    try {
      const affected = await this.db.$executeRaw(Prisma.sql`
        UPDATE mcp_tokens
        SET
          name = ${input.name},
          allowed_capabilities_json = ${JSON.stringify(input.allowedCapabilities)},
          allowed_action_modes_json = ${JSON.stringify(input.allowedActionModes)},
          allowed_host_ids_json = ${JSON.stringify(input.allowedHostIds)},
          expires_at = ${input.expiresAt},
          updated_at = NOW()
        WHERE id = ${input.id}
          AND tenant_id = ${input.tenantId}
      `)

      if (affected === 0) throw new NotFoundError('Token MCP')
      return this.findPublicById(input.tenantId, input.id)
    } catch (error) {
      if (isMissingTable(error)) {
        throw new ConflictError('As tabelas de tokens MCP ainda nao estao disponiveis. Aplique a migration antes de usar a governanca do MCP.')
      }
      throw error
    }
  }

  async authenticate(rawToken: string): Promise<McpTokenAuthRecord | null> {
    const tokenHash = hashToken(rawToken)
    try {
      const rows = await this.db.$queryRaw<Array<{
        id: number
        tenantId: number
        name: string
        allowedCapabilitiesJson: unknown
        allowedActionModesJson: unknown
        allowedHostIdsJson: unknown
        expiresAt: Date | null
        createdById: number
        createdByEmail: string
        createdByRole: 'ADMIN' | 'USER'
        createdByCanManageHosts: boolean | number | bigint
        createdByForcePasswordChange: boolean | number | bigint
        createdByIsPlatformAdmin: boolean | number | bigint
        createdByActive: boolean | number | bigint
      }>>(Prisma.sql`
        SELECT
          t.id,
          t.tenant_id AS tenantId,
          t.name,
          t.allowed_capabilities_json AS allowedCapabilitiesJson,
          t.allowed_action_modes_json AS allowedActionModesJson,
          t.allowed_host_ids_json AS allowedHostIdsJson,
          t.expires_at AS expiresAt,
          creator.id AS createdById,
          creator.email AS createdByEmail,
          creator.role AS createdByRole,
          creator.can_manage_hosts AS createdByCanManageHosts,
          creator.force_password_change AS createdByForcePasswordChange,
          creator.is_platform_admin AS createdByIsPlatformAdmin,
          creator.active AS createdByActive
        FROM mcp_tokens t
        INNER JOIN users creator ON creator.id = t.created_by
        WHERE t.token_hash = ${tokenHash}
          AND t.active = true
          AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > NOW())
        LIMIT 1
      `)

      const row = rows[0]
      if (!row) return null

      return {
        id: row.id,
        tenantId: row.tenantId,
        name: row.name,
        allowedCapabilities: parseCapabilities(row.allowedCapabilitiesJson),
        allowedActionModes: parseActionModes(row.allowedActionModesJson),
        allowedHostIds: parseHostIds(row.allowedHostIdsJson),
        expiresAt: row.expiresAt,
        createdBy: {
          id: row.createdById,
          email: row.createdByEmail,
          role: row.createdByRole === 'ADMIN' ? 'admin' : 'user',
          canManageHosts: row.createdByCanManageHosts === true || row.createdByCanManageHosts === 1 || row.createdByCanManageHosts === BigInt(1),
          forcePasswordChange: row.createdByForcePasswordChange === true || row.createdByForcePasswordChange === 1 || row.createdByForcePasswordChange === BigInt(1),
          isPlatformAdmin: row.createdByIsPlatformAdmin === true || row.createdByIsPlatformAdmin === 1 || row.createdByIsPlatformAdmin === BigInt(1),
          active: row.createdByActive === true || row.createdByActive === 1 || row.createdByActive === BigInt(1),
        },
      }
    } catch (error) {
      if (isMissingTable(error)) return null
      throw error
    }
  }

  async touchLastUsed(id: number): Promise<void> {
    try {
      await this.db.$executeRaw(Prisma.sql`
        UPDATE mcp_tokens
        SET last_used_at = NOW(), updated_at = NOW()
        WHERE id = ${id}
      `)
    } catch (error) {
      if (isMissingTable(error)) return
      throw error
    }
  }

  private async findPublicById(tenantId: number, id: number): Promise<McpTokenPublicRecord> {
    const items = await this.listByTenant(tenantId)
    const item = items.find((entry) => entry.id === id)
    if (!item) throw new NotFoundError('Token MCP')
    return item
  }
}
