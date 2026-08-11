import type { OidcConfigPublic, UpsertOidcDto } from '@nodeaccess/shared'
import { decrypt, encrypt } from '../../shared/crypto.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { OidcService } from './oidc.service.js'

export interface StoredOidcConfig {
  name: string
  issuer: string
  clientId: string
  clientSecretEncrypted?: string
  clientSecretIv?: string
  scopes: string[]
  allowedDomains: string[]
  autoProvision: boolean
  requireMfaClaim?: boolean
  acceptedAmrValues?: string[]
  acceptedAcrValues?: string[]
}

export class OidcConfigService {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly oidc: OidcService,
    private readonly logs: LogRepository,
  ) {}

  async getPublic(tenantId: number): Promise<OidcConfigPublic> {
    const row = await this.repository.findByProvider(tenantId, 'oidc')
    const config = parseConfig(row?.config)
    return {
      enabled: row?.enabled ?? false,
      name: config?.name ?? null,
      issuer: config?.issuer ?? null,
      clientId: config?.clientId ?? null,
      hasClientSecret: !!(config?.clientSecretEncrypted && config.clientSecretIv),
      scopes: config?.scopes ?? [],
      allowedDomains: config?.allowedDomains ?? [],
      autoProvision: config?.autoProvision ?? false,
      requireMfaClaim: config?.requireMfaClaim ?? false,
      acceptedAmrValues: config?.acceptedAmrValues ?? ['mfa'],
      acceptedAcrValues: config?.acceptedAcrValues ?? [],
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async getEnabled(tenantId: number): Promise<StoredOidcConfig | null> {
    const row = await this.repository.findByProvider(tenantId, 'oidc')
    if (!row?.enabled) return null
    return parseConfig(row.config)
  }

  async upsert(tenantId: number, adminId: number, dto: UpsertOidcDto): Promise<OidcConfigPublic> {
    const existingRow = await this.repository.findByProvider(tenantId, 'oidc')
    const existing = parseConfig(existingRow?.config)
    const issuer = this.oidc.normalizeIssuer(dto.issuer)
    if (isMicrosoftEntraIssuer(issuer) && dto.autoProvision) {
      throw new Error('Microsoft Entra ID não permite auto-provisionamento por e-mail verificado')
    }
    const secret = dto.clientSecret?.trim()
      ? encrypt(dto.clientSecret.trim())
      : existing?.clientSecretEncrypted && existing.clientSecretIv
        ? { encrypted: existing.clientSecretEncrypted, iv: existing.clientSecretIv }
        : null
    if (dto.enabled && !secret) throw new Error('Client secret OIDC obrigatório para habilitar o provedor')

    const config: StoredOidcConfig = {
      name: dto.name.trim(),
      issuer,
      clientId: dto.clientId.trim(),
      scopes: normalizeList(dto.scopes),
      allowedDomains: normalizeList(dto.allowedDomains).map((domain) => domain.toLowerCase()),
      autoProvision: dto.autoProvision,
      requireMfaClaim: dto.requireMfaClaim,
      acceptedAmrValues: normalizeList(dto.acceptedAmrValues.map((value) => value.toLowerCase())),
      acceptedAcrValues: normalizeList(dto.acceptedAcrValues),
      ...(secret ? { clientSecretEncrypted: secret.encrypted, clientSecretIv: secret.iv } : {}),
    }
    await this.repository.upsert(tenantId, 'oidc', dto.enabled, JSON.stringify(config))
    await this.logs.logAdminEvent({
      adminId,
      action: 'UPDATE_OIDC_CONFIG',
      targetType: 'Integration',
      targetId: tenantId,
      details: JSON.stringify({
        enabled: dto.enabled,
        issuer,
        clientId: config.clientId,
        hasClientSecret: !!secret,
        autoProvision: config.autoProvision,
        requireMfaClaim: config.requireMfaClaim,
        acceptedAmrValues: config.acceptedAmrValues,
        acceptedAcrValues: config.acceptedAcrValues,
      }),
    }).catch(() => {})
    return this.getPublic(tenantId)
  }

  async rotateClientSecret(tenantId: number, adminId: number, clientSecret: string): Promise<OidcConfigPublic> {
    const row = await this.repository.findByProvider(tenantId, 'oidc')
    const existing = parseConfig(row?.config)
    if (!row || !existing) throw new Error('Configuração OIDC não encontrada')
    const secret = encrypt(clientSecret.trim())
    const config: StoredOidcConfig = {
      ...existing,
      clientSecretEncrypted: secret.encrypted,
      clientSecretIv: secret.iv,
    }
    await this.repository.upsert(tenantId, 'oidc', row.enabled, JSON.stringify(config))
    await this.logs.logAdminEvent({
      adminId,
      action: 'ROTATE_OIDC_CLIENT_SECRET',
      targetType: 'Integration',
      targetId: tenantId,
      details: JSON.stringify({ provider: 'oidc' }),
    }).catch(() => {})
    return this.getPublic(tenantId)
  }

  decryptClientSecret(config: StoredOidcConfig): string {
    if (!config.clientSecretEncrypted || !config.clientSecretIv) {
      throw new Error('Client secret OIDC não configurado')
    }
    return decrypt({ encrypted: config.clientSecretEncrypted, iv: config.clientSecretIv })
  }
}

function parseConfig(value: string | null | undefined): StoredOidcConfig | null {
  if (!value) return null
  try {
    return JSON.parse(value) as StoredOidcConfig
  } catch {
    return null
  }
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function isMicrosoftEntraIssuer(issuer: string): boolean {
  return new URL(issuer).hostname.toLowerCase() === 'login.microsoftonline.com'
}
