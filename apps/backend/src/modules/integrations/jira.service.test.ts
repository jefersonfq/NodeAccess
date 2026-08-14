import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters'
process.env.PEM_ENCRYPTION_KEY ??= '1'.repeat(64)

const { JiraIntegrationService } = await import('./jira.service.js')

describe('JiraIntegrationService OAuth 2.0', () => {
  const service = new JiraIntegrationService()

  afterEach(() => vi.unstubAllGlobals())

  it('builds a read-only 3LO authorization URL with offline access and state', () => {
    const result = new URL(service.buildOAuthAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://nodeaccess.example.test/integrations/jira/oauth/callback',
      state: 'opaque-state',
    }))
    expect(result.origin).toBe('https://auth.atlassian.com')
    expect(result.searchParams.get('client_id')).toBe('client-id')
    expect(result.searchParams.get('state')).toBe('opaque-state')
    expect(result.searchParams.get('scope')).toContain('offline_access')
    expect(result.searchParams.get('scope')).toContain('read:jira-work')
    expect(result.searchParams.get('scope')).not.toContain('write:')
  })

  it('exchanges an authorization code without exposing secrets in errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, scope: 'read:jira-work',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(service.exchangeOAuthCode({ clientId: 'id', clientSecret: 'secret', code: 'code', redirectUri: 'https://callback.test' })).resolves.toEqual({
      accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresIn: 3600, scope: 'read:jira-work',
    })
    expect(fetchMock).toHaveBeenCalledWith('https://auth.atlassian.com/oauth/token', expect.objectContaining({ method: 'POST' }))
  })

  it('discovers accessible Jira sites and validates the selected cloud id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'cloud-1', url: 'https://site.atlassian.net', name: 'Site', scopes: ['read:jira-work'] }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ displayName: 'Read Only User' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(service.fetchAccessibleResources('access-secret')).resolves.toHaveLength(1)
    await expect(service.testOAuthConnection({ accessToken: 'access-secret', cloudId: 'cloud-1' })).resolves.toEqual({
      ok: true, healthStatus: 'healthy', healthMessage: 'Conectado como Read Only User',
    })
  })

  it('returns sanitized provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('token=should-not-leak', { status: 401 })))
    await expect(service.exchangeOAuthCode({ clientId: 'id', clientSecret: 'secret', code: 'code', redirectUri: 'https://callback.test' }))
      .rejects.toThrow('Jira OAuth token HTTP 401')
  })

  it('derives write capabilities only from effective scopes', () => {
    expect(service.capabilities({ authMode: 'oauth', oauthScope: 'read:jira-work' })).toEqual({ read: true, comment: false, attachment: false, transition: false })
    expect(service.capabilities({ authMode: 'oauth', oauthScope: 'read:jira-work write:jira-work' })).toEqual({ read: true, comment: true, attachment: true, transition: true })
  })

  it('writes comments using Atlassian document format without leaking authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await service.addComment({ apiBase: 'https://api.atlassian.test/ex/jira/cloud', authorization: 'Bearer secret', ticketKey: 'OPS-1', text: 'Audit link' })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init.body)).body.type).toBe('doc')
    expect(fetchMock.mock.calls[0][0]).not.toContain('secret')
  })
})
