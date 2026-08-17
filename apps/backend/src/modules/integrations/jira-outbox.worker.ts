import type { IntegrationRepository } from './integration.repository.js'
import type { JiraInteractionRepository } from './jira-interaction.repository.js'
import type { JiraIntegrationService, StoredJiraConfig } from './jira.service.js'
import { decrypt, encrypt } from '../../shared/crypto.js'
import { env } from '../../config/env.js'
import { metrics } from '../../shared/metrics.js'

export class JiraOutboxWorker {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(private readonly outbox: JiraInteractionRepository, private readonly integrations: IntegrationRepository, private readonly jira: JiraIntegrationService) {}

  start() { if (!this.timer) { this.timer = setInterval(() => void this.tick(), 15_000); void this.tick() } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  async tick() {
    if (this.running) return
    this.running = true
    try {
      for (const event of await this.outbox.listDue()) {
        try { await this.execute(event); await this.outbox.completeOutbox(event.id); metrics.inc('nodeaccess_jira_outbox_total', 'Jira outbox processing results', { action: event.action, result: 'success' }) }
        catch (error) { await this.outbox.retryOutbox(event.id, event.attempts + 1, error instanceof Error ? error.message : 'Jira outbox failure'); metrics.inc('nodeaccess_jira_outbox_total', 'Jira outbox processing results', { action: event.action, result: 'retry' }) }
      }
    } finally { this.running = false }
  }

  private async execute(event: { tenantId: number; action: string; payloadJson: unknown }) {
    const row = await this.integrations.findByProvider(event.tenantId, 'jira')
    if (!row?.enabled) throw new Error('Integração Jira desabilitada')
    const config = JSON.parse(row.config || '{}') as StoredJiraConfig
    const payload = event.payloadJson as { ticketKey: string; auditUrl?: string; transitionId?: string | null; hostId?: number; text?: string; reportJson?: string; fileName?: string }
    const oauth = config.authMode === 'oauth'
    const authorization = oauth ? `Bearer ${await this.oauthAccessToken(event.tenantId, row.enabled, config)}` : this.jira.buildBasicAuthorization(config)
    const apiBase = oauth ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(config.oauthCloudId!)}` : this.jira.normalizeBaseUrl(config.baseUrl)
    if (event.action === 'COMMENT_START') await this.jira.addComment({ apiBase, authorization, ticketKey: payload.ticketKey, text: `Atendimento NodeAccess iniciado para o host #${payload.hostId ?? 'desconhecido'}.` })
    else if (event.action === 'COMMENT_END') await this.jira.addComment({ apiBase, authorization, ticketKey: payload.ticketKey, text: `Atendimento NodeAccess encerrado. Auditoria: ${payload.auditUrl ?? 'indisponível'}` })
    else if (event.action === 'ATTACH_AUDIT' && payload.auditUrl) await this.jira.attachAuditLink({ apiBase, authorization, ticketKey: payload.ticketKey, auditUrl: payload.auditUrl })
    else if (event.action === 'TRANSITION' && payload.transitionId) await this.jira.transitionIssue({ apiBase, authorization, ticketKey: payload.ticketKey, transitionId: payload.transitionId })
    else if (event.action === 'COMMENT_DIAGNOSTIC_REPORT' && payload.text) await this.jira.addComment({ apiBase, authorization, ticketKey: payload.ticketKey, text: payload.text })
    else if (event.action === 'ATTACH_DIAGNOSTIC_REPORT' && payload.reportJson && payload.fileName) await this.jira.attachJson({ apiBase, authorization, ticketKey: payload.ticketKey, content: payload.reportJson, fileName: payload.fileName })
  }

  private async oauthAccessToken(tenantId: number, enabled: boolean, config: StoredJiraConfig) {
    if (config.oauthExpiresAt && new Date(config.oauthExpiresAt).getTime() > Date.now() + 60_000) return decrypt({ encrypted: config.oauthAccessTokenEncrypted!, iv: config.oauthAccessTokenIv! })
    if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET || !config.oauthRefreshTokenEncrypted || !config.oauthRefreshTokenIv) throw new Error('Refresh OAuth Jira indisponível')
    const refreshed = await this.jira.refreshOAuthToken({ clientId: env.JIRA_CLIENT_ID, clientSecret: env.JIRA_CLIENT_SECRET, refreshToken: decrypt({ encrypted: config.oauthRefreshTokenEncrypted, iv: config.oauthRefreshTokenIv }) })
    const access = encrypt(refreshed.accessToken)
    const refresh = refreshed.refreshToken ? encrypt(refreshed.refreshToken) : null
    Object.assign(config, { oauthAccessTokenEncrypted: access.encrypted, oauthAccessTokenIv: access.iv, oauthExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(), ...(refresh ? { oauthRefreshTokenEncrypted: refresh.encrypted, oauthRefreshTokenIv: refresh.iv } : {}) })
    await this.integrations.upsert(tenantId, 'jira', enabled, JSON.stringify(config))
    return refreshed.accessToken
  }
}
