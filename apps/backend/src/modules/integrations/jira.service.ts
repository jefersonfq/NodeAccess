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
}
