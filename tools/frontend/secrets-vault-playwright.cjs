#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const SENSITIVE = 'Vault-E2E-never-persist-9!'
const now = new Date().toISOString()
const secret = (id, alias, extra = {}) => ({
  id, tenantId: 7, alias, description: 'Credencial SSH de produção', scope: 'PERSONAL',
  ownerUserId: 41, groupId: null, createdByUserId: 41, createdByUsername: 'Administrador',
  source: 'MANUAL', usageCount: 2, createdAt: now, updatedAt: now, rotatedAt: null, revokedAt: null, ...extra,
})

function token() {
  const payload = { sub: '41', userId: 41, tenantId: 7, name: 'Administrador', role: 'admin', email: 'admin@example.test', stage: 'authenticated', exp: 4102444800 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function assertNoBrowserPersistence(page, context) {
  const snapshot = await page.evaluate(async () => ({
    dom: document.documentElement.textContent,
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
    caches: 'caches' in window ? await caches.keys() : [],
    indexedDb: 'databases' in indexedDB ? await indexedDB.databases() : [],
    resources: performance.getEntriesByType('resource').map((entry) => entry.name),
  }))
  if (JSON.stringify(snapshot).includes(SENSITIVE)) throw new Error('Valor sensível permaneceu no DOM ou storage')
  const cookies = await context.cookies()
  if (JSON.stringify(cookies).includes(SENSITIVE)) throw new Error('Valor sensível permaneceu em cookie')
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  try { await contextbewijs(context) } finally { await browser.close() }
}

async function contextbewijs(context) {
  let rows = [secret(9, 'ssh-prod')]
  let listOffline = false
  let consumerMode = 'both'
  const captured = []
  await context.addInitScript((authToken) => localStorage.setItem('na_access_token', authToken), token())
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/v1/secrets' && req.method() === 'GET') {
      if (listOffline) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Vault temporariamente indisponível' }) })
      return route.fulfill({ status: 200, headers: { 'cache-control': 'no-store' }, contentType: 'application/json', body: JSON.stringify(rows) })
    }
    if (path === '/api/v1/secrets' && req.method() === 'POST') {
      const payload = req.postDataJSON(); captured.push(payload)
      rows.push(secret(10, payload.alias, { description: payload.description ?? null }))
      await new Promise((resolve) => setTimeout(resolve, 120))
      return route.fulfill({ status: 201, headers: { 'cache-control': 'no-store' }, contentType: 'application/json', body: JSON.stringify(rows.at(-1)) })
    }
    if (path === '/api/v1/secrets/9/consumers') return route.fulfill({ status: 200, headers: { 'cache-control': 'no-store' }, contentType: 'application/json', body: JSON.stringify({ hostCount: consumerMode === 'both' ? 1 : 0, hosts: consumerMode === 'both' ? [{ id: 21, name: 'Servidor Produção', sshUser: 'ops' }] : [], snippetCount: consumerMode === 'empty' ? 0 : 1, snippets: consumerMode === 'empty' ? [] : [{ id: 31, name: 'Deploy seguro' }] }) })
    if (path === '/api/v1/features') return route.fulfill({ status: listOffline ? 503 : 200, contentType: 'application/json', body: listOffline ? '{}' : JSON.stringify({ secretsLicensed: true, secrets: true }) })
    if (path === '/api/v1/groups') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${FRONTEND}/secrets`, { waitUntil: 'domcontentloaded' })
  await page.getByText('ssh-prod', { exact: true }).waitFor()
  if ((await page.locator('[data-secret-usage="9"]').innerText()) !== '2') throw new Error('Usage badge does not show the persisted count')
  if (await page.getByRole('button', { name: /Rotacionar|Rotate/, exact: true }).count()) throw new Error('Secondary actions remain outside the menu')
  await page.getByRole('button', { name: /Ações: ssh-prod|Actions: ssh-prod/ }).click()
  await page.locator('.n-dropdown-option').getByText(/^(Editar|Edit)$/).waitFor()
  await page.keyboard.press('Escape')

  await page.getByPlaceholder(/Buscar por alias|Search by alias/).fill('inexistente')
  await page.getByText(/Nenhum Secret corresponde|No secrets match/).waitFor()
  await page.getByPlaceholder(/Buscar por alias|Search by alias/).fill('')

  await page.getByRole('button', { name: /Usos|Usage/ }).click()
  await page.getByText('Servidor Produção').waitFor()
  await page.getByText('Deploy seguro').waitFor()
  await page.getByRole('heading', { name: /^(Hosts associados|Associated hosts) \(1\)$/ }).waitFor()
  await page.getByRole('heading', { name: /^(Snippets associados|Associated snippets) \(1\)$/ }).waitFor()
  await page.keyboard.press('Escape')
  consumerMode = 'snippets'
  await page.getByRole('button', { name: /Usos|Usage/ }).click()
  await page.getByRole('heading', { name: /^(Snippets associados|Associated snippets) \(1\)$/ }).waitFor()
  if (await page.getByText('Servidor Produção').count()) throw new Error('Stale host consumer retained')
  if (await page.locator('.n-modal .n-empty').count()) throw new Error('Snippet-only secret incorrectly shown as unused')
  await page.keyboard.press('Escape')
  consumerMode = 'empty'
  await page.getByRole('button', { name: /Usos|Usage/ }).click()
  await page.locator('.n-modal .n-empty').waitFor()
  if (await page.getByText('Deploy seguro').count()) throw new Error('Stale snippet retained for unused secret')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /Novo secret|New secret/ }).first().click()
  await page.getByPlaceholder(/mysql-root-prod/).fill('ssh-user-e2e')
  await page.getByPlaceholder(/senha do root|production MySQL/).fill('Teste automatizado')
  await page.getByPlaceholder(/Cole o valor|Paste the value/).fill(SENSITIVE)
  await page.getByRole('button', { name: /Salvar|Save/, exact: true }).dblclick()
  await page.getByText('ssh-user-e2e', { exact: true }).waitFor()

  if (captured.length !== 1 || captured[0].value !== SENSITIVE) throw new Error('Cadastro não enviou exatamente o valor informado')
  if (JSON.stringify(rows).includes(SENSITIVE)) throw new Error('API simulada retornou/persistiu plaintext em representação pública')
  await assertNoBrowserPersistence(page, context)

  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByText('ssh-user-e2e', { exact: true }).waitFor()

  // Falha de conexão: o conteúdo atual permanece utilizável e o erro recebe feedback.
  listOffline = true
  await page.getByRole('button', { name: /Mostrar revogados|Show revoked/ }).click()
  await page.getByText(/Erro ao carregar secrets|Error loading secrets/).waitFor()
  if (errors.length) throw new Error(`Erros no navegador: ${errors.join('; ')}`)
  console.log(JSON.stringify({ ok: true, scenarios: ['usage count badge', 'grouped actions menu', 'list/search/empty', 'host+snippet impact', 'typed consumer headings', 'snippet-only is not empty', 'unused secret clears prior consumers', 'double-submit protection', 'create/no-leak', 'mobile', 'network failure'], publicPayloadHasValue: false }, null, 2))
}

main().catch((error) => { console.error(error); process.exit(1) })
