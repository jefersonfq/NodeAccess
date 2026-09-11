#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '11', tenantId: 7, name: 'Platform Admin', role: 'admin', email: 'admin@example.test', isPlatformAdmin: true, stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function main() {
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const state = { featuresRequests: 0, failFeatures: false }
  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'harness')
    if (!sessionStorage.getItem('na_cache_test_initialized')) {
      localStorage.removeItem('na_cache_ttl_overrides_v1')
      sessionStorage.setItem('na_cache_test_initialized', '1')
    }
  }, token())
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/settings/platform') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        features: { sessionAudit: true, sessionAuditAiSummary: true, sessionAuditAiAutoSummary: false, localAi: false, nativeSshGateway: true, mcp: true },
        cache: {
          hostDashboardTtlSeconds: 45, userDashboardTtlSeconds: 45, hostSidebarTtlSeconds: 30, observabilityTtlMs: 5000, sessionAuditPolicyTtlSeconds: 30,
          runtime: [{ domain: 'host_dashboard', hits: 8, misses: 2, writes: 2, invalidations: 1, errors: 0, disabled: 0, operations: 13, hitRate: 0.8, averageDurationMs: 1.4, lastActivityAt: new Date().toISOString() }],
        },
      }) })
    }
    if (path === '/api/v1/features') {
      state.featuresRequests += 1
      if (state.failFeatures) return route.abort('connectionfailed')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agentsLicensed: true, integrationsLicensed: true }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${FRONTEND}/platform/settings?cache-check=${Date.now()}`, { waitUntil: 'networkidle' })
  await page.getByTestId('backend-cache-settings').getByText('45s', { exact: true }).first().waitFor()
  await page.getByTestId('backend-cache-runtime').getByText('Hit rate: 80%').waitFor()
  await page.getByTestId('frontend-cache-settings').getByRole('button', { name: 'Expandir' }).click()

  const secondPage = await context.newPage()
  await secondPage.goto(`${FRONTEND}/platform/settings?cache-second-tab=${Date.now()}`, { waitUntil: 'networkidle' })
  await secondPage.getByTestId('frontend-cache-settings').getByRole('button', { name: 'Expandir' }).click()

  const editor = page.getByTestId('cache-ttl-editor-features')
  await editor.waitFor()
  const input = editor.locator('input')
  await input.fill('7')
  await editor.getByRole('button', { name: 'Aplicar TTL' }).click()
  await page.locator('.n-message').getByText(/atualizado neste navegador/i).waitFor()
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('na_cache_ttl_overrides_v1') || '{}'))
  if (persisted.features !== 7000) throw new Error(`TTL não persistiu: ${JSON.stringify(persisted)}`)
  const secondTabTtl = secondPage.getByTestId('cache-ttl-editor-features').locator('input')
  await secondTabTtl.waitFor()
  await secondPage.waitForFunction(() => document.querySelector('[data-testid="cache-ttl-editor-features"] input')?.value === '7')
  if (await secondTabTtl.inputValue() !== '7') throw new Error('TTL não foi propagado para a segunda aba')
  await secondPage.close()

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByTestId('frontend-cache-settings').getByRole('button', { name: 'Expandir' }).click()
  const reloadedInput = page.getByTestId('cache-ttl-editor-features').locator('input')
  if (await reloadedInput.inputValue() !== '7') throw new Error('TTL personalizado não sobreviveu ao reload')

  state.failFeatures = true
  const featuresCard = page.getByTestId('cache-ttl-editor-features').locator('xpath=ancestor::div[contains(@class,"na-item")]')
  await featuresCard.getByRole('button', { name: 'Renovar' }).click()
  await page.locator('.n-message').getByText(/não foi possível renovar/i).waitFor()
  await featuresCard.getByText('Falhas de renovação').waitFor()

  state.failFeatures = false
  await featuresCard.getByRole('button', { name: 'Renovar' }).click()
  await page.locator('.n-message').getByText(/renovado/i).waitFor()

  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await page.getByTestId('frontend-cache-settings').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth }
  })
  if (bounds.left < -1 || bounds.right > bounds.viewportWidth + 1 || bounds.scrollWidth > bounds.viewportWidth + 1) {
    throw new Error(`Painel de cache fora do viewport mobile: ${JSON.stringify(bounds)}`)
  }
  if (pageErrors.length) throw new Error(`Erros de UI: ${pageErrors.join(' | ')}`)

  console.log(JSON.stringify({ ok: true, cdp: !!CDP_URL, persistedTtlMs: persisted.features, crossTabPropagation: true, backendHitRateVisible: true, connectionFailureRecovered: true, featuresRequests: state.featuresRequests, mobile: bounds }))
  await context.close()
  if (!CDP_URL) await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
