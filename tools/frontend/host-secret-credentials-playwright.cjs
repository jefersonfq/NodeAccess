#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const host = {
  id: 21, tenantId: 7, name: 'Servidor Lucien', description: null, ip: '10.0.0.21', port: 22,
  accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'ops', authType: 'password', connectionMode: 'direct',
  scope: 'personal', ownerId: 41, groupId: null, folderId: null, inventoryParentId: 800, bastionId: null,
  pemKeyId: null, passwordSecretId: null, passwordSecretAlias: null, hasPasswordCredential: false,
  onePasswordRef: null, startupSnippetId: null, startupSnippetMode: 'disabled', tags: [], associatedLinks: [],
  accessPermissions: { view: true, connect: true, edit: true, admin: true },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}
const inventory = [
  { id: 800, parentId: null, type: 'ROOT', hostId: null, name: 'Infraestrutura', path: '/Infraestrutura', depth: 0, createdAt: host.createdAt, updatedAt: host.updatedAt },
  { id: 801, parentId: 800, type: 'HOST', hostId: host.id, name: host.name, path: `/Infraestrutura/${host.name}`, depth: 1, createdAt: host.createdAt, updatedAt: host.updatedAt },
]

function token() {
  const payload = { sub: '41', userId: 41, tenantId: 7, name: 'Administrador', role: 'admin', email: 'admin@example.test', stage: 'authenticated', iat: 1, exp: 4102444800 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const updates = []
  const tests = []
  let secretListCalls = 0
  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'host-secret-harness')
    localStorage.setItem('na_hosts_default_view', 'all')
  }, token())
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = []
    if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 1, global: 0, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
    else if (path === '/api/v1/hosts') body = { data: [host], total: 1, page: 1, limit: 20, totalPages: 1 }
    else if (path === `/api/v1/hosts/${host.id}` && request.method() === 'GET') body = host
    else if (path === `/api/v1/hosts/${host.id}` && request.method() === 'PATCH') { updates.push(request.postDataJSON()); body = { ...host, ...updates.at(-1), passwordSecretAlias: 'SSH Produção', hasPasswordCredential: true } }
    else if (path === '/api/v1/hosts/test-connection') { tests.push(request.postDataJSON()); body = { success: true, latencyMs: 12, message: 'Conexão realizada com sucesso' } }
    else if (path === '/api/v1/secrets') { secretListCalls += 1; body = [{ id: 91, alias: 'SSH Produção', scope: 'PERSONAL', ownerId: 41, groupId: null, tenantId: 7, createdById: 41, createdAt: host.createdAt, updatedAt: host.updatedAt, revokedAt: null }] }
    else if (path === '/api/v1/inventory') body = inventory
    else if (path === '/api/v1/sessions/access-map') body = { generatedAt: host.createdAt, refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
    else if (path === '/api/v1/features') body = { secrets: true }
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: 1, hasKey: true, featureEntitlements: { secrets: true }, integrationEntitlements: {} } }
    else if (path === '/api/v1/integrations/onepassword/status') body = { active: false }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto(`${FRONTEND}/hosts`, { waitUntil: 'domcontentloaded' })
  await page.getByText(/View all hosts|Ver todos os hosts/).first().click()
  const hostContainer = page.locator(`[data-host-id="${host.id}"]`).first()
  await hostContainer.waitFor()
  await hostContainer.locator('[data-host-actions-button="true"]').click()
  await page.getByText(/Edit|Editar/, { exact: true }).last().click()
  const source = page.locator('[data-host-credential-source="true"]')
  await page.waitForTimeout(1_000)
  if (!await source.count()) {
    throw new Error(`Formulário de Host não abriu em ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 1200)}`)
  }
  await source.waitFor()
  await source.click()
  await page.getByText(/Usar Secret salvo|Use saved Secret/, { exact: true }).click()
  const secretSelect = page.locator('[data-host-secret-select="true"]')
  await secretSelect.click()
  await page.getByText('SSH Produção', { exact: true }).click()
  await page.getByRole('button', { name: /Testar conexão|Test connection/ }).click()
  await page.getByText(/Conexão realizada com sucesso|Connection successful/).waitFor()
  await page.getByRole('button', { name: /Salvar|Save/, exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[data-host-secret-select="true"]'))

  if (secretListCalls !== 1) throw new Error(`Secrets carregados ${secretListCalls} vezes; esperado 1 carregamento sob demanda`)
  if (tests[0]?.passwordSecretId !== 91 || 'password' in tests[0]) throw new Error(`Teste expôs credencial ou perdeu o Secret: ${JSON.stringify(tests[0])}`)
  if (updates[0]?.passwordSecretId !== 91 || 'password' in updates[0]) throw new Error(`Update expôs credencial ou perdeu o Secret: ${JSON.stringify(updates[0])}`)
  if (browserErrors.length) throw new Error(`Erros no navegador: ${browserErrors.join('; ')}`)
  const performance = await cdp.send('Performance.getMetrics')
  const jsHeapUsedSize = performance.metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? null
  console.log(JSON.stringify({ ok: true, secretListCalls, jsHeapUsedSize, testPayload: tests[0], updatePayload: updates[0] }, null, 2))
  await browser.close()
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
