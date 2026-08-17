#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''

function token(isPlatformAdmin) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '11', tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', isPlatformAdmin, stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const license = {
  maxUsers: 25, maxHosts: 20, activeUsers: 4, registeredHosts: 3, hasKey: true,
  multiConnect: false, sessionAuditEnabled: true, sessionAuditAiEnabled: false,
  sessionAuditAiProvider: 'automatic', sessionAuditAiAutoSummaryEnabled: false,
  featureEntitlements: { integrations: true, agents: true, secrets: false, snippets: true, portForwarding: false, feedback: false, localAi: false, mcp: false, aiSshActions: false, ha: false },
  integrationEntitlements: { jira: true, google: false, ldap: false, onepassword: false, oidc: true, scim: false },
}
const tenantSettings = {
  tenant: { id: 7, name: 'Acme', slug: 'acme' }, license,
  sessionLimits: { activeSessions: 1, maxPerUser: 3, maxPerTenant: 30 },
  passwordPolicy: { minLength: 12, regex: '.{12,}', description: 'Doze caracteres' },
  tenantSettings: { totpIssuer: 'Acme', hostsDefaultView: 'home' },
  jitAccess: { enabled: true, expiryMinutes: [5, 10], maxExpiryMinutes: 30, pinRequired: false },
  sharedSessions: { expiryMinutes: [5, 10], maxExpiryMinutes: 30 },
  sftpPolicy: { blockOnModePreservationFailure: false, blockOnOwnershipPreservationFailure: false, blockOnTimestampPreservationFailure: false, diffMaxBytes: 1048576, diffMaxLines: 200 },
}
const tenant = { id: 12, name: 'Cliente Alfa', slug: 'cliente-alfa', active: true, maxUsers: 25, activeUsers: 4, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }

async function newContext(browser, isPlatformAdmin, state) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(({ authToken }) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'harness')
  }, { authToken: token(isPlatformAdmin) })
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = []
    if (path === '/api/v1/settings') body = tenantSettings
    else if (path === '/api/v1/settings/platform') body = { features: { sessionAudit: true, sessionAuditAiSummary: true, sessionAuditAiAutoSummary: false, localAi: false, nativeSshGateway: true, mcp: true } }
    else if (path === '/api/v1/platform/tenants') body = [tenant]
    else if (path === '/api/v1/platform/tenants/dashboard') body = { totals: { tenants: 1, activeTenants: 1, activeUsers: 4, hosts: 3, resources: 3, loginsLast7Days: 2, sessionsLast7Days: 1 }, dailyActivity: [], topTenantsByActivity: [], tenantUsage: [] }
    else if (path === '/api/v1/settings/platform/tenants/12/license' && request.method() === 'PATCH') {
      state.savedPayloads.push(request.postDataJSON())
      Object.assign(state.license, request.postDataJSON())
      body = { ...state.license, activeUsers: 4, registeredHosts: 3, hasKey: true }
    } else if (path === '/api/v1/settings/platform/tenants/12/license') body = { ...state.license, activeUsers: 4, registeredHosts: 3, hasKey: true }
    else if (path === '/api/v1/users') body = { data: [], page: 1, limit: 200, total: 0, totalPages: 0 }
    else if (path === '/api/v1/groups') body = []
    else if (path === '/api/v1/session-audit/policy') body = null
    else if (path === '/api/v1/features') body = { agentsLicensed: true, integrationsLicensed: true, integrationProviders: { jira: true, oidc: true } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return context
}

async function main() {
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const state = { license: structuredClone(license), savedPayloads: [] }

  const tenantAdmin = await newContext(browser, false, state)
  const adminPage = await tenantAdmin.newPage()
  await adminPage.goto(`${FRONTEND}/admin/settings`, { waitUntil: 'networkidle' })
  await adminPage.getByRole('heading', { name: /Configurações do tenant|Tenant settings/i }).waitFor()
  await adminPage.getByText(/Administração|Administration/i, { exact: true }).waitFor()
  if (await adminPage.getByText(/Configurações do tenant|Tenant settings/i, { exact: true }).count() < 2) throw new Error('Menu de administração do tenant não foi exibido')
  if (await adminPage.getByText(/Configurações da plataforma|Platform settings/i).count()) throw new Error('Admin do tenant visualizou configuração de plataforma')
  if (await adminPage.getByText('Aplicar contrato', { exact: true }).count()) throw new Error('Admin do tenant recebeu editor de licença')
  await adminPage.goto(`${FRONTEND}/platform/settings`, { waitUntil: 'domcontentloaded' })
  await adminPage.waitForURL((url) => !url.pathname.startsWith('/platform/settings'))
  await tenantAdmin.close()

  const platform = await newContext(browser, true, state)
  const platformPage = await platform.newPage()
  const pageErrors = []
  platformPage.on('pageerror', (error) => pageErrors.push(error.message))
  await platformPage.goto(`${FRONTEND}/platform/settings`, { waitUntil: 'networkidle' })
  await platformPage.getByRole('heading', { name: /Configurações da plataforma|Platform settings/i }).waitFor()
  await platformPage.getByText(/Ambiente|Environment/i, { exact: true }).first().waitFor()
  await platformPage.getByText(/Cache do frontend|Frontend cache/i).waitFor()
  await platformPage.getByText('FEATURE_MCP', { exact: true }).waitFor()
  const mcpEnvironmentItem = platformPage.locator('.na-item').filter({ hasText: 'FEATURE_MCP' })
  await mcpEnvironmentItem.getByText(/Habilitado|Enabled/i).waitFor()
  if (await platformPage.getByText(/Política de senha|Password policy/i).count()) throw new Error('Tela global misturou configuração do tenant')

  await platformPage.goto(`${FRONTEND}/platform/tenants`, { waitUntil: 'networkidle' })
  await platformPage.getByRole('button', { name: 'Licença' }).click()
  const editor = platformPage.getByTestId('tenant-license-editor')
  await editor.waitFor()
  const usersInput = editor.getByTestId('license-max-users').locator('input')
  await usersInput.fill('40')
  await editor.getByText('integrations', { exact: true }).click()
  await editor.getByTestId('save-tenant-license').click()
  await platformPage.locator('.n-popconfirm__action button').last().click()
  await platformPage.locator('.n-message').getByText(/enforcement efetivo/i).waitFor()
  if (state.savedPayloads.length !== 1) throw new Error('Licença não foi persistida exatamente uma vez')
  const saved = state.savedPayloads[0]
  if (saved.maxUsers !== 40 || saved.featureEntitlements.integrations !== false || saved.integrationEntitlements.jira !== false || saved.integrationEntitlements.oidc !== false) {
    throw new Error(`Dependências da licença incorretas: ${JSON.stringify(saved)}`)
  }
  await editor.getByRole('button', { name: 'Cancelar' }).first().click()
  await platformPage.getByRole('button', { name: 'Licença' }).click()
  await editor.waitFor()
  if (await editor.getByTestId('license-max-users').locator('input').inputValue() !== '40') throw new Error('Configuração persistida não refletiu ao reabrir')
  if (pageErrors.length) throw new Error(`Erros de UI: ${pageErrors.join(' | ')}`)

  console.log(JSON.stringify({ ok: true, cdp: !!CDP_URL, profiles: 2, persisted: state.savedPayloads.length, reflected: true }))
  await platform.close()
  await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
