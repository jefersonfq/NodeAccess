#!/usr/bin/env node
/*
 * HA admin UI validation against a real NodeAccess API.
 *
 * Safety invariant: every non-GET request under /api/v1/ha/ is aborted.
 *
 * Authentication:
 *   HA_TEST_ACCESS_TOKEN=...
 * or:
 *   HA_TEST_EMAIL=... HA_TEST_PASSWORD=... HA_TEST_TOTP_CODE=...
 *   HA_TEST_TENANT_SLUG=nodeaccess
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium, request } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'https://192.168.1.105').replace(/\/$/, '')
const API_BASE = (process.env.API_BASE || `${FRONTEND}/api/v1`).replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-ha-playwright-live-readonly.json'
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/tmp/nodeaccess-ha-playwright-live-artifacts'
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const HEADLESS = process.env.HEADLESS !== '0'
const VIEWPORT_WIDTH = Number(process.env.VIEWPORT_WIDTH || 1440)
const VIEWPORT_HEIGHT = Number(process.env.VIEWPORT_HEIGHT || 1000)

function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('HA_TEST_ACCESS_TOKEN não contém um JWT válido')
  }
}

function totpCode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, '')
  let bits = ''
  for (const character of normalized) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error('HA_TEST_TOTP_SECRET não é Base32 válido')
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

async function responseJson(response, label) {
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${label} retornou conteúdo que não é JSON`)
  }
  if (!response.ok()) {
    throw new Error(`${label} falhou com HTTP ${response.status()}: ${body?.message || text}`)
  }
  return body
}

async function authenticate(api) {
  if (process.env.HA_TEST_ACCESS_TOKEN) {
    return {
      accessToken: process.env.HA_TEST_ACCESS_TOKEN,
      refreshToken: '',
      source: 'access-token',
    }
  }

  const email = process.env.HA_TEST_EMAIL
  const password = process.env.HA_TEST_PASSWORD
  if (!email || !password) {
    throw new Error(
      'Autenticação ausente. Defina HA_TEST_ACCESS_TOKEN ou HA_TEST_EMAIL/HA_TEST_PASSWORD com TOTP.',
    )
  }
  const login = await responseJson(await api.post(`${API_BASE}/auth/login`, {
    data: {
      email,
      password,
      tenantSlug: process.env.HA_TEST_TENANT_SLUG || 'nodeaccess',
    },
  }), 'Login HA')
  if (!login.tempToken) throw new Error('Login HA não retornou tempToken para MFA')

  const code = process.env.HA_TEST_TOTP_CODE
    || (process.env.HA_TEST_TOTP_SECRET ? totpCode(process.env.HA_TEST_TOTP_SECRET) : '')
  if (!code) {
    throw new Error('MFA obrigatório. Defina HA_TEST_TOTP_CODE ou HA_TEST_TOTP_SECRET.')
  }
  const verified = await responseJson(await api.post(`${API_BASE}/auth/verify-totp`, {
    data: { token: code, setupToken: login.tempToken },
  }), 'MFA HA')
  return {
    accessToken: verified.accessToken,
    refreshToken: verified.refreshToken || '',
    source: process.env.HA_TEST_TOTP_SECRET ? 'password-totp-secret' : 'password-totp-code',
  }
}

function statusLabel(status) {
  return {
    PENDING: 'Pendente',
    HEALTHY: 'Saudável',
    DEGRADED: 'Degradado',
    OFFLINE: 'Offline',
  }[status] || status
}

async function main() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  const api = await request.newContext({ ignoreHTTPSErrors: true })
  const auth = await authenticate(api)
  const claims = decodeJwt(auth.accessToken)
  if (!claims.isPlatformAdmin) {
    throw new Error('O usuário do ensaio precisa ser SuperAdmin (isPlatformAdmin=true)')
  }

  const launchOptions = {
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-gpu'],
  }
  if (fs.existsSync(EXECUTABLE_PATH)) launchOptions.executablePath = EXECUTABLE_PATH
  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  await context.addInitScript(({ accessToken, refreshToken }) => {
    localStorage.setItem('na_access_token', accessToken)
    if (refreshToken) localStorage.setItem('na_refresh_token', refreshToken)
  }, auth)

  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const blockedMutations = []
  const haResponses = {}
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.routeWebSocket('**/ws/events**', (webSocket) => {
    webSocket.onMessage(() => {})
  })
  await page.route('**/api/v1/ha/**', async (route) => {
    const requestData = route.request()
    if (requestData.method() !== 'GET') {
      blockedMutations.push({
        method: requestData.method(),
        path: new URL(requestData.url()).pathname,
      })
      await route.abort('blockedbyclient')
      return
    }
    const response = await route.fetch()
    const apiPath = new URL(requestData.url()).pathname
    try {
      haResponses[apiPath] = await response.json()
    } catch {
      haResponses[apiPath] = null
    }
    await route.fulfill({ response })
  })

  let report
  try {
    await page.goto(`${FRONTEND}/platform/high-availability?haLiveReadonly=${Date.now()}`, {
      waitUntil: 'networkidle',
      timeout: 45_000,
    })
    await page.getByRole('heading', { name: 'Alta disponibilidade' }).waitFor()
    const settingsSection = page.locator('details').filter({
      has: page.getByText('Configurações', { exact: true }),
    }).first()
    if (!await settingsSection.evaluate((element) => element.open)) {
      throw new Error('A seção Configurações deve iniciar expandida')
    }
    const journalSection = page.locator('summary', {
      hasText: 'Journal de operações',
    }).locator('..')
    const journalInitiallyCollapsed = !await journalSection.evaluate((element) => element.open)
    const topologyDetailsSpacing = await page.evaluate(() => {
      const topology = document.querySelector('.topology')
      const details = document.querySelector('.node-details')
      if (!topology || !details) return null
      return Math.round(
        details.getBoundingClientRect().top - topology.getBoundingClientRect().bottom,
      )
    })
    const standbyCard = page.locator('.node-grid .n-card').filter({
      has: page.getByText('STANDBY', { exact: true }),
    }).first()
    const promoteActionVisible = await standbyCard.getByRole('button', {
      name: 'Promover este nó',
    }).isVisible()
    const advancedActionsInitiallyCollapsed = !await standbyCard.locator(
      '.advanced-actions',
    ).evaluate((element) => element.open)
    await standbyCard.getByRole('button', { name: 'Promover este nó' }).click()
    const guidedPromotionVisible = await page.getByText(
      'Execução assistida',
      { exact: true },
    ).isVisible()
    const guidedPromotionTitleVisible = await page.locator(
      '.n-modal .n-card-header__main',
    ).filter({ hasText: /^Promover .+$/ }).isVisible()
    const guidedPromotionFirstStepVisible = await page.getByText(
      'Validar o candidato',
      { exact: true },
    ).isVisible()
    const guidedPromotionCommandVisible = await page.getByLabel(
      'Comando assistido para operação HA',
    ).isVisible()
    await page.getByRole('button', { name: 'Fechar' }).click()
    const nodes = haResponses['/api/v1/ha/nodes']
    const operations = haResponses['/api/v1/ha/operations']
    if (!Array.isArray(nodes)) throw new Error('GET /ha/nodes não retornou uma lista')
    if (!Array.isArray(operations)) throw new Error('GET /ha/operations não retornou uma lista')

    const comparisons = []
    for (const node of nodes) {
      const card = page.locator('.node-grid .n-card').filter({
        has: page.getByText(node.name, { exact: true }),
      })
      const promotionLabel = node.observedRole === 'PRIMARY'
        ? 'Não se aplica · nó ativo'
        : (node.promotionReady ? 'Sim' : 'Não')
      const cardText = (await card.innerText()).replace(/\s+/g, ' ')
      comparisons.push({
        nodeId: node.id,
        observedRole: node.observedRole,
        endpoint: node.endpoint,
        nameVisible: await card.getByRole('heading', { name: node.name, exact: true }).isVisible(),
        statusVisible: await card.getByText(statusLabel(node.status), { exact: true }).isVisible(),
        roleVisible: new RegExp(`Papel observado:? ?${node.observedRole}`).test(cardText),
        endpointVisible: new RegExp(`IP administrativo:? ?${node.endpoint.replaceAll('.', '\\.')}`).test(cardText),
        inventoryVisible: node.inventory
          ? cardText.includes(node.inventory.hostname)
            && cardText.includes(node.inventory.operatingSystem)
            && cardText.includes(node.inventory.architecture)
          : true,
        promotionVisible: await card.getByText(promotionLabel, { exact: true }).isVisible(),
        mysqlLagVisible: Number.isFinite(node.components?.mysql?.lagSeconds)
          ? await card.getByText(
            `MySQL: ${node.components.mysql.status} · lag ${node.components.mysql.lagSeconds}s`,
            { exact: true },
          ).isVisible()
          : true,
      })
    }
    const screenshot = path.join(
      ARTIFACTS_DIR,
      `live-readonly-${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}.png`,
    )
    await page.screenshot({ path: screenshot, fullPage: true })
    const findings = []
    if (blockedMutations.length) findings.push('A interface tentou executar mutação HA')
    if (!journalInitiallyCollapsed) findings.push('O Journal de operações não iniciou recolhido')
    if (!promoteActionVisible) findings.push('A ação principal de promoção não está visível')
    if (!advancedActionsInitiallyCollapsed) findings.push('As opções avançadas não iniciaram recolhidas')
    if (
      !guidedPromotionVisible
      || !guidedPromotionTitleVisible
      || !guidedPromotionFirstStepVisible
      || !guidedPromotionCommandVisible
    ) {
      findings.push('O fluxo assistido de promoção não abriu corretamente')
    }
    if (topologyDetailsSpacing == null || topologyDetailsSpacing < 20) {
      findings.push('A separação entre a topologia e os detalhes dos nós é insuficiente')
    }
    if (consoleErrors.length) findings.push('Erros encontrados no console')
    if (pageErrors.length) findings.push('Exceções encontradas na página')
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) {
      findings.push('Overflow horizontal encontrado')
    }
    for (const comparison of comparisons) {
      for (const [key, value] of Object.entries(comparison)) {
        if (key.endsWith('Visible') && value !== true) {
          findings.push(`${comparison.nodeId}: ${key}=false`)
        }
      }
    }
    report = {
      runner: 'playwright',
      mode: 'live-read-only',
      frontend: FRONTEND,
      apiBase: API_BASE,
      authSource: auth.source,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      nodes: nodes.length,
      operations: operations.length,
      comparisons,
      blockedMutations,
      journalInitiallyCollapsed,
      topologyDetailsSpacing,
      promoteActionVisible,
      advancedActionsInitiallyCollapsed,
      guidedPromotionVisible,
      guidedPromotionTitleVisible,
      guidedPromotionFirstStepVisible,
      guidedPromotionCommandVisible,
      consoleErrors,
      pageErrors,
      screenshot,
      findings,
    }
  } finally {
    await context.close()
    await browser.close()
    await api.dispose()
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (report.findings.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[ha-live-readonly] ${error.message}`)
  process.exit(1)
})
