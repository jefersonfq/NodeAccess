import type {
  IntegrationPublic,
  UpsertOnePasswordDto,
  UpsertGoogleDto,
  UpsertOpenAiDto,
  UpsertJiraDto,
  GoogleConfigPublic,
  OpenAiConfigPublic,
  OpenAiTestResult,
  JiraConfigPublic,
  JiraTestResult,
} from '@nodeaccess/shared'
import type { IntegrationRepository } from './integration.repository.js'
import type { OnePasswordService }    from './onepassword.service.js'
import type { GoogleService }         from '../auth/google.service.js'
import type { OpenAiIntegrationService, StoredOpenAiConfig } from './openai.service.js'
import type { JiraIntegrationService, StoredJiraConfig } from './jira.service.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

const PROVIDERS = ['onepassword', 'google', 'openai', 'jira'] as const

function toPublic(row: { provider: string; enabled: boolean; config: string; updatedAt: Date }): IntegrationPublic {
  return {
    provider:  row.provider,
    enabled:   row.enabled,
    hasToken:  !!row.config,
    updatedAt: row.updatedAt,
  }
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export class IntegrationService {
  constructor(
    private readonly repo:        IntegrationRepository,
    private readonly onePassword: OnePasswordService,
    private readonly google:      GoogleService,
    private readonly openai:      OpenAiIntegrationService,
    private readonly jira:        JiraIntegrationService,
    private readonly entitlements: LicenseEntitlementService,
  ) {}

  async list(tenantId: number): Promise<IntegrationPublic[]> {
    const rows = await this.repo.listByTenant(tenantId)
    const snapshot = await this.entitlements.getSnapshot(tenantId)
    const integrationsLicensed = snapshot.featureEntitlements.integrations === true

    return PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider)
      const providerLicensed =
        provider === 'openai'
          ? true
          : integrationsLicensed && snapshot.integrationEntitlements[provider] === true

      if (!providerLicensed) {
        return { provider, enabled: false, hasToken: false, updatedAt: new Date(0) }
      }

      return row
        ? toPublic(row)
        : { provider, enabled: false, hasToken: false, updatedAt: new Date(0) }
    })
  }

  async upsertOnePassword(tenantId: number, dto: UpsertOnePasswordDto): Promise<IntegrationPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'onepassword', 'Integração 1Password não licenciada para este tenant')

    const existing = await this.repo.findByProvider(tenantId, 'onepassword')

    let encryptedConfig = existing?.config ?? ''

    if (dto.serviceAccountToken) {
      await this.onePassword.validateToken(dto.serviceAccountToken)
      encryptedConfig = this.onePassword.encryptToken(dto.serviceAccountToken)
    }

    if (!encryptedConfig) {
      throw new Error('Token de serviço obrigatório na primeira configuração')
    }

    const row = await this.repo.upsert(tenantId, 'onepassword', dto.enabled, encryptedConfig)
    return toPublic(row)
  }

  async getGoogleConfig(tenantId: number): Promise<GoogleConfigPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'google', 'Integração Google não licenciada para este tenant')

    const row    = await this.repo.findByProvider(tenantId, 'google')
    const config = row ? (JSON.parse(row.config || '{}') as Record<string, unknown>) : null

    return {
      enabled:             row?.enabled             ?? false,
      clientId:            (config?.clientId        as string)  ?? null,
      adminEmail:          (config?.adminEmail       as string)  ?? null,
      domain:              (config?.domain           as string)  ?? null,
      syncIntervalMinutes: (config?.syncIntervalMinutes as number) ?? 60,
      autoProvision:       (config?.autoProvision    as boolean) ?? false,
      hasServiceAccount:   !!(config?.serviceAccountEncrypted),
      updatedAt:           row?.updatedAt            ?? null,
    }
  }

  async upsertGoogle(tenantId: number, dto: UpsertGoogleDto): Promise<GoogleConfigPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'google', 'Integração Google não licenciada para este tenant')

    const payload: {
      enabled: boolean
      clientId: string
      adminEmail?: string
      domain?: string
      syncIntervalMinutes?: number
      autoProvision?: boolean
      serviceAccountJson?: string
    } = {
      enabled: dto.enabled,
      clientId: dto.clientId,
    }

    if (dto.adminEmail) payload.adminEmail = dto.adminEmail
    if (dto.domain) payload.domain = dto.domain
    if (dto.syncIntervalMinutes !== undefined) payload.syncIntervalMinutes = dto.syncIntervalMinutes
    if (dto.autoProvision !== undefined) payload.autoProvision = dto.autoProvision
    if (dto.serviceAccountJson) payload.serviceAccountJson = dto.serviceAccountJson

    await this.google.upsertConfig(tenantId, payload)
    return this.getGoogleConfig(tenantId)
  }

  async syncGoogle(tenantId: number): Promise<{ synced: number; deactivated: number }> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'google', 'Integração Google não licenciada para este tenant')
    return this.google.syncDirectory(tenantId)
  }

  async getOpenAiConfig(tenantId: number): Promise<OpenAiConfigPublic> {
    const row = await this.repo.findByProvider(tenantId, 'openai')
    const config = parseJson<StoredOpenAiConfig>(row?.config, {})

    return {
      enabled: row?.enabled ?? false,
      hasApiKey: !!(config.apiKeyEncrypted && config.apiKeyIv),
      baseUrl: config.baseUrl ?? this.openai.normalizeBaseUrl(undefined),
      defaultModel: config.defaultModel ?? null,
      healthStatus: config.healthStatus ?? 'unknown',
      healthMessage: config.healthMessage ?? null,
      lastCheckedAt: config.lastCheckedAt ? new Date(config.lastCheckedAt) : null,
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async upsertOpenAi(tenantId: number, dto: UpsertOpenAiDto): Promise<OpenAiConfigPublic> {
    const licensed = await this.entitlements.isSessionAuditAiLicensed(tenantId)
    if (!licensed) {
      throw new Error('Licença de IA da auditoria não habilitada para este tenant')
    }

    const existing = await this.repo.findByProvider(tenantId, 'openai')
    const existingConfig = parseJson<StoredOpenAiConfig>(existing?.config, {})

    let apiKeyEncrypted = existingConfig.apiKeyEncrypted
    let apiKeyIv = existingConfig.apiKeyIv

    if (dto.apiKey) {
      const encrypted = this.openai.encryptApiKey(dto.apiKey)
      apiKeyEncrypted = encrypted.encrypted
      apiKeyIv = encrypted.iv
    }

    if (!apiKeyEncrypted || !apiKeyIv) {
      throw new Error('API key obrigatória na primeira configuração')
    }

    const config: StoredOpenAiConfig = {
      apiKeyEncrypted,
      apiKeyIv,
      baseUrl: this.openai.normalizeBaseUrl(dto.baseUrl),
      defaultModel: dto.defaultModel,
      healthStatus: existingConfig.healthStatus ?? 'unknown',
      healthMessage: existingConfig.healthMessage ?? null,
      lastCheckedAt: existingConfig.lastCheckedAt ?? null,
    }

    await this.repo.upsert(tenantId, 'openai', dto.enabled, JSON.stringify(config))
    return this.getOpenAiConfig(tenantId)
  }

  async testOpenAi(tenantId: number): Promise<OpenAiTestResult> {
    const licensed = await this.entitlements.isSessionAuditAiLicensed(tenantId)
    if (!licensed) {
      throw new Error('Licença de IA da auditoria não habilitada para este tenant')
    }

    const row = await this.repo.findByProvider(tenantId, 'openai')
    const config = parseJson<StoredOpenAiConfig>(row?.config, {})

    if (!config.apiKeyEncrypted || !config.apiKeyIv) {
      throw new Error('Integração OpenAI não configurada')
    }

    const apiKey = this.openai.decryptApiKey(config)
    const checkedAt = new Date()
    const testInput: {
      apiKey: string
      baseUrl?: string | null
      defaultModel?: string | null
    } = { apiKey }
    if (config.baseUrl !== undefined) testInput.baseUrl = config.baseUrl
    if (config.defaultModel !== undefined) testInput.defaultModel = config.defaultModel

    const result = await this.openai.testConnection(testInput)

    const nextConfig: StoredOpenAiConfig = {
      ...config,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      lastCheckedAt: checkedAt.toISOString(),
    }

    await this.repo.upsert(tenantId, 'openai', row?.enabled ?? false, JSON.stringify(nextConfig))

    return {
      ok: result.ok,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      checkedAt,
    }
  }

  async getJiraConfig(tenantId: number): Promise<JiraConfigPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'jira', 'Integração JIRA não licenciada para este tenant')

    const row = await this.repo.findByProvider(tenantId, 'jira')
    const config = parseJson<StoredJiraConfig>(row?.config, {})

    return {
      enabled: row?.enabled ?? false,
      hasApiToken: !!(config.apiTokenEncrypted && config.apiTokenIv),
      baseUrl: config.baseUrl ?? null,
      serviceAccountEmail: config.serviceAccountEmail ?? null,
      projectKeys: config.projectKeys ?? [],
      healthStatus: config.healthStatus ?? 'unknown',
      healthMessage: config.healthMessage ?? null,
      lastCheckedAt: config.lastCheckedAt ? new Date(config.lastCheckedAt) : null,
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async upsertJira(tenantId: number, dto: UpsertJiraDto): Promise<JiraConfigPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'jira', 'Integração JIRA não licenciada para este tenant')

    const existing = await this.repo.findByProvider(tenantId, 'jira')
    const existingConfig = parseJson<StoredJiraConfig>(existing?.config, {})

    let apiTokenEncrypted = existingConfig.apiTokenEncrypted
    let apiTokenIv = existingConfig.apiTokenIv

    if (dto.apiToken) {
      const encrypted = this.jira.encryptApiToken(dto.apiToken)
      apiTokenEncrypted = encrypted.encrypted
      apiTokenIv = encrypted.iv
    }

    if (!apiTokenEncrypted || !apiTokenIv) {
      throw new Error('API token obrigatório na primeira configuração')
    }

    const config: StoredJiraConfig = {
      apiTokenEncrypted,
      apiTokenIv,
      baseUrl: this.jira.normalizeBaseUrl(dto.baseUrl),
      serviceAccountEmail: dto.serviceAccountEmail,
      projectKeys: dto.projectKeys,
      healthStatus: existingConfig.healthStatus ?? 'unknown',
      healthMessage: existingConfig.healthMessage ?? null,
      lastCheckedAt: existingConfig.lastCheckedAt ?? null,
    }

    await this.repo.upsert(tenantId, 'jira', dto.enabled, JSON.stringify(config))
    return this.getJiraConfig(tenantId)
  }

  async testJira(tenantId: number): Promise<JiraTestResult> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'jira', 'Integração JIRA não licenciada para este tenant')

    const row = await this.repo.findByProvider(tenantId, 'jira')
    const config = parseJson<StoredJiraConfig>(row?.config, {})

    if (!config.apiTokenEncrypted || !config.apiTokenIv || !config.baseUrl || !config.serviceAccountEmail) {
      throw new Error('Integração JIRA não configurada')
    }

    const apiToken = this.jira.decryptApiToken(config)
    const checkedAt = new Date()
    const result = await this.jira.testConnection({
      apiToken,
      baseUrl: config.baseUrl,
      serviceAccountEmail: config.serviceAccountEmail,
    })

    const nextConfig: StoredJiraConfig = {
      ...config,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      lastCheckedAt: checkedAt.toISOString(),
    }

    await this.repo.upsert(tenantId, 'jira', row?.enabled ?? false, JSON.stringify(nextConfig))

    return {
      ok: result.ok,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      checkedAt,
    }
  }

  async getJiraTicket(tenantId: number, ticketKey: string): Promise<{
    key: string
    url: string | null
    summary: string
    status: string | null
    issueType: string | null
    projectKey: string | null
    projectName: string | null
    assigneeDisplayName: string | null
    labels: string[]
    updatedAt: Date | null
  }> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'jira', 'Integração JIRA não licenciada para este tenant')

    const row = await this.repo.findByProvider(tenantId, 'jira')
    const config = parseJson<StoredJiraConfig>(row?.config, {})

    if (!row?.enabled || !config.apiTokenEncrypted || !config.apiTokenIv || !config.baseUrl || !config.serviceAccountEmail) {
      throw new Error('Integração JIRA não configurada')
    }

    const normalizedKey = ticketKey.trim().toUpperCase()
    const keyPrefix = normalizedKey.split('-')[0] ?? normalizedKey
    if (config.projectKeys && config.projectKeys.length > 0 && !config.projectKeys.includes(keyPrefix)) {
      throw new Error(`Ticket fora dos projetos permitidos: ${normalizedKey}`)
    }

    const apiToken = this.jira.decryptApiToken(config)
    return this.jira.fetchTicket({
      apiToken,
      baseUrl: config.baseUrl,
      serviceAccountEmail: config.serviceAccountEmail,
      ticketKey: normalizedKey,
    })
  }
}
