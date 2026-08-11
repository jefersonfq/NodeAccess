#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '11', userId: 11, tenantId: 7, role: 'admin', email: 'admin@example.test', name: 'Admin', stage: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.harness`
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'refresh')
  }, fakeJwt())
  const updates = []
  const policyUpdates = []
  const breakGlassValidations = []
  const revokedIdentities = []
  let identityLinks = [{
    id: 31,
    user: { id: 20, name: 'External User', email: 'user@example.test' },
    providerKey: 'oidc',
    issuer: 'https://login.example.test/tenant/v2.0',
    emailAtLink: 'user@example.test',
    active: true,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }]
  const anomalies = []
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body
    if (path === '/api/v1/features') {
      body = { sessionAuditAiLicensed: false, localAiLicensed: false, integrationsLicensed: false, integrationProviders: {} }
    } else if (path === '/api/v1/tenant-auth-policy/break-glass/validate') {
      breakGlassValidations.push(request.postDataJSON())
      body = { configured: true, userId: 20, email: 'rescue@example.test', validatedAt: new Date().toISOString() }
    } else if (path === '/api/v1/tenant-auth-policy/break-glass') {
      body = { configured: false, userId: null, email: null, validatedAt: null }
    } else if (path === '/api/v1/tenant-auth-policy' && request.method() === 'PUT') {
      const payload = request.postDataJSON()
      policyUpdates.push(payload)
      body = { requested: payload, effective: { ...payload, lockoutMaxAttempts: 10, lockoutDurationMinutes: 15, accessTokenMinutes: 15, refreshTokenDays: 7 }, enforcementEnabled: false, ssoRequiredEnforced: true, localLoginEnforced: true, emailTenantDiscoveryEnforced: true, lockoutPolicyEnforced: true, tokenLifetimeEnforced: true }
    } else if (path === '/api/v1/tenant-auth-policy') {
      const policy = { localLoginEnabled: true, ssoRequired: false, mfaRequired: true, jitProvisioningEnabled: false, automaticAccountLinkingEnabled: false, emailTenantDiscoveryEnabled: true, lockoutMaxAttempts: 5, lockoutDurationMinutes: 15, accessTokenMinutes: 15, refreshTokenDays: 7 }
      body = { requested: policy, effective: policy, enforcementEnabled: false, ssoRequiredEnforced: true, localLoginEnforced: true, emailTenantDiscoveryEnforced: true, lockoutPolicyEnforced: true, tokenLifetimeEnforced: true }
    } else if (path === '/api/v1/integrations/oidc/identities/31/revoke') {
      revokedIdentities.push(31)
      identityLinks = identityLinks.map((identity) => ({
        ...identity,
        active: false,
        revokedAt: new Date().toISOString(),
      }))
      body = { changed: true }
    } else if (path === '/api/v1/integrations/oidc/identities') {
      body = identityLinks
    } else if (path === '/api/v1/integrations/oidc' && request.method() === 'PUT') {
      const payload = request.postDataJSON()
      updates.push(payload)
      body = { ...payload, clientSecret: undefined, hasClientSecret: true, updatedAt: new Date().toISOString() }
    } else if (path === '/api/v1/integrations/oidc') {
      body = { enabled: false, name: 'Entra ID', issuer: 'https://login.example.test/tenant/v2.0', clientId: 'nodeaccess-client', hasClientSecret: true, scopes: ['openid', 'profile', 'email'], allowedDomains: ['example.test'], autoProvision: false, requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [], updatedAt: new Date().toISOString() }
    } else if (path === '/api/v1/integrations/openai') {
      body = { enabled: false, hasApiKey: false, baseUrl: null, defaultModel: null, auditInstructions: null, healthStatus: 'unknown', healthMessage: null, lastCheckedAt: null, updatedAt: null }
    } else if (path === '/api/v1/integrations') body = []
    else if (path.includes('/preferences')) body = null
    else body = []
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.on('pageerror', (error) => anomalies.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') anomalies.push(message.text()) })
  await page.goto(`${FRONTEND}/admin/integrations`, { waitUntil: 'networkidle' })
  const card = page.getByTestId('oidc-integration-card')
  await card.waitFor()
  await card.locator('summary').first().focus()
  await page.keyboard.press('Enter')
  await card.getByTestId('oidc-issuer').locator('input').waitFor()

  const callback = await card.locator('input[readonly]').inputValue()
  if (callback !== `${FRONTEND}/auth/oidc/callback`) throw new Error(`Callback incorreta: ${callback}`)
  const placeholder = await card.getByTestId('oidc-client-secret').locator('input').getAttribute('placeholder')
  if (!placeholder?.includes('•••••••')) throw new Error('Segredo existente não foi sinalizado sem exposição')

  await card.getByTestId('oidc-issuer').locator('input').fill('https://login.microsoftonline.com/common/v2.0')
  await card.getByText(/Tenant ID.*GUID|GUID Tenant ID/i).waitFor()
  await card.getByRole('button', { name: /^Salvar$|^Save$/ }).click()
  await page.locator('.n-message').getByText(/Tenant ID.*GUID|GUID Tenant ID/i).waitFor()
  if (updates.length !== 0) throw new Error('Issuer Entra multitenant inválido foi enviado à API')

  await card.getByTestId('oidc-issuer').locator('input').fill('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0')
  await card.getByTestId('oidc-entra-guidance').waitFor()
  const autoProvisionCheckbox = card.getByRole('checkbox', { name: /Auto-provisionar|Auto-provision/ })
  const autoProvisionDisabled = await autoProvisionCheckbox.evaluate((element) => (
    element.hasAttribute('disabled')
      || element.getAttribute('aria-disabled') === 'true'
      || element.closest('.n-checkbox')?.classList.contains('n-checkbox--disabled') === true
  ))
  if (!autoProvisionDisabled) throw new Error('JIT por e-mail permaneceu disponível para Microsoft Entra ID')

  await card.getByTestId('oidc-name').locator('input').fill('SSO Entra corporativo')
  await card.getByTestId('oidc-domains').locator('input').fill('EXAMPLE.TEST, subsidiary.test, EXAMPLE.TEST')
  await card.getByRole('checkbox', { name: /Exigir evidência de MFA|Require MFA evidence/ }).check()
  await card.getByTestId('oidc-accepted-amr').locator('input').fill('MFA, otp, MFA')
  await card.getByTestId('oidc-accepted-acr').locator('input').fill('urn:example:mfa')
  await card.locator('.n-switch').click()
  await card.getByRole('button', { name: /^Salvar$|^Save$/ }).click()
  await page.locator('.n-message').getByText(/Configuração OIDC salva|OIDC configuration saved/i).waitFor()
  if (updates.length !== 1 || 'clientSecret' in updates[0]) throw new Error('Atualização expôs ou duplicou client secret')
  if (!updates[0].enabled || updates[0].name !== 'SSO Entra corporativo') throw new Error('Estado OIDC incorreto no payload')
  if (updates[0].autoProvision !== false) throw new Error('Auto-provisionamento inseguro foi enviado para Microsoft Entra ID')
  if (updates[0].allowedDomains.join(',') !== 'EXAMPLE.TEST,subsidiary.test') throw new Error('Lista de domínios não foi normalizada')
  if (!updates[0].requireMfaClaim || updates[0].acceptedAmrValues.join(',') !== 'MFA,otp' || updates[0].acceptedAcrValues[0] !== 'urn:example:mfa') throw new Error('Garantia MFA OIDC não foi persistida corretamente')

  await card.getByTestId('oidc-issuer').locator('input').fill('https://dev-12345678.okta.com/oauth2/default')
  await card.getByTestId('oidc-scopes').locator('input').fill('openid, profile, email')
  await card.getByTestId('oidc-okta-guidance').waitFor()
  await card.getByText(/scope groups|groups scope/i).waitFor()
  await card.getByTestId('oidc-scopes').locator('input').fill('openid, profile, email, groups')
  await card.getByText(/scope groups|groups scope/i).waitFor({ state: 'hidden' })

  const policyCard = page.getByTestId('tenant-auth-policy-card')
  await policyCard.locator('summary').focus()
  await page.keyboard.press('Enter')
  const requiredSso = policyCard.getByRole('switch', { name: /Exigir SSO|Require SSO/ })
  const localLogin = policyCard.getByRole('switch', { name: /Permitir login local|Allow local sign-in/ })
  const localLoginGuarded = await localLogin.evaluate((element) => (
    element.getAttribute('aria-disabled') === 'true' || element.classList.contains('n-switch--disabled')
  ))
  const ssoGuarded = await requiredSso.evaluate((element) => (
    element.getAttribute('aria-disabled') === 'true' || element.classList.contains('n-switch--disabled')
  ))
  if (!ssoGuarded || !localLoginGuarded || await requiredSso.getAttribute('aria-checked') !== 'false') {
    throw new Error('SSO obrigatório foi habilitado sem break-glass')
  }
  await policyCard.locator('input[autocomplete="username"]').fill('rescue@example.test')
  await policyCard.locator('input[autocomplete="current-password"]').fill('temporary-validation-secret')
  await policyCard.getByRole('button', { name: /Validar conta|Validate account/ }).click()
  await page.locator('.n-message').getByText(/Conta break-glass validada|Break-glass account validated/i).waitFor()
  if (breakGlassValidations.length !== 1 || breakGlassValidations[0].password !== 'temporary-validation-secret') {
    throw new Error('Credenciais break-glass não foram enviadas ao endpoint dedicado')
  }
  if (await policyCard.locator('input[autocomplete="current-password"]').inputValue()) {
    throw new Error('Senha break-glass permaneceu no formulário após validação')
  }
  const localLoginStillGuarded = await localLogin.evaluate((element) => (
    element.getAttribute('aria-disabled') === 'true' || element.classList.contains('n-switch--disabled')
  ))
  if (localLoginStillGuarded) throw new Error('Controle de login local permaneceu bloqueado após break-glass')
  await requiredSso.click()
  await policyCard.getByRole('switch', { name: /Provisionamento JIT|JIT provisioning/ }).click()
  await policyCard.locator('.n-input-number input').first().fill('50')
  await policyCard.getByRole('button', { name: /^Salvar$|^Save$/ }).click()
  await page.locator('.n-message').getByText(/Política de autenticação salva|Authentication policy saved/i).waitFor()
  if (policyUpdates.length !== 1 || policyUpdates[0].ssoRequired !== true || policyUpdates[0].jitProvisioningEnabled !== true || 'password' in policyUpdates[0]) {
    throw new Error('Política administrativa enviou estado inseguro ou incorreto')
  }

  await card.locator('summary').nth(1).click()
  await card.getByText('user@example.test', { exact: true }).first().waitFor()
  await card.getByRole('button', { name: /Revogar vínculo de user@example.test|Revoke identity link for user@example.test/ }).click()
  const revokeDialog = page.getByRole('dialog')
  await revokeDialog.getByRole('button', { name: /Revogar vínculo|Revoke link/ }).click()
  await page.locator('.n-message').getByText(/Vínculo OIDC revogado|OIDC identity link revoked/i).waitFor()
  if (revokedIdentities.length !== 1 || revokedIdentities[0] !== 31) throw new Error('Revogação OIDC não foi enviada ao vínculo correto')
  await card.locator('.n-tag__content').filter({ hasText: /^(Revogado|Revoked)$/ }).waitFor()

  await page.setViewportSize({ width: 360, height: 740 })
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }))
  if (width.scroll > width.inner) throw new Error('Configuração OIDC possui overflow horizontal no mobile')
  if (anomalies.length) throw new Error(`Anomalias do navegador: ${anomalies.join('; ')}`)
  console.log(JSON.stringify({ changeId: 'NA-0019', result: 'passed', callbackUrl: true, secretPreserved: true, keyboardExpanded: true, entraIssuerGuarded: true, entraProvisioningGuarded: true, oktaGuidance: true, oktaGroupsScopeGuidance: true, updateValidated: true, mandatorySsoGuarded: true, localLoginGuarded: true, breakGlassValidated: true, breakGlassPasswordCleared: true, policyUpdateValidated: true, identityRevocationValidated: true, mobileNoOverflow: true, browserAnomalies: anomalies }, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
