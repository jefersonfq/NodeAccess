import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { SessionAuditAiRepository } from './session-audit-ai.repository.js'

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'

interface OpenAiConfigSnapshot {
  apiKeyEncrypted?: string
  apiKeyIv?: string
  defaultModel?: string
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy'
}

export class SessionAuditAiService {
  constructor(
    private readonly integrationRepository: IntegrationRepository,
    private readonly sessionAuditAiRepository: SessionAuditAiRepository,
  ) {}

  async schedulePostSessionSummary(sessionId: number, tenantId: number): Promise<void> {
    if (!env.FEATURE_SESSION_AUDIT_AI_SUMMARY) return

    try {
      const licensed = await this.integrationRepository.isSessionAuditAiLicensed(tenantId)
      if (!licensed) return

      const integration = await this.integrationRepository.findByProvider(tenantId, 'openai')
      if (!integration?.enabled || !integration.config) return

      const config = parseConfig(integration.config)
      if (!config.apiKeyEncrypted || !config.apiKeyIv) return

      const created = await this.sessionAuditAiRepository.enqueueAutoSummaryJob({
        sessionId,
        tenantId,
        provider: 'openai',
        model: config.defaultModel ?? 'gpt-5-mini',
        promptVersion: 'summary-v1',
      })

      if (created) {
        logger.info({
          sessionId,
          tenantId,
          provider: 'openai',
          model: config.defaultModel ?? 'gpt-5-mini',
          healthStatus: config.healthStatus ?? 'unknown',
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
      throw new Error('Resumo de auditoria por IA está desabilitado no ambiente')
    }

    const licensed = await this.integrationRepository.isSessionAuditAiLicensed(tenantId)
    if (!licensed) {
      throw new Error('Licença de IA da auditoria não habilitada para este tenant')
    }

    const integration = await this.integrationRepository.findByProvider(tenantId, 'openai')
    if (!integration?.enabled || !integration.config) {
      throw new Error('Integração OpenAI não configurada para este tenant')
    }

    const config = parseConfig(integration.config)
    if (!config.apiKeyEncrypted || !config.apiKeyIv) {
      throw new Error('Integração OpenAI sem API key válida')
    }

    await this.sessionAuditAiRepository.enqueueManualSummaryJob({
      sessionId,
      tenantId,
      requestedByUserId,
      provider: 'openai',
      model: config.defaultModel ?? 'gpt-5-mini',
      promptVersion: template,
    })
  }
}

function parseConfig(value: string): OpenAiConfigSnapshot {
  try {
    return JSON.parse(value) as OpenAiConfigSnapshot
  } catch {
    return {}
  }
}
