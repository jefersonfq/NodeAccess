import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import { AppError } from '../../shared/errors.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { LocalAiIntegrationService } from '../integrations/local-ai.service.js'
import type { SessionAuditAiRepository } from './session-audit-ai.repository.js'
import { INTEGRATION_HEALTH_TTL_MS, resolveIntegrationReadiness } from '../integrations/integration-readiness.js'

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'

interface OpenAiConfigSnapshot {
  apiKeyEncrypted?: string
  apiKeyIv?: string
  defaultModel?: string
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy'
  healthMessage?: string | null
  lastCheckedAt?: string | null
}

type ResolvedSessionAuditAiProvider = {
  provider: 'openai' | 'ollama' | 'openai_compatible'
  model: string
  healthStatus: 'unknown' | 'healthy' | 'unhealthy'
}

type SessionAuditAiProviderPreference = 'automatic' | 'openai' | 'local_ai'

export class SessionAuditAiService {
  constructor(
    private readonly integrationRepository: IntegrationRepository,
    private readonly sessionAuditAiRepository: SessionAuditAiRepository,
    private readonly localAi: LocalAiIntegrationService,
  ) {}

  async schedulePostSessionSummary(sessionId: number, tenantId: number): Promise<void> {
    if (!env.FEATURE_SESSION_AUDIT_AI_SUMMARY) return
    if (!env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY) return

    try {
      const licensed = await this.integrationRepository.isSessionAuditAiLicensed(tenantId)
      if (!licensed) return

      const license = await this.integrationRepository.findLicenseSnapshot(tenantId)
      if (license?.featureEntitlements?.sessionAuditAiAutoSummary !== true) return

      const resolved = await this.resolveProvider(tenantId)
      if (!resolved) return

      const created = await this.sessionAuditAiRepository.enqueueAutoSummaryJob({
        sessionId,
        tenantId,
        provider: resolved.provider,
        model: resolved.model,
        promptVersion: 'summary-v1',
      })

      if (created) {
        logger.info({
          sessionId,
          tenantId,
          provider: resolved.provider,
          model: resolved.model,
          healthStatus: resolved.healthStatus,
        }, 'Session audit AI summary job enqueued')
      }
    } catch (err) {
      logger.warn({ err, sessionId, tenantId }, 'Session audit AI scheduling skipped after controlled failure')
    }
  }

  async scheduleManualSummary(
    sessionId: number,
    tenantId: number,
    requestedByUserId: number,
    template: SessionAuditAiPromptTemplate,
  ): Promise<void> {
    if (!env.FEATURE_SESSION_AUDIT_AI_SUMMARY) {
      throw new AppError('Resumo de auditoria por IA está desabilitado no ambiente', 409, 'SESSION_AUDIT_AI_SUMMARY_DISABLED')
    }

    const licensed = await this.integrationRepository.isSessionAuditAiLicensed(tenantId)
    if (!licensed) {
      throw new AppError('Licença de IA da auditoria não habilitada para este tenant', 409, 'SESSION_AUDIT_AI_LICENSE_DISABLED')
    }

    const resolved = await this.resolveProvider(tenantId)
    if (!resolved) {
      throw new AppError('Nenhum provider de IA da auditoria está habilitado e configurado para este tenant', 409, 'SESSION_AUDIT_AI_PROVIDER_UNAVAILABLE')
    }

    await this.sessionAuditAiRepository.enqueueManualSummaryJob({
      sessionId,
      tenantId,
      requestedByUserId,
      provider: resolved.provider,
      model: resolved.model,
      promptVersion: template,
    })
  }

  private async resolveProvider(tenantId: number): Promise<ResolvedSessionAuditAiProvider | null> {
    const license = await this.integrationRepository.findLicenseSnapshot(tenantId)
    const preference = normalizePreference(license?.sessionAuditAiProvider)

    if (preference === 'openai') {
      return this.resolveOpenAiProvider(tenantId)
    }

    if (preference === 'local_ai') {
      return this.resolveLocalAiProvider(tenantId)
    }

    return (await this.resolveOpenAiProvider(tenantId)) ?? (await this.resolveLocalAiProvider(tenantId))
  }

  private async resolveOpenAiProvider(tenantId: number): Promise<ResolvedSessionAuditAiProvider | null> {
    const openAiIntegration = await this.integrationRepository.findByProvider(tenantId, 'openai')
    if (openAiIntegration?.enabled && openAiIntegration.config) {
      const config = parseConfig(openAiIntegration.config)
      const operational = resolveIntegrationReadiness({ enabled: true, configured: !!(config.apiKeyEncrypted && config.apiKeyIv), healthStatus: config.healthStatus, healthMessage: config.healthMessage, lastCheckedAt: config.lastCheckedAt, ttlMs: INTEGRATION_HEALTH_TTL_MS.openai }).operational
      if (operational && config.apiKeyEncrypted && config.apiKeyIv) {
        return {
          provider: 'openai',
          model: config.defaultModel ?? 'gpt-5-mini',
          healthStatus: config.healthStatus ?? 'unknown',
        }
      }
    }

    return null
  }

  private async resolveLocalAiProvider(tenantId: number): Promise<ResolvedSessionAuditAiProvider | null> {
    const localAiIntegration = await this.integrationRepository.findByProvider(tenantId, 'local_ai')
    if (!localAiIntegration?.enabled || !localAiIntegration.config) {
      return null
    }

    const config = this.localAi.parseConfig(localAiIntegration.config)
    const provider = this.localAi.resolveSummaryProvider(config)
    if (!provider || !resolveIntegrationReadiness({ enabled: true, configured: true, healthStatus: config.healthStatus, healthMessage: config.healthMessage, lastCheckedAt: config.lastCheckedAt, ttlMs: INTEGRATION_HEALTH_TTL_MS.local_ai }).operational) {
      return null
    }

    return {
      provider,
      model: this.localAi.resolveSummaryModel(provider, config),
      healthStatus: config.healthStatus ?? 'unknown',
    }
  }
}

function parseConfig(value: string): OpenAiConfigSnapshot {
  try {
    return JSON.parse(value) as OpenAiConfigSnapshot
  } catch {
    return {}
  }
}

function normalizePreference(value: string | null | undefined): SessionAuditAiProviderPreference {
  if (value === 'openai' || value === 'local_ai') return value
  return 'automatic'
}
