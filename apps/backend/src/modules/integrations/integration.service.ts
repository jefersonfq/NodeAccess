import type {
  IntegrationPublic,
  UpsertOnePasswordDto,
  UpsertGoogleDto,
  UpsertLdapDto,
  UpsertOpenAiDto,
  UpsertLocalAiDto,
  UpsertJiraDto,
  GoogleConfigPublic,
  LdapConfigPublic,
  LdapTestResult,
  OpenAiConfigPublic,
  LocalAiConfigPublic,
  OpenAiTestResult,
  LocalAiTestResult,
  JiraConfigPublic,
  JiraTestResult,
} from '@nodeaccess/shared'
import jwt from 'jsonwebtoken'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { encrypt } from '../../shared/crypto.js'
import type { IntegrationRepository } from './integration.repository.js'
import type { OnePasswordService }    from './onepassword.service.js'
import type { GoogleService }         from '../auth/google.service.js'
import type { LdapIntegrationService, StoredLdapConfig } from './ldap.service.js'
import type { OpenAiIntegrationService, StoredOpenAiConfig } from './openai.service.js'
import { LOCAL_AI_DEFAULTS } from './local-ai.service.js'
import type { LocalAiIntegrationService, StoredLocalAiConfig } from './local-ai.service.js'
import type { JiraIntegrationService, StoredJiraConfig } from './jira.service.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import { env } from '../../config/env.js'
import type { LogRepository } from '../logs/log.repository.js'

const PROVIDERS = ['onepassword', 'google', 'ldap', 'openai', 'jira', 'local_ai'] as const

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

interface LocalAiProxyTokenPayload {
  tenantId: number
  stage: 'local_ai_proxy'
  path: '/' | '/api/tags' | '/api/version'
  iat?: number
  exp?: number
}

interface JiraOAuthStatePayload {
  tenantId: number
  userId: number
  nonce: string
  stage: 'jira_oauth'
  iat?: number
  exp?: number
}

interface IntegrationOpenLinkResult {
  url: string
  expiresIn: string
}

interface LocalAiActivityItem {
  id: number
  action: 'TEST_LOCAL_AI' | 'OPEN_LOCAL_AI_DIAGNOSTIC'
  adminName: string
  timestamp: string
  details: string | null
}

export class IntegrationService {
  constructor(
    private readonly repo:        IntegrationRepository,
    private readonly onePassword: OnePasswordService,
    private readonly google:      GoogleService,
    private readonly ldap:        LdapIntegrationService,
    private readonly openai:      OpenAiIntegrationService,
    private readonly localAi:     LocalAiIntegrationService,
    private readonly jira:        JiraIntegrationService,
    private readonly entitlements: LicenseEntitlementService,
    private readonly logRepository: LogRepository,
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
          : provider === 'local_ai'
            ? snapshot.featureEntitlements.localAi === true
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

  async getLdapConfig(tenantId: number): Promise<LdapConfigPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'ldap', 'Integração LDAP não licenciada para este tenant')

    const row = await this.repo.findByProvider(tenantId, 'ldap')
    const config = parseJson<StoredLdapConfig>(row?.config, {})

    return {
      enabled: row?.enabled ?? false,
      url: config.url ?? null,
      bindDn: config.bindDn ?? null,
      hasBindPassword: !!(config.bindPasswordEncrypted && config.bindPasswordIv),
      baseDn: config.baseDn ?? null,
      userSearchFilter: config.userSearchFilter ?? null,
      startTls: config.startTls ?? false,
      tlsRejectUnauthorized: config.tlsRejectUnauthorized ?? true,
      autoProvision: config.autoProvision ?? false,
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async upsertLdap(tenantId: number, dto: UpsertLdapDto): Promise<LdapConfigPublic> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'ldap', 'Integração LDAP não licenciada para este tenant')

    const existing = await this.repo.findByProvider(tenantId, 'ldap')
    const existingConfig = parseJson<StoredLdapConfig>(existing?.config, {})

    let bindPasswordEncrypted = existingConfig.bindPasswordEncrypted
    let bindPasswordIv = existingConfig.bindPasswordIv

    if (dto.bindPassword?.trim()) {
      const encrypted = this.ldap.encryptBindPassword(dto.bindPassword.trim())
      bindPasswordEncrypted = encrypted.encrypted
      bindPasswordIv = encrypted.iv
    }

    if (dto.bindDn?.trim() && (!bindPasswordEncrypted || !bindPasswordIv)) {
      throw new Error('Senha de bind LDAP obrigatória quando bindDn for configurado')
    }

    const config: StoredLdapConfig = {
      url: this.ldap.normalizeUrl(dto.url),
      baseDn: dto.baseDn.trim(),
      userSearchFilter: this.ldap.validateSearchFilter(dto.userSearchFilter),
      startTls: dto.startTls ?? false,
      tlsRejectUnauthorized: dto.tlsRejectUnauthorized ?? true,
      autoProvision: dto.autoProvision ?? false,
      ...(dto.bindDn?.trim() ? { bindDn: dto.bindDn.trim() } : {}),
      ...(bindPasswordEncrypted && bindPasswordIv ? { bindPasswordEncrypted, bindPasswordIv } : {}),
    }

    await this.repo.upsert(tenantId, 'ldap', dto.enabled, JSON.stringify(config))
    return this.getLdapConfig(tenantId)
  }

  async testLdap(tenantId: number, dto: UpsertLdapDto): Promise<LdapTestResult> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'ldap', 'Integração LDAP não licenciada para este tenant')

    const existing = await this.repo.findByProvider(tenantId, 'ldap')
    const existingConfig = parseJson<StoredLdapConfig>(existing?.config, {})

    let bindPassword = dto.bindPassword?.trim()
    if (!bindPassword && dto.bindDn?.trim() && existingConfig.bindPasswordEncrypted && existingConfig.bindPasswordIv) {
      bindPassword = this.ldap.decryptBindPassword(existingConfig)
    }

    const checkedAt = new Date()
    const testInput: {
      url: string
      bindDn?: string
      bindPassword?: string
      baseDn: string
      startTls: boolean
      tlsRejectUnauthorized: boolean
    } = {
      url: this.ldap.normalizeUrl(dto.url),
      baseDn: dto.baseDn.trim(),
      startTls: dto.startTls ?? false,
      tlsRejectUnauthorized: dto.tlsRejectUnauthorized ?? true,
    }
    if (dto.bindDn?.trim()) testInput.bindDn = dto.bindDn.trim()
    if (bindPassword) testInput.bindPassword = bindPassword

    const result = await this.ldap.testConnection(testInput)

    return {
      ok: result.ok,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      checkedAt,
    }
  }

  async getOpenAiConfig(tenantId: number): Promise<OpenAiConfigPublic> {
    const row = await this.repo.findByProvider(tenantId, 'openai')
    const config = parseJson<StoredOpenAiConfig>(row?.config, {})

    return {
      enabled: row?.enabled ?? false,
      hasApiKey: !!(config.apiKeyEncrypted && config.apiKeyIv),
      baseUrl: config.baseUrl ?? this.openai.normalizeBaseUrl(undefined),
      defaultModel: config.defaultModel ?? null,
      auditInstructions: config.auditInstructions ?? null,
      healthStatus: config.healthStatus ?? 'unknown',
      healthMessage: config.healthMessage ?? null,
      lastCheckedAt: config.lastCheckedAt ? new Date(config.lastCheckedAt) : null,
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async getLocalAiConfig(tenantId: number): Promise<LocalAiConfigPublic> {
    await this.entitlements.requireFeature(tenantId, 'localAi', 'Assistente local não licenciado para este tenant')

    const row = await this.repo.findByProvider(tenantId, 'local_ai')
    const config = parseJson<StoredLocalAiConfig>(row?.config, {})

    return {
      enabled: row?.enabled ?? false,
      mode: config.mode ?? LOCAL_AI_DEFAULTS.mode,
      routingPolicy: config.routingPolicy ?? LOCAL_AI_DEFAULTS.routingPolicy,
      localProvider: config.localProvider ?? LOCAL_AI_DEFAULTS.localProvider,
      localBaseUrl: config.localBaseUrl ?? LOCAL_AI_DEFAULTS.localBaseUrl,
      localModel: config.localModel ?? LOCAL_AI_DEFAULTS.localModel,
      networkProvider: config.networkProvider ?? LOCAL_AI_DEFAULTS.networkProvider,
      networkBaseUrl: config.networkBaseUrl ?? null,
      networkModel: config.networkModel ?? null,
      hasNetworkApiKey: !!(config.networkApiKeyEncrypted && config.networkApiKeyIv),
      auditInstructions: config.auditInstructions ?? null,
      assistantInstructions: config.assistantInstructions ?? null,
      healthStatus: config.healthStatus ?? 'unknown',
      healthMessage: config.healthMessage ?? null,
      lastCheckedAt: config.lastCheckedAt ? new Date(config.lastCheckedAt) : null,
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async upsertLocalAi(tenantId: number, dto: UpsertLocalAiDto): Promise<LocalAiConfigPublic> {
    await this.entitlements.requireFeature(tenantId, 'localAi', 'Assistente local não licenciado para este tenant')

    const existing = await this.repo.findByProvider(tenantId, 'local_ai')
    const existingConfig = parseJson<StoredLocalAiConfig>(existing?.config, {})

    const hasLocalConfig = !!(dto.localProvider?.trim() && dto.localBaseUrl?.trim() && dto.localModel?.trim())
    const hasNetworkConfig = !!(dto.networkProvider?.trim() && dto.networkBaseUrl?.trim() && dto.networkModel?.trim())

    if (dto.enabled) {
      if (dto.routingPolicy === 'local_only' && !hasLocalConfig) {
        throw new Error('Configuração local obrigatória quando a política estiver em modo local_only')
      }
      if (dto.routingPolicy === 'network_only' && !hasNetworkConfig) {
        throw new Error('Configuração de IA em rede obrigatória quando a política estiver em modo network_only')
      }
      if ((dto.routingPolicy === 'prefer_local' || dto.routingPolicy === 'prefer_network') && !hasLocalConfig && !hasNetworkConfig) {
        throw new Error('Configure pelo menos um provider de IA local ou de rede para habilitar o assistente')
      }
    }

    let networkApiKeyEncrypted = existingConfig.networkApiKeyEncrypted
    let networkApiKeyIv = existingConfig.networkApiKeyIv
    if (dto.networkApiKey?.trim()) {
      const encrypted = this.localAi.encryptApiKey(dto.networkApiKey.trim())
      networkApiKeyEncrypted = encrypted.encrypted
      networkApiKeyIv = encrypted.iv
    }

    const localBaseUrl = this.localAi.normalizeBaseUrl(dto.localBaseUrl)
    const networkBaseUrl = this.localAi.normalizeBaseUrl(dto.networkBaseUrl)

    const config: StoredLocalAiConfig = {
      mode: dto.mode,
      routingPolicy: dto.routingPolicy,
      localProvider: dto.localProvider?.trim() || LOCAL_AI_DEFAULTS.localProvider,
      localBaseUrl: localBaseUrl || LOCAL_AI_DEFAULTS.localBaseUrl,
      localModel: dto.localModel?.trim() || LOCAL_AI_DEFAULTS.localModel,
      networkProvider: dto.networkProvider?.trim() || LOCAL_AI_DEFAULTS.networkProvider,
      ...(dto.auditInstructions?.trim() ? { auditInstructions: dto.auditInstructions.trim() } : {}),
      ...(dto.assistantInstructions?.trim() ? { assistantInstructions: dto.assistantInstructions.trim() } : {}),
      ...(networkBaseUrl ? { networkBaseUrl } : {}),
      ...(dto.networkModel?.trim() ? { networkModel: dto.networkModel.trim() } : {}),
      ...(networkApiKeyEncrypted ? { networkApiKeyEncrypted } : {}),
      ...(networkApiKeyIv ? { networkApiKeyIv } : {}),
      healthStatus: existingConfig.healthStatus ?? 'unknown',
      healthMessage: existingConfig.healthMessage ?? null,
      lastCheckedAt: existingConfig.lastCheckedAt ?? null,
    }

    await this.repo.upsert(tenantId, 'local_ai', dto.enabled, JSON.stringify(config))
    return this.getLocalAiConfig(tenantId)
  }

  async testLocalAi(tenantId: number, adminId: number): Promise<LocalAiTestResult> {
    await this.entitlements.requireFeature(tenantId, 'localAi', 'Assistente local não licenciado para este tenant')

    const row = await this.repo.findByProvider(tenantId, 'local_ai')
    const config = parseJson<StoredLocalAiConfig>(row?.config, {})
    const checkedAt = new Date()
    const result = await this.localAi.testConnection(config)

    const nextConfig: StoredLocalAiConfig = {
      ...config,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      lastCheckedAt: checkedAt.toISOString(),
    }

    await this.repo.upsert(tenantId, 'local_ai', row?.enabled ?? false, JSON.stringify(nextConfig))

    await this.logRepository.logAdminEvent({
      adminId,
      action: 'TEST_LOCAL_AI',
      targetType: 'Integration',
      targetId: row?.id ?? 0,
      details: JSON.stringify({
        provider: 'local_ai',
        tenantId,
        healthStatus: result.healthStatus,
        healthMessage: result.healthMessage,
      }),
    }).catch(() => { /* best-effort */ })

    return {
      ok: result.ok,
      healthStatus: result.healthStatus,
      healthMessage: result.healthMessage,
      checkedAt,
    }
  }

  async createLocalAiProxyLink(tenantId: number, adminId: number, path: '/' | '/api/tags' | '/api/version' = '/'): Promise<IntegrationOpenLinkResult> {
    await this.entitlements.requireFeature(tenantId, 'localAi', 'Assistente local não licenciado para este tenant')
    const row = await this.repo.findByProvider(tenantId, 'local_ai')
    const config = parseJson<StoredLocalAiConfig>(row?.config, {})
    if (!config.localBaseUrl) {
      throw new Error('Base URL local do Assistente local não configurada')
    }

    const token = jwt.sign(
      {
        tenantId,
        stage: 'local_ai_proxy',
        path,
      } satisfies LocalAiProxyTokenPayload,
      env.JWT_SECRET,
      { expiresIn: '5m' },
    )

    const result = {
      url: `${env.APP_URL.replace(/\/$/, '')}/api/v1/integrations/local-ai/proxy?token=${encodeURIComponent(token)}`,
      expiresIn: '5m',
    }

    await this.logRepository.logAdminEvent({
      adminId,
      action: 'OPEN_LOCAL_AI_DIAGNOSTIC',
      targetType: 'Integration',
      targetId: row?.id ?? 0,
      details: JSON.stringify({
        provider: 'local_ai',
        tenantId,
        path,
      }),
    }).catch(() => { /* best-effort */ })

    return result
  }

  async proxyLocalAi(token: string): Promise<{ statusCode: number; contentType: string; body: string }> {
    let payload: LocalAiProxyTokenPayload
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as LocalAiProxyTokenPayload
      if (payload.stage !== 'local_ai_proxy') throw new Error('Invalid stage')
    } catch {
      throw new Error('Link de diagnóstico do Assistente local inválido ou expirado')
    }

    const row = await this.repo.findByProvider(payload.tenantId, 'local_ai')
    const config = parseJson<StoredLocalAiConfig>(row?.config, {})
    if (!config.localBaseUrl) {
      throw new Error('Base URL local do Assistente local não configurada')
    }

    return this.localAi.proxyLocalEndpoint(config.localBaseUrl, payload.path)
  }

  async getLocalAiRecentActivity(tenantId: number): Promise<LocalAiActivityItem[]> {
    await this.entitlements.requireFeature(tenantId, 'localAi', 'Assistente local não licenciado para este tenant')
    const row = await this.repo.findByProvider(tenantId, 'local_ai')
    if (!row) return []

    const logs = await this.logRepository.findRecentAdminEventsByTarget(
      tenantId,
      'Integration',
      row.id,
      ['TEST_LOCAL_AI', 'OPEN_LOCAL_AI_DIAGNOSTIC'],
      10,
    )

    return logs.map((item) => ({
      id: item.id,
      action: item.action as LocalAiActivityItem['action'],
      adminName: item.admin.name,
      timestamp: item.timestamp.toISOString(),
      details: item.details ?? null,
    }))
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
      ...(dto.auditInstructions?.trim() ? { auditInstructions: dto.auditInstructions.trim() } : {}),
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
      authMode: config.authMode ?? (config.apiTokenEncrypted ? 'api_token' : null),
      oauthConnected: !!(config.oauthAccessTokenEncrypted && config.oauthAccessTokenIv && config.oauthCloudId),
      oauthSiteName: config.oauthSiteName ?? null,
      oauthScopes: config.oauthScope?.split(/\s+/).filter(Boolean) ?? [],
      ticketRequirement: config.ticketRequirement ?? 'optional',
      baseUrl: config.baseUrl ?? null,
      serviceAccountEmail: config.serviceAccountEmail ?? null,
      projectKeys: config.projectKeys ?? [],
      healthStatus: config.healthStatus ?? 'unknown',
      healthMessage: config.healthMessage ?? null,
      lastCheckedAt: config.lastCheckedAt ? new Date(config.lastCheckedAt) : null,
      updatedAt: row?.updatedAt ?? null,
    }
  }

  async beginJiraOAuth(tenantId: number, userId: number): Promise<{ authorizationUrl: string; expiresInSeconds: number }> {
    await this.entitlements.requireIntegrationProvider(tenantId, 'jira', 'Integração JIRA não licenciada para este tenant')
    if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET || !env.JIRA_OAUTH_REDIRECT_URI || !env.JIRA_BASE_URL) {
      throw new Error('OAuth do Jira não configurado na instalação')
    }
    const nonce = randomBytes(24).toString('base64url')
    const expiresInSeconds = 600
    const state = jwt.sign({ tenantId, userId, nonce, stage: 'jira_oauth' } satisfies JiraOAuthStatePayload, env.JWT_SECRET, { expiresIn: expiresInSeconds })
    const existing = await this.repo.findByProvider(tenantId, 'jira')
    const config = parseJson<StoredJiraConfig>(existing?.config, {})
    const nextConfig: StoredJiraConfig = {
      ...config,
      pendingOAuthStateHash: createHash('sha256').update(state).digest('hex'),
      pendingOAuthExpiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
    }
    await this.repo.upsert(tenantId, 'jira', existing?.enabled ?? false, JSON.stringify(nextConfig))
    return {
      authorizationUrl: this.jira.buildOAuthAuthorizationUrl({ clientId: env.JIRA_CLIENT_ID, redirectUri: env.JIRA_OAUTH_REDIRECT_URI, state }),
      expiresInSeconds,
    }
  }

  async completeJiraOAuth(code: string, state: string): Promise<{ ok: true; siteName: string; scopes: string[] }> {
    if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET || !env.JIRA_OAUTH_REDIRECT_URI || !env.JIRA_BASE_URL) {
      throw new Error('OAuth do Jira não configurado na instalação')
    }
    let payload: JiraOAuthStatePayload
    try {
      payload = jwt.verify(state, env.JWT_SECRET) as JiraOAuthStatePayload
    } catch {
      throw new Error('State OAuth do Jira inválido ou expirado')
    }
    if (payload.stage !== 'jira_oauth' || !Number.isInteger(payload.tenantId) || !payload.nonce) throw new Error('State OAuth do Jira inválido')
    const row = await this.repo.findByProvider(payload.tenantId, 'jira')
    const config = parseJson<StoredJiraConfig>(row?.config, {})
    const receivedHash = createHash('sha256').update(state).digest()
    const expectedHash = config.pendingOAuthStateHash && /^[0-9a-f]{64}$/i.test(config.pendingOAuthStateHash)
      ? Buffer.from(config.pendingOAuthStateHash, 'hex')
      : Buffer.alloc(0)
    const pendingValid = expectedHash.length === receivedHash.length
      && timingSafeEqual(receivedHash, expectedHash)
      && !!config.pendingOAuthExpiresAt
      && new Date(config.pendingOAuthExpiresAt).getTime() > Date.now()
    if (!pendingValid) throw new Error('State OAuth do Jira já utilizado ou inválido')

    // Invalida antes da chamada externa para impedir replay concorrente.
    const { pendingOAuthStateHash: _hash, pendingOAuthExpiresAt: _expires, ...withoutPending } = config
    await this.repo.upsert(payload.tenantId, 'jira', row?.enabled ?? false, JSON.stringify(withoutPending))

    const tokens = await this.jira.exchangeOAuthCode({
      clientId: env.JIRA_CLIENT_ID,
      clientSecret: env.JIRA_CLIENT_SECRET,
      code,
      redirectUri: env.JIRA_OAUTH_REDIRECT_URI,
    })
    const resources = await this.jira.fetchAccessibleResources(tokens.accessToken)
    const configuredHost = new URL(env.JIRA_BASE_URL).host.toLowerCase()
    const resource = resources.find((item) => new URL(item.url).host.toLowerCase() === configuredHost)
    if (!resource) throw new Error('Site Jira configurado não foi autorizado')
    const access = encrypt(tokens.accessToken)
    const refresh = tokens.refreshToken ? encrypt(tokens.refreshToken) : null
    const nextConfig: StoredJiraConfig = {
      ...withoutPending,
      authMode: 'oauth',
      baseUrl: this.jira.normalizeBaseUrl(env.JIRA_BASE_URL),
      oauthAccessTokenEncrypted: access.encrypted,
      oauthAccessTokenIv: access.iv,
      ...(refresh ? { oauthRefreshTokenEncrypted: refresh.encrypted, oauthRefreshTokenIv: refresh.iv } : {}),
      oauthExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      oauthScope: tokens.scope,
      oauthCloudId: resource.id,
      oauthSiteUrl: resource.url,
      oauthSiteName: resource.name,
      healthStatus: 'unknown',
      healthMessage: 'Autorização OAuth concluída; execute o teste read-only',
    }
    await this.repo.upsert(payload.tenantId, 'jira', row?.enabled ?? false, JSON.stringify(nextConfig))
    return { ok: true, siteName: resource.name, scopes: tokens.scope.split(/\s+/).filter(Boolean) }
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

    const authMode = dto.apiToken ? 'api_token' : existingConfig.authMode ?? 'api_token'
    if (authMode === 'api_token' && (!apiTokenEncrypted || !apiTokenIv || !dto.serviceAccountEmail)) {
      throw new Error('API token obrigatório na primeira configuração')
    }

    const config: StoredJiraConfig = {
      ...existingConfig,
      authMode,
      ...(apiTokenEncrypted && apiTokenIv ? { apiTokenEncrypted, apiTokenIv } : {}),
      baseUrl: this.jira.normalizeBaseUrl(dto.baseUrl),
      ...(dto.serviceAccountEmail ? { serviceAccountEmail: dto.serviceAccountEmail } : {}),
      projectKeys: dto.projectKeys,
      ticketRequirement: dto.ticketRequirement,
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

    const checkedAt = new Date()
    const result = config.authMode === 'oauth'
      ? await this.testJiraOAuthConfig(config)
      : await this.testJiraApiTokenConfig(config)

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

  private async testJiraOAuthConfig(config: StoredJiraConfig) {
    if (!config.oauthAccessTokenEncrypted || !config.oauthAccessTokenIv || !config.oauthCloudId) {
      throw new Error('Autorização OAuth do Jira não configurada')
    }
    const accessToken = this.jira.decryptOAuthAccessToken(config)
    return this.jira.testOAuthConnection({ accessToken, cloudId: config.oauthCloudId })
  }

  private async testJiraApiTokenConfig(config: StoredJiraConfig) {
    if (!config.apiTokenEncrypted || !config.apiTokenIv || !config.baseUrl || !config.serviceAccountEmail) {
      throw new Error('Integração JIRA não configurada')
    }
    return this.jira.testConnection({
      apiToken: this.jira.decryptApiToken(config),
      baseUrl: config.baseUrl,
      serviceAccountEmail: config.serviceAccountEmail,
    })
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

    if (!row?.enabled) {
      throw new Error('Integração JIRA não configurada')
    }

    const normalizedKey = ticketKey.trim().toUpperCase()
    const keyPrefix = normalizedKey.split('-')[0] ?? normalizedKey
    if (config.projectKeys && config.projectKeys.length > 0 && !config.projectKeys.includes(keyPrefix)) {
      throw new Error(`Ticket fora dos projetos permitidos: ${normalizedKey}`)
    }

    if (config.authMode === 'oauth') {
      if (!config.oauthCloudId || !config.oauthSiteUrl) throw new Error('Autorização OAuth do Jira não configurada')
      return this.jira.fetchOAuthTicket({
        accessToken: this.jira.decryptOAuthAccessToken(config),
        cloudId: config.oauthCloudId,
        siteUrl: config.oauthSiteUrl,
        ticketKey: normalizedKey,
      })
    }
    if (!config.apiTokenEncrypted || !config.apiTokenIv || !config.baseUrl || !config.serviceAccountEmail) throw new Error('Integração JIRA não configurada')
    return this.jira.fetchTicket({ apiToken: this.jira.decryptApiToken(config), baseUrl: config.baseUrl, serviceAccountEmail: config.serviceAccountEmail, ticketKey: normalizedKey })
  }

  async getJiraSessionPolicy(tenantId: number): Promise<{ ticketRequirement: 'optional' | 'required'; enabled: boolean }> {
    const row = await this.repo.findByProvider(tenantId, 'jira')
    const config = parseJson<StoredJiraConfig>(row?.config, {})
    return { ticketRequirement: config.ticketRequirement ?? 'optional', enabled: row?.enabled ?? false }
  }

  async authorizeJiraSession(tenantId: number, userId: number, hostId: number, ticketKey?: string, interactionId?: string) {
    const policy = await this.getJiraSessionPolicy(tenantId)
    const normalizedTicket = ticketKey?.trim().toUpperCase() || null
    if (policy.enabled && policy.ticketRequirement === 'required' && !normalizedTicket) throw new Error('Ticket Jira obrigatório para iniciar o atendimento')
    if (normalizedTicket) await this.getJiraTicket(tenantId, normalizedTicket)
    const resolvedInteractionId = interactionId?.trim() || randomBytes(18).toString('base64url')
    const sessionGrant = jwt.sign({ stage: 'jira_session_grant', tenantId, userId, hostId, ticketKey: normalizedTicket, interactionId: resolvedInteractionId }, env.JWT_SECRET, { expiresIn: '12h' })
    return { sessionGrant, interactionId: resolvedInteractionId, ticketKey: normalizedTicket }
  }
}
