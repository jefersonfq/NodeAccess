import { encrypt, decrypt } from '../../shared/crypto.js'

export interface StoredJiraConfig {
  apiTokenEncrypted?: string
  apiTokenIv?: string
  baseUrl?: string
  serviceAccountEmail?: string
  projectKeys?: string[]
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy'
  healthMessage?: string | null
  lastCheckedAt?: string | null
  authMode?: 'api_token' | 'oauth'
  oauthAccessTokenEncrypted?: string
  oauthAccessTokenIv?: string
  oauthRefreshTokenEncrypted?: string
  oauthRefreshTokenIv?: string
  oauthExpiresAt?: string
  oauthScope?: string
  oauthCloudId?: string
  oauthSiteUrl?: string
  oauthSiteName?: string
  pendingOAuthStateHash?: string
  pendingOAuthExpiresAt?: string
  ticketRequirement?: 'optional' | 'required'
  ticketEnforcementMode?: 'off' | 'tenant' | 'selected'
  ticketUserIds?: number[]
  ticketGroupIds?: number[]
  ticketInventoryFolderIds?: number[]
  allowedIssueTypes?: string[]
  allowedStatuses?: string[]
  requiredLabels?: string[]
  requireAssignee?: boolean
  maxTicketAgeHours?: number | null
  publishStartComment?: boolean
  publishEndComment?: boolean
  attachAuditOnClose?: boolean
  transitionOnClose?: boolean
  closeTransitionId?: string
  breakGlassEnabled?: boolean
}

export interface JiraOAuthTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
  scope: string
}

export interface JiraAccessibleResource {
  id: string
  url: string
  name: string
  scopes: string[]
}

export class JiraIntegrationService {
  normalizeBaseUrl(value?: string | null): string {
    if (!value) return ''
    return value.replace(/\/+$/, '')
  }

  encryptApiToken(apiToken: string): { encrypted: string; iv: string } {
    return encrypt(apiToken)
  }

  decryptApiToken(config: StoredJiraConfig): string {
    if (!config.apiTokenEncrypted || !config.apiTokenIv) {
      throw new Error('API token da integração JIRA não configurado')
    }
    return decrypt({ encrypted: config.apiTokenEncrypted, iv: config.apiTokenIv })
  }

  decryptOAuthAccessToken(config: StoredJiraConfig): string {
    if (!config.oauthAccessTokenEncrypted || !config.oauthAccessTokenIv) {
      throw new Error('Token OAuth da integração Jira não configurado')
    }
    return decrypt({ encrypted: config.oauthAccessTokenEncrypted, iv: config.oauthAccessTokenIv })
  }

  decryptOAuthRefreshToken(config: StoredJiraConfig): string {
    if (!config.oauthRefreshTokenEncrypted || !config.oauthRefreshTokenIv) throw new Error('Refresh token OAuth do Jira não configurado')
    return decrypt({ encrypted: config.oauthRefreshTokenEncrypted, iv: config.oauthRefreshTokenIv })
  }

  capabilities(config: StoredJiraConfig) {
    if (config.authMode === 'api_token') return { read: true, comment: true, attachment: true, transition: true }
    const scopes = new Set(config.oauthScope?.split(/\s+/).filter(Boolean) ?? [])
    const classicWrite = scopes.has('write:jira-work')
    return {
      read: scopes.has('read:jira-work') || scopes.has('read:issue:jira'),
      comment: classicWrite || scopes.has('write:comment:jira'),
      attachment: classicWrite || scopes.has('write:attachment:jira'),
      transition: classicWrite || scopes.has('write:issue:jira'),
    }
  }

  buildBasicAuthorization(config: StoredJiraConfig): string {
    if (!config.serviceAccountEmail) throw new Error('Conta de serviço Jira não configurada')
    return `Basic ${Buffer.from(`${config.serviceAccountEmail}:${this.decryptApiToken(config)}`).toString('base64')}`
  }

  async addComment(input: { apiBase: string; authorization: string; ticketKey: string; text: string }) {
    const response = await fetch(`${input.apiBase}/rest/api/3/issue/${encodeURIComponent(input.ticketKey)}/comment`, {
      method: 'POST', headers: { Authorization: input.authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: input.text }] }] } }),
    })
    if (!response.ok) throw new Error(`Jira comment HTTP ${response.status}`)
  }

  async attachAuditLink(input: { apiBase: string; authorization: string; ticketKey: string; auditUrl: string }) {
    const form = new FormData()
    form.append('file', new Blob([`NodeAccess audit\n${input.auditUrl}\n`], { type: 'text/plain' }), 'nodeaccess-audit-link.txt')
    const response = await fetch(`${input.apiBase}/rest/api/3/issue/${encodeURIComponent(input.ticketKey)}/attachments`, {
      method: 'POST', headers: { Authorization: input.authorization, Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }, body: form,
    })
    if (!response.ok) throw new Error(`Jira attachment HTTP ${response.status}`)
  }

  async transitionIssue(input: { apiBase: string; authorization: string; ticketKey: string; transitionId: string }) {
    const response = await fetch(`${input.apiBase}/rest/api/3/issue/${encodeURIComponent(input.ticketKey)}/transitions`, {
      method: 'POST', headers: { Authorization: input.authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: input.transitionId } }),
    })
    if (!response.ok) throw new Error(`Jira transition HTTP ${response.status}`)
  }

  buildOAuthAuthorizationUrl(input: {
    clientId: string
    redirectUri: string
    state: string
    scopes?: string[]
  }): string {
    const url = new URL('https://auth.atlassian.com/authorize')
    url.search = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: input.clientId,
      scope: (input.scopes ?? ['offline_access', 'read:jira-work', 'read:jira-user']).join(' '),
      redirect_uri: input.redirectUri,
      state: input.state,
      response_type: 'code',
      prompt: 'consent',
    }).toString()
    return url.toString()
  }

  async exchangeOAuthCode(input: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
  }): Promise<JiraOAuthTokenSet> {
    return this.requestOAuthToken({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    })
  }

  async refreshOAuthToken(input: {
    clientId: string
    clientSecret: string
    refreshToken: string
  }): Promise<JiraOAuthTokenSet> {
    return this.requestOAuthToken({
      grant_type: 'refresh_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    })
  }

  async fetchAccessibleResources(accessToken: string): Promise<JiraAccessibleResource[]> {
    const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Jira OAuth accessible resources HTTP ${response.status}`)
    const resources = await response.json() as Array<{ id?: string; url?: string; name?: string; scopes?: string[] }>
    return resources
      .filter((resource): resource is { id: string; url: string; name?: string; scopes?: string[] } => !!resource.id && !!resource.url)
      .map((resource) => ({ id: resource.id, url: resource.url, name: resource.name ?? resource.url, scopes: resource.scopes ?? [] }))
  }

  async testOAuthConnection(input: { accessToken: string; cloudId: string }): Promise<{
    ok: boolean
    healthStatus: 'healthy' | 'unhealthy'
    healthMessage: string | null
  }> {
    const response = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(input.cloudId)}/rest/api/3/myself`, {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      return { ok: false, healthStatus: 'unhealthy', healthMessage: `Jira OAuth HTTP ${response.status}` }
    }
    const data = await response.json() as { displayName?: string; accountId?: string }
    return {
      ok: true,
      healthStatus: 'healthy',
      healthMessage: data.displayName ? `Conectado como ${data.displayName}` : (data.accountId || 'Conexão OAuth com Jira validada'),
    }
  }

  private async requestOAuthToken(body: Record<string, string>): Promise<JiraOAuthTokenSet> {
    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`Jira OAuth token HTTP ${response.status}`)
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
    if (!data.access_token || !data.expires_in) throw new Error('Resposta OAuth do Jira incompleta')
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresIn: data.expires_in,
      scope: data.scope ?? '',
    }
  }

  async testConnection(input: {
    apiToken: string
    baseUrl: string
    serviceAccountEmail: string
  }): Promise<{ ok: boolean; healthStatus: 'healthy' | 'unhealthy'; healthMessage: string | null }> {
    const baseUrl = this.normalizeBaseUrl(input.baseUrl)
    const auth = Buffer.from(`${input.serviceAccountEmail}:${input.apiToken}`).toString('base64')

    const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      return {
        ok: false,
        healthStatus: 'unhealthy',
        healthMessage: `HTTP ${response.status}: ${body.slice(0, 200)}`,
      }
    }

    const data = await response.json() as { displayName?: string; emailAddress?: string; accountId?: string }
    return {
      ok: true,
      healthStatus: 'healthy',
      healthMessage: data.displayName
        ? `Conectado como ${data.displayName}`
        : (data.emailAddress || data.accountId || 'Conexão com JIRA validada'),
    }
  }

  async fetchTicket(input: {
    apiToken: string
    baseUrl: string
    serviceAccountEmail: string
    ticketKey: string
  }): Promise<{
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
    const baseUrl = this.normalizeBaseUrl(input.baseUrl)
    const auth = Buffer.from(`${input.serviceAccountEmail}:${input.apiToken}`).toString('base64')

    const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(input.ticketKey)}?fields=summary,status,issuetype,project,assignee,labels,updated`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`JIRA ticket HTTP ${response.status}: ${body.slice(0, 200)}`)
    }

    const data = await response.json() as {
      key?: string
      fields?: {
        summary?: string
        updated?: string
        labels?: string[]
        status?: { name?: string }
        issuetype?: { name?: string }
        project?: { key?: string; name?: string }
        assignee?: { displayName?: string }
      }
    }

    return {
      key: data.key ?? input.ticketKey,
      url: data.key ? `${baseUrl}/browse/${data.key}` : null,
      summary: data.fields?.summary ?? '',
      status: data.fields?.status?.name ?? null,
      issueType: data.fields?.issuetype?.name ?? null,
      projectKey: data.fields?.project?.key ?? null,
      projectName: data.fields?.project?.name ?? null,
      assigneeDisplayName: data.fields?.assignee?.displayName ?? null,
      labels: data.fields?.labels ?? [],
      updatedAt: data.fields?.updated ? new Date(data.fields.updated) : null,
    }
  }

  async fetchOAuthTicket(input: { accessToken: string; cloudId: string; siteUrl: string; ticketKey: string }) {
    const response = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(input.cloudId)}/rest/api/3/issue/${encodeURIComponent(input.ticketKey)}?fields=summary,status,issuetype,project,assignee,labels,updated`, {
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Jira OAuth ticket HTTP ${response.status}`)
    const data = await response.json() as {
      key?: string
      fields?: { summary?: string; updated?: string; labels?: string[]; status?: { name?: string }; issuetype?: { name?: string }; project?: { key?: string; name?: string }; assignee?: { displayName?: string } }
    }
    return this.toTicketResult(data, input.ticketKey, this.normalizeBaseUrl(input.siteUrl))
  }

  private toTicketResult(data: {
    key?: string
    fields?: { summary?: string; updated?: string; labels?: string[]; status?: { name?: string }; issuetype?: { name?: string }; project?: { key?: string; name?: string }; assignee?: { displayName?: string } }
  }, fallbackKey: string, baseUrl: string) {
    return {
      key: data.key ?? fallbackKey,
      url: data.key ? `${baseUrl}/browse/${data.key}` : null,
      summary: data.fields?.summary ?? '',
      status: data.fields?.status?.name ?? null,
      issueType: data.fields?.issuetype?.name ?? null,
      projectKey: data.fields?.project?.key ?? null,
      projectName: data.fields?.project?.name ?? null,
      assigneeDisplayName: data.fields?.assignee?.displayName ?? null,
      labels: data.fields?.labels ?? [],
      updatedAt: data.fields?.updated ? new Date(data.fields.updated) : null,
    }
  }
}
