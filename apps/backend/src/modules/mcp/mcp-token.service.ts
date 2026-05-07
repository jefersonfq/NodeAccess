import { AppError } from '../../shared/errors.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { McpTokenRepository } from './mcp-token.repository.js'
import { MCP_CAPABILITIES, getMcpCapability } from './mcp.capabilities.js'
import type { WebhookService } from '../webhooks/webhook.service.js'

const ALLOWED_ACTION_MODES = [
  'read_only',
  'diagnostic_only',
  'approval_required',
  'full_operational_access',
] as const

export class McpTokenService {
  constructor(
    private readonly repository: McpTokenRepository,
    private readonly logRepository: LogRepository,
    private readonly entitlements: LicenseEntitlementService,
    private readonly webhookService: WebhookService,
  ) {}

  async list(input: { tenantId: number }) {
    await this.entitlements.requireFeature(
      input.tenantId,
      'mcp',
      'MCP ainda nao esta licenciado para este tenant',
    )
    return this.repository.listByTenant(input.tenantId)
  }

  async listCapabilities(input: { tenantId: number }) {
    await this.entitlements.requireFeature(
      input.tenantId,
      'mcp',
      'MCP ainda nao esta licenciado para este tenant',
    )
    return MCP_CAPABILITIES
  }

  async create(input: {
    tenantId: number
    adminId: number
    name: string
    allowedCapabilities?: string[]
    allowedActionModes?: string[]
    allowedHostIds?: number[]
    expiresAt?: string | null
  }) {
    await this.entitlements.requireFeature(
      input.tenantId,
      'mcp',
      'MCP ainda nao esta licenciado para este tenant',
    )

    const name = input.name.trim()
    if (!name) throw new AppError('Nome do token MCP obrigatorio', 400, 'MCP_TOKEN_NAME_REQUIRED')

    const allowedCapabilities = this.normalizeCapabilities(input.allowedCapabilities ?? [])
    const allowedActionModes = this.normalizeActionModes(input.allowedActionModes ?? [])
    const allowedHostIds = this.normalizeHostIds(input.allowedHostIds ?? [])
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new AppError('Data de expiracao invalida', 400, 'MCP_TOKEN_INVALID_EXPIRES_AT')
    }

    const created = await this.repository.create({
      tenantId: input.tenantId,
      createdById: input.adminId,
      name,
      allowedCapabilities,
      allowedActionModes,
      allowedHostIds,
      expiresAt,
    })

    await this.logRepository.logAdminEvent({
      adminId: input.adminId,
      action: 'MCP_TOKEN_CREATED',
      targetType: 'McpToken',
      targetId: created.record.id,
      details: JSON.stringify({
        name: created.record.name,
        allowedCapabilities: created.record.allowedCapabilities,
        allowedActionModes: created.record.allowedActionModes,
        allowedHostIds: created.record.allowedHostIds,
        expiresAt: created.record.expiresAt,
      }),
    }).catch(() => {})

    void this.webhookService.publishEvent({
      tenantId: input.tenantId, eventType: 'mcp_token.created', eventVersion: 1,
      resourceType: 'mcp_token', resourceId: String(created.record.id),
      occurredAt: new Date(), data: { name: created.record.name, createdById: input.adminId },
    }).catch(() => {})

    return created
  }

  async revoke(input: {
    id: number
    tenantId: number
    adminId: number
  }) {
    await this.entitlements.requireFeature(
      input.tenantId,
      'mcp',
      'MCP ainda nao esta licenciado para este tenant',
    )

    const record = await this.repository.revoke({
      id: input.id,
      tenantId: input.tenantId,
      revokedById: input.adminId,
    })

    await this.logRepository.logAdminEvent({
      adminId: input.adminId,
      action: 'MCP_TOKEN_REVOKED',
      targetType: 'McpToken',
      targetId: record.id,
      details: JSON.stringify({
        name: record.name,
      }),
    }).catch(() => {})

    void this.webhookService.publishEvent({
      tenantId: input.tenantId,
      eventType: 'mcp_token.revoked',
      eventVersion: 1,
      resourceType: 'mcp_token',
      resourceId: String(record.id),
      occurredAt: new Date(),
      data: { name: record.name, revokedById: input.adminId },
    }).catch(() => {})

    return record
  }

  async update(input: {
    id: number
    tenantId: number
    adminId: number
    name: string
    allowedCapabilities?: string[]
    allowedActionModes?: string[]
    allowedHostIds?: number[]
    expiresAt?: string | null
  }) {
    await this.entitlements.requireFeature(
      input.tenantId,
      'mcp',
      'MCP ainda nao esta licenciado para este tenant',
    )

    const name = input.name.trim()
    if (!name) throw new AppError('Nome do token MCP obrigatorio', 400, 'MCP_TOKEN_NAME_REQUIRED')

    const allowedCapabilities = this.normalizeCapabilities(input.allowedCapabilities ?? [])
    const allowedActionModes = this.normalizeActionModes(input.allowedActionModes ?? [])
    const allowedHostIds = this.normalizeHostIds(input.allowedHostIds ?? [])
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new AppError('Data de expiracao invalida', 400, 'MCP_TOKEN_INVALID_EXPIRES_AT')
    }

    const record = await this.repository.update({
      id: input.id,
      tenantId: input.tenantId,
      name,
      allowedCapabilities,
      allowedActionModes,
      allowedHostIds,
      expiresAt,
    })

    await this.logRepository.logAdminEvent({
      adminId: input.adminId,
      action: 'MCP_TOKEN_UPDATED',
      targetType: 'McpToken',
      targetId: record.id,
      details: JSON.stringify({
        name: record.name,
        allowedCapabilities: record.allowedCapabilities,
        allowedActionModes: record.allowedActionModes,
        allowedHostIds: record.allowedHostIds,
        expiresAt: record.expiresAt,
      }),
    }).catch(() => {})

    return record
  }

  private normalizeCapabilities(values: string[]): string[] {
    const cleaned = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    for (const key of cleaned) {
      if (!getMcpCapability(key)) {
        throw new AppError(`Capability MCP invalida: ${key}`, 400, 'MCP_INVALID_CAPABILITY')
      }
    }
    return cleaned
  }

  private normalizeActionModes(values: string[]): string[] {
    const cleaned = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    for (const mode of cleaned) {
      if (!ALLOWED_ACTION_MODES.includes(mode as typeof ALLOWED_ACTION_MODES[number])) {
        throw new AppError(`Modo de ActionRun invalido para token MCP: ${mode}`, 400, 'MCP_INVALID_ACTION_MODE')
      }
    }
    return cleaned
  }

  private normalizeHostIds(values: number[]): number[] {
    return Array.from(new Set(values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)))
  }
}
