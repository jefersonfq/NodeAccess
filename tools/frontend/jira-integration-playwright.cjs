#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''

function token() {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '1', tenantId: 1, role: 'admin', email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.harness`
}

async function main() {
  const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL) : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = CDP_URL ? (browser.contexts()[0] || await browser.newContext()) : await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((value) => { try { localStorage.setItem('na_access_token', value); localStorage.setItem('na_refresh_token', 'harness') } catch {} }, token())
  await context.addInitScript(() => {
    class HarnessWebSocket {
      static OPEN = 1; static CLOSED = 3
      constructor(url) { this.url = String(url); this.readyState = 1; setTimeout(() => { this.onopen?.({}); if (this.url.includes('/ws/ssh/')) this.onmessage?.({ data: JSON.stringify({ type: 'connected', sessionId: 501, hostName: 'prod-01', connectionMethod: 'direct' }) }) }, 10) }
      send() {} close() { this.readyState = 3; this.onclose?.({ code: 1000 }) } addEventListener() {} removeEventListener() {}
    }
    window.WebSocket = HarnessWebSocket
    try { sessionStorage.setItem('na:pending-terminal-host', JSON.stringify({ id: 9, name: 'prod-01', ip: '10.0.0.9', port: 22, authType: 'PASSWORD', accessProtocol: 'ssh' })) } catch {}
  })
  const saves = []
  const authorizations = []
  const closes = []
  const jira = {
    enabled: true, hasApiToken: true, authMode: 'oauth', oauthConnected: true, oauthSiteName: 'Harness Jira', oauthScopes: ['read:jira-work', 'write:jira-work'],
    ticketRequirement: 'optional', ticketEnforcementMode: 'off', ticketUserIds: [], ticketGroupIds: [], ticketInventoryFolderIds: [],
    allowedIssueTypes: [], allowedStatuses: [], requiredLabels: [], requireAssignee: false, maxTicketAgeHours: null, publishStartComment: false, publishEndComment: false, attachAuditOnClose: false, transitionOnClose: false, closeTransitionId: null, breakGlassEnabled: false,
    capabilities: { read: true, comment: true, attachment: true, transition: true }, baseUrl: 'https://example.atlassian.net', serviceAccountEmail: null, projectKeys: ['OPS'], healthStatus: 'healthy', healthMessage: 'ok', lastCheckedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname
    let body = []
    if (path === '/api/v1/features') body = { integrationsLicensed: true, integrationProviders: { jira: true }, localAiLicensed: false }
    else if (path === '/api/v1/integrations/jira/session-policy') body = { enabled: true, required: true, ticketRequirement: 'required', breakGlassEnabled: true }
    else if (path === '/api/v1/integrations/jira/session-authorizations') { authorizations.push(req.postDataJSON()); body = { sessionGrant: 'signed-grant', interactionId: 'interaction-1', ticketKey: 'OPS-123', ticketSummary: 'Investigar produção', ticketStatus: 'In Progress', ticketUrl: 'https://example.atlassian.net/browse/OPS-123' } }
    else if (path === '/api/v1/integrations/jira/interactions/interaction-1/close') { closes.push(req.postDataJSON()); body = { ok: true, queuedActions: ['COMMENT_END', 'ATTACH_AUDIT'] } }
    else if (path === '/api/v1/host-links/options') body = { jitAccess: { enabled: false } }
    else if (path === '/api/v1/tenant-auth-policy') { const policy = { localLoginEnabled: true, ssoRequired: false, mfaRequired: true, jitProvisioningEnabled: false, automaticAccountLinkingEnabled: false, emailTenantDiscoveryEnabled: true, lockoutMaxAttempts: 5, lockoutDurationMinutes: 15, accessTokenMinutes: 15, refreshTokenDays: 7 }; body = { requested: policy, effective: policy, enforcementEnabled: true } }
    else if (path === '/api/v1/integrations/jira' && req.method() === 'PUT') { body = { ...jira, ...req.postDataJSON() }; saves.push(req.postDataJSON()) }
    else if (path === '/api/v1/integrations/jira') body = jira
    else if (path === '/api/v1/integrations') body = [{ provider: 'jira', enabled: true, hasToken: true, updatedAt: new Date().toISOString() }]
    else if (path === '/api/v1/users') body = { data: [{ id: 10, name: 'Operador', email: 'operator@example.test', role: 'user', active: true, groupIds: [] }], page: 1, limit: 1000, total: 1, totalPages: 1 }
    else if (path === '/api/v1/groups') body = [{ id: 20, name: 'NOC', description: null }]
    else if (path === '/api/v1/inventory') body = [{ id: 1, parentId: null, type: 'ROOT', hostId: null, name: 'Root', path: '/', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { id: 30, parentId: 1, type: 'FOLDER', hostId: null, name: 'Produção', path: '/30/', depth: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    else if (path.includes('/local-ai')) body = { enabled: false, documents: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  const page = await context.newPage(); const errors = []
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${FRONTEND}/admin/integrations`, { waitUntil: 'networkidle' })
  const card = page.getByTestId('jira-integration-card'); await card.waitFor()
  await card.locator('summary').first().click()
  await card.getByText('Quem deve informar ticket').waitFor()
  await card.getByText('Quem deve informar ticket').locator('..').locator('.n-select').click()
  await page.getByText('Usuários, grupos ou pastas selecionados', { exact: true }).click()
  await card.getByRole('button', { name: /^Salvar$|^Save$/ }).last().click()
  await page.locator('.n-message').getByText(/Selecione pelo menos um usuário/i).waitFor()
  if (saves.length) throw new Error('Escopo seletivo vazio foi enviado')
  await card.getByText('Grupos', { exact: true }).locator('..').locator('.n-select').click(); await page.keyboard.type('NOC'); await page.keyboard.press('Enter')
  await card.getByText('Comentar ao encerrar').click(); await card.getByText('Permitir break-glass').click()
  await card.getByRole('button', { name: /^Salvar$|^Save$/ }).last().click(); await page.waitForTimeout(200)
  if (saves.length !== 1 || saves[0].ticketEnforcementMode !== 'selected' || saves[0].ticketGroupIds[0] !== 20 || !saves[0].publishEndComment || !saves[0].breakGlassEnabled) throw new Error(`Payload Jira incompleto: ${JSON.stringify(saves)}; messages=${JSON.stringify(await page.locator('.n-message').allTextContents())}`)
  if (errors.length) throw new Error(`Erros de UI: ${errors.join(' | ')}`)
  await page.close()
  const terminal = await context.newPage(); await terminal.goto(`${FRONTEND}/terminal`, { waitUntil: 'domcontentloaded' })
  const ticketDialog = terminal.locator('[role="dialog"]').filter({ hasText: 'Informe o ticket do atendimento' }).last()
  await ticketDialog.waitFor(); await ticketDialog.locator('input[placeholder="OPS-123"]').fill('OPS-123'); await ticketDialog.getByRole('button', { name: 'Validar e conectar' }).click(); await ticketDialog.waitFor({ state: 'hidden' })
  const banner = terminal.getByTestId('jira-interaction-banner'); await banner.waitFor(); await banner.getByText('OPS-123').waitFor(); await banner.getByText('In Progress').waitFor()
  const closeInteraction = terminal.getByTestId('jira-close-interaction'); await closeInteraction.focus(); await terminal.keyboard.press('Enter')
  await terminal.getByRole('button', { name: 'Encerrar atendimento' }).last().click(); await terminal.getByText(/2 ação\(ões\) Jira/).waitFor()
  if (authorizations.length !== 1 || authorizations[0].ticketKey !== 'OPS-123' || closes.length !== 1) throw new Error('Fluxo terminal Jira incompleto')
  console.log(JSON.stringify({ ok: true, cdp: !!CDP_URL, saves: saves.length, authorizations: authorizations.length, closes: closes.length }))
  await browser.close()
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
