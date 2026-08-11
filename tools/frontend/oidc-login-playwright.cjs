#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-oidc-login-playwright.json'
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sub: '20', userId: 20, tenantId: 7, role: 'USER', email: 'user@example.test',
    name: 'External User', stage: 'authenticated', iat: now, exp: now + 3600,
  })).toString('base64url')
  return `${header}.${payload}.harness`
}

async function installApiRoutes(context, observations, options = {}) {
  const completeStatus = options.completeStatus ?? 200
  const completeBody = options.completeBody ?? { accessToken: fakeJwt(), refreshToken: 'oidc-refresh-token' }
  const oidcConfigStatus = options.oidcConfigStatus ?? 200
  const oidcStartStatus = options.oidcStartStatus ?? 200
  const tenants = options.tenants ?? [{ name: 'Acme', slug: 'acme' }]
  await context.route('https://idp.example.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Simulated IdP</title><h1>Simulated IdP</h1>',
  }))
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    let status = 200
    let body = {}

    if (path === '/api/v1/auth/lookup-tenant') {
      observations.lookup = request.postDataJSON()
      body = { tenants }
    } else if (path === '/api/v1/auth/google/config') {
      body = { enabled: false, clientId: null }
    } else if (path === '/api/v1/auth/oidc/config') {
      observations.configTenant = url.searchParams.get('tenantSlug')
      status = oidcConfigStatus
      body = oidcConfigStatus === 200
        ? { enabled: true, name: 'Entra ID' }
        : { message: 'Provedor temporariamente indisponível' }
    } else if (path === '/api/v1/auth/oidc/start') {
      observations.start = request.postDataJSON()
      const sourcePage = context.pages().find((candidate) => candidate.url().startsWith(FRONTEND))
      observations.redirectAtStart = await sourcePage?.evaluate(() => sessionStorage.getItem('na_oidc_redirect'))
      status = oidcStartStatus
      body = oidcStartStatus === 200
        ? { authorizationUrl: 'https://idp.example.test/authorize?state=single-use-state&nonce=nonce' }
        : { message: 'Provedor temporariamente indisponível' }
    } else if (path === '/api/v1/auth/oidc/complete') {
      observations.complete = request.postDataJSON()
      status = completeStatus
      body = completeStatus === 200
        ? completeBody
        : { message: 'Transação OIDC inválida, expirada ou já utilizada' }
    } else if (path === '/api/v1/features') {
      body = {}
    } else if (path.includes('/preferences')) {
      body = null
    } else {
      body = []
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function trackBrowserErrors(context) {
  const anomalies = []
  context.on('page', (page) => {
    page.on('pageerror', (error) => anomalies.push(error.message))
    page.on('console', (message) => {
      const expectedHttpFailure = /Failed to load resource: the server responded with a status of (400|401)/.test(message.text())
      if (message.type() === 'error' && !expectedHttpFailure) {
        anomalies.push(message.text())
      }
    })
  })
  return anomalies
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const observations = {}
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const anomalies = await trackBrowserErrors(context)
  await installApiRoutes(context, observations)
  const page = await context.newPage()

  await page.goto(`${FRONTEND}/auth/login?redirect=/hosts`, { waitUntil: 'networkidle' })
  const oidcButton = page.getByRole('button', { name: /Entrar com Entra ID|Sign in with Entra ID/ })
  if (await oidcButton.count()) throw new Error('OIDC foi exibido antes da identificação do tenant')

  const email = page.locator('input[inputmode="email"]')
  await email.fill('user@example.test')
  await page.getByRole('button', { name: /Continuar|Continue/ }).click()
  await oidcButton.waitFor()
  await page.locator('input[type="password"]').waitFor()
  if (observations.configTenant !== 'acme') throw new Error('Configuração OIDC consultada fora do tenant selecionado')

  await oidcButton.focus()
  if (await page.evaluate(() => document.activeElement?.tagName) !== 'BUTTON') throw new Error('CTA OIDC não recebe foco')
  await Promise.all([
    page.waitForURL('https://idp.example.test/**'),
    page.keyboard.press('Enter'),
  ])
  if (observations.start?.tenantSlug !== 'acme') throw new Error('Início OIDC não preservou o tenant')
  if (observations.redirectAtStart !== '/hosts') {
    throw new Error('Destino seguro não foi preservado antes do redirect')
  }

  const callback = await context.newPage()
  await callback.goto(`${FRONTEND}/auth/login`)
  await callback.evaluate(() => sessionStorage.setItem('na_oidc_redirect', '/hosts'))
  await callback.goto(`${FRONTEND}/auth/oidc/callback?state=single-use-state&code=authorization-code`)
  await callback.waitForURL('**/hosts')
  if (observations.complete?.state !== 'single-use-state' || observations.complete?.code !== 'authorization-code') {
    throw new Error('Callback não enviou state/code corretamente')
  }
  const tokens = await callback.evaluate(() => ({
    access: localStorage.getItem('na_access_token'),
    refresh: localStorage.getItem('na_refresh_token'),
    redirect: sessionStorage.getItem('na_oidc_redirect'),
  }))
  if (!tokens.access || tokens.refresh !== 'oidc-refresh-token' || tokens.redirect !== null) {
    throw new Error('Tokens ou redirect temporário não foram tratados corretamente')
  }

  const mfaContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const mfaObservations = {}
  const mfaAnomalies = await trackBrowserErrors(mfaContext)
  await installApiRoutes(mfaContext, mfaObservations, {
    completeBody: { tempToken: 'oidc-mfa-pending', requiresMfaSetup: false, emailOtpAvailable: true },
  })
  const mfaCallback = await mfaContext.newPage()
  await mfaCallback.goto(`${FRONTEND}/auth/login`)
  await mfaCallback.evaluate(() => sessionStorage.setItem('na_oidc_redirect', '/hosts'))
  await mfaCallback.goto(`${FRONTEND}/auth/oidc/callback?state=mfa-state&code=mfa-code`)
  await mfaCallback.waitForURL('**/auth/verify-totp?redirect=/hosts')
  await mfaCallback.getByRole('button', { name: /Verificar|Verify/i }).waitFor()
  const mfaState = await mfaCallback.evaluate(() => ({
    tempToken: sessionStorage.getItem('na_temp_auth_token'),
    emailOtp: sessionStorage.getItem('na_email_otp_available'),
    accessToken: localStorage.getItem('na_access_token'),
    oidcRedirect: sessionStorage.getItem('na_oidc_redirect'),
  }))
  if (mfaState.tempToken !== 'oidc-mfa-pending' || mfaState.emailOtp !== 'true') {
    throw new Error('Fallback OIDC não preservou o desafio MFA local')
  }
  if (mfaState.accessToken || mfaState.oidcRedirect !== null) {
    throw new Error('Fallback OIDC criou sessão antes do MFA ou preservou redirect temporário')
  }

  const failureContext = await browser.newContext({ viewport: { width: 360, height: 740 } })
  const failureObservations = {}
  const failureAnomalies = await trackBrowserErrors(failureContext)
  await installApiRoutes(failureContext, failureObservations, { completeStatus: 401 })
  const failure = await failureContext.newPage()
  await failure.goto(`${FRONTEND}/auth/oidc/callback?state=replayed&code=code`)
  await failure.getByText(/expirada ou já utilizada/i).waitFor()
  const backButton = failure.locator('button').filter({ hasText: /Voltar ao login|Back to sign in/ })
  await backButton.focus()
  const mobileWidth = await failure.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
  if (mobileWidth.scroll > mobileWidth.inner) throw new Error('Callback OIDC possui overflow horizontal no mobile')
  if (await failure.evaluate(() => localStorage.getItem('na_access_token'))) throw new Error('Falha OIDC armazenou token')

  const providerError = await failureContext.newPage()
  await providerError.goto(`${FRONTEND}/auth/oidc/callback?error=access_denied`)
  await providerError.getByRole('button', { name: /Voltar ao login|Back to sign in/ }).waitFor()
  if (failureObservations.complete && failureObservations.complete.state !== 'replayed') {
    throw new Error('Erro do provedor tentou completar uma transação indevida')
  }

  const multiContext = await browser.newContext({ viewport: { width: 768, height: 900 } })
  const multiObservations = {}
  const multiAnomalies = await trackBrowserErrors(multiContext)
  await installApiRoutes(multiContext, multiObservations, {
    tenants: [{ name: 'Acme', slug: 'acme' }, { name: 'Beta', slug: 'beta' }],
    oidcStartStatus: 400,
  })
  const multi = await multiContext.newPage()
  await multi.goto(`${FRONTEND}/auth/login?redirect=${encodeURIComponent('https://evil.example.test/phishing')}`)
  await multi.locator('input[inputmode="email"]').fill('multi@example.test')
  await multi.getByRole('button', { name: /Continuar|Continue/ }).click()
  const beta = multi.getByRole('button', { name: /Beta.*beta/i })
  await beta.focus()
  await multi.keyboard.press('Enter')
  await multi.getByRole('button', { name: /^Continuar$|^Continue$/ }).click()
  const multiOidc = multi.getByRole('button', { name: /Entrar com Entra ID|Sign in with Entra ID/ })
  await multiOidc.waitFor()
  if (multiObservations.configTenant !== 'beta') throw new Error('Picker não aplicou o tenant escolhido ao OIDC')
  const [, startResponse] = await Promise.all([
    multiOidc.click(),
    multi.waitForResponse((response) => response.url().includes('/api/v1/auth/oidc/start')),
  ])
  if (startResponse.status() !== 400) throw new Error(`Harness esperava rejeição OIDC 400, recebeu ${startResponse.status()}`)
  const startFailureAlert = multi.locator('.n-alert')
  await startFailureAlert.waitFor()
  const startFailureText = await startFailureAlert.innerText()
  if (!/Provedor temporariamente indisponível|Não foi possível concluir o login corporativo|Corporate sign-in could not be completed/i.test(startFailureText)) {
    throw new Error(`Feedback inesperado ao falhar OIDC: ${startFailureText}`)
  }
  await multi.locator('input[type="password"]').waitFor({ state: 'visible' })
  if (multi.url().startsWith('https://evil.example.test')) throw new Error('Login aceitou redirect externo')
  if (multiObservations.redirectAtStart !== '/hosts') throw new Error('Redirect externo não foi sanitizado')

  const unavailableContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const unavailableObservations = {}
  const unavailableAnomalies = await trackBrowserErrors(unavailableContext)
  await installApiRoutes(unavailableContext, unavailableObservations, { oidcConfigStatus: 400 })
  const unavailable = await unavailableContext.newPage()
  await unavailable.goto(`${FRONTEND}/auth/login`)
  await unavailable.locator('input[inputmode="email"]').fill('user@example.test')
  await unavailable.getByRole('button', { name: /Continuar|Continue/ }).click()
  await unavailable.locator('input[type="password"]').waitFor()
  if (await unavailable.getByRole('button', { name: /Entra ID/ }).count()) {
    throw new Error('OIDC indisponível permaneceu visível')
  }

  const allAnomalies = [...anomalies, ...mfaAnomalies, ...failureAnomalies, ...multiAnomalies, ...unavailableAnomalies]
  if (allAnomalies.length) throw new Error(`Anomalias do navegador: ${allAnomalies.join('; ')}`)

  const report = {
    changeId: 'NA-0020', frontend: FRONTEND, result: 'passed',
    tenantScopedDiscovery: true, passwordFallbackPreserved: true,
    keyboardActivation: true, redirectPreserved: true, callbackStoresTokens: true,
    localMfaFallback: true, replayErrorHandled: true, providerErrorHandled: true, mobileNoOverflow: true,
    multipleTenants: true, startFailureKeepsPassword: true,
    unavailableProviderKeepsPassword: true, externalRedirectBlocked: true,
    browserAnomalies: allAnomalies,
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
