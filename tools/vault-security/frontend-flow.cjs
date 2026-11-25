const { join } = require('node:path')
const { writeFileSync } = require('node:fs')
async function bounded(operation, message) {
  let timer
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 8000) })]) }
  finally { clearTimeout(timer) }
}
function check(condition, message) { if (!condition) throw new Error(message) }
async function eventually(predicate, message, timeout = 15000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 40)) }
  throw new Error(message)
}
const metadata = { id: 1, alias: 'database', tenantId: 7, description: 'Synthetic fixture', scope: 'PERSONAL', ownerUserId: 41,
  groupId: null, createdByUserId: 41, createdByUsername: 'Operator', source: 'MANUAL', usageCount: 0,
  createdAt: '2026-11-16T12:00:00Z', updatedAt: '2026-11-16T12:00:00Z', rotatedAt: null, revokedAt: null }
async function runVaultFrontendFlow(browser, base, fixture, output) {
  const scenarios = [], contexts = new Set()
  async function setup({ clipboard = true, mobile = false } = {}) {
    fixture.reset()
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', locale: 'pt-BR', viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 } })
    contexts.add(context)
    if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    await context.addInitScript(({ access, refresh }) => {
      localStorage.setItem('na_access_token', access); localStorage.setItem('na_refresh_token', refresh)
    }, { access: fixture.accessToken, refresh: fixture.refreshToken })
    const requests = [], errors = []
    await context.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/v1/vault-security/')) return route.continue()
      let body = {}
      if (path.endsWith('/features')) body = { secretsLicensed: true, secrets: true }
      else if (path === '/api/v1/secrets') body = [metadata]
      else if (path === '/api/v1/pem-keys') body = [{ id: 1, name: 'gateway', createdById: 73, createdByName: 'pem-owner-fixture', createdAt: metadata.createdAt, hasPassphrase: false }]
      else if (path.endsWith('/groups')) body = []
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', () => errors.push('pageerror'))
    page.on('request', request => { requests.push(new URL(request.url()).pathname) })
    await page.goto(`${base}/vault`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('vault-delivery-panel').waitFor()
    await page.getByRole('button', { name: 'Revelar senha: database', exact: true }).waitFor()
    check(await page.evaluate(() => isSecureContext && location.protocol === 'https:'), 'Browser is not in HTTPS secure context')
    const value = page.getByTestId('vault-revealed-value')
    const open = action => page.getByRole('button', { name: `${action === 'copy' ? 'Copiar' : 'Revelar'} senha: database`, exact: true }).click()
    const unlock = async (password = fixture.password) => {
      await page.getByLabel('Senha NodeAccess', { exact: true }).fill(password)
      await page.getByLabel('Código do autenticador (6 dígitos)', { exact: true }).fill(fixture.token())
      await page.getByRole('button', { name: 'Desbloquear e continuar', exact: true }).click()
    }
    const visible = async () => { await value.waitFor(); check(await value.textContent() === fixture.value, 'Decrypted value differs from synthetic fixture') }
    const noValue = async () => {
      await value.waitFor({ state: 'hidden' })
      check(!(await page.locator('body').textContent()).includes(fixture.value), 'Discarded value remains in DOM')
    }
    const assertPrivate = async () => {
      const responses = fixture.responses(), capabilities = responses.flatMap(response => response.capabilities)
      check(responses.every(response => !response.plaintext), 'Plaintext appeared in real Vault HTTP payload')
      check(responses.filter(response => response.status === 200).every(response => response.noStore), 'Real Vault success lacks no-store')
      writeFileSync(join(output, 'flow-stage.json'), JSON.stringify({ stage: 'inspect-browser-storage-and-pinia' }), { mode: 0o600 })
      const stored = await bounded(page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage },
        pinia: document.querySelector('#app').__vue_app__.config.globalProperties.$pinia.state.value })), 'Inspect browser storage/Pinia timed out')
      check(![fixture.value, fixture.password, ...capabilities].some(value => stored.includes(value)), 'Vault material persisted outside page-local state')
      check(!requests.some(path => /\/auth\/(refresh|logout)/.test(path)), 'Vault invoked global authentication side effect')
      check(await page.evaluate(() => localStorage.getItem('na_access_token')) === fixture.accessToken, 'Central access token was changed')
      check(errors.length === 0, 'Browser runtime or private-response invariant failed')
    }
    return { context, page, requests, open, unlock, visible, noValue, assertPrivate,
      releaseCount: () => fixture.events().filter(event => event.type === 'DELIVERY_RELEASE_COMMITTED').length,
      close: async () => { await context.close(); contexts.delete(context) } }
  }
  async function scenario(name, run, options) {
    writeFileSync(join(output, 'flow-progress.json'), JSON.stringify({ running: name, passed: scenarios }), { mode: 0o600 })
    const h = await setup(options)
    try { await run(h); scenarios.push(name) } catch (error) { throw new Error(`${name}: ${error.message}`) } finally { await h.close() }
  }
  try {
    await scenario('HTTPS, real bcrypt/TOTP/JWE, failed password, explicit hide and memory-only capabilities', async h => {
      await h.page.locator('[data-vault-id="pem:1"]').getByText('Proprietário: pem-owner-fixture (#73)', { exact: true }).waitFor()
      await h.open('reveal'); await h.unlock('incorrect-synthetic-password')
      await h.page.getByRole('alert').filter({ hasText: 'Não foi possível confirmar sua identidade' }).waitFor(); check(h.releaseCount() === 0, 'Wrong password authorized a release')
      await h.unlock(); await h.visible(); check(h.releaseCount() === 1, 'Reveal did not commit exactly one release')
      check(await h.page.locator('#vault-unlock-password').count() === 0, 'Password form remains after unlock')
      await h.page.getByRole('button', { name: 'Ocultar senha', exact: true }).click(); await h.noValue(); await h.assertPrivate()
    })
    await scenario('Reveal expires within fifteen seconds without another server delivery', async h => {
      await h.open('reveal'); await h.unlock(); await h.visible()
      await h.page.getByTestId('vault-revealed-value').waitFor({ state: 'hidden', timeout: 16500 })
      await h.noValue(); check(h.releaseCount() === 1, 'Reveal expiry retried delivery'); await h.assertPrivate()
    })
    await scenario('Real Chromium clipboard allowed; separate copy grant and second explicit gesture', async h => {
      await h.open('copy'); await h.unlock()
      await h.page.getByRole('button', { name: 'Confirmar cópia', exact: true }).waitFor(); await h.noValue()
      check(h.releaseCount() === 1, 'Copy did not consume one independent grant')
      await h.page.getByRole('button', { name: 'Confirmar cópia', exact: true }).click()
      await h.page.getByText('Senha copiada. Gerencie a área de transferência do seu dispositivo.', { exact: true }).waitFor()
      check(await h.page.evaluate(() => navigator.clipboard.readText()) === fixture.value, 'Real clipboard did not receive the value')
      await h.noValue(); await h.assertPrivate()
    })
    await scenario('Real Chromium clipboard permission denied discards copy buffer', async h => {
      const cdp = await h.context.newCDPSession(h.page), { targetInfo } = await cdp.send('Target.getTargetInfo')
      await cdp.send('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'denied', origin: base, browserContextId: targetInfo.browserContextId })
      await cdp.send('Browser.setPermission', { permission: { name: 'clipboard-write', allowWithoutSanitization: true }, setting: 'denied', origin: base, browserContextId: targetInfo.browserContextId })
      check(await h.page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-write' })).state) === 'denied', 'Clipboard denial was not applied by Chromium')
      await h.open('copy'); await h.unlock(); await h.page.getByRole('button', { name: 'Confirmar cópia', exact: true }).click()
      await h.page.getByRole('alert').filter({ hasText: 'Não foi possível confirmar a cópia' }).waitFor()
      await h.noValue(); check(await h.page.getByRole('button', { name: 'Confirmar cópia', exact: true }).count() === 0, 'Denied copy can replay buffer')
      await h.assertPrivate(); await cdp.detach()
    }, { clipboard: false })
    for (const event of ['blur', 'pagehide', 'hidden', 'tenant-event']) await scenario(`Immediate discard on dispatched ${event} browser lifecycle signal`, async h => {
      await h.open('reveal'); await h.unlock(); await h.visible()
      await h.page.evaluate(event => {
        if (event === 'hidden') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) }
        else window.dispatchEvent(new Event(event === 'tenant-event' ? 'nodeaccess:tenant-context-changed' : event))
      }, event)
      await h.noValue(); await h.page.getByText('Cofre bloqueado', { exact: true }).waitFor(); await h.assertPrivate()
    })
    await scenario('Manual lock invalidates the vault session without portal logout', async h => {
      await h.open('reveal'); await h.unlock(); await h.visible()
      await h.page.getByRole('button', { name: 'Fechar', exact: true }).click()
      await h.page.getByRole('button', { name: 'Bloquear cofre', exact: true }).click()
      await h.noValue(); await h.open('reveal'); await h.page.locator('#vault-unlock-password').waitFor(); await h.assertPrivate()
    })
    for (const status of [401, 403, 409, 423, 429, 503]) await scenario(`Operation HTTP ${status} stays local and never retries consume or refresh`, async h => {
      await h.context.route('**/api/v1/vault-security/operations', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_FAULT' }) }))
      await h.open('reveal'); await h.unlock(); await h.page.getByRole('alert').waitFor(); await h.noValue()
      check(h.requests.filter(path => path.endsWith('/vault-security/operations')).length === 1, 'Authorization automatically retried')
      check(h.releaseCount() === 0, 'Failed authorization released a value'); await h.assertPrivate()
    })
    for (const interruption of ['blur', 'tenant', 'timeout']) await scenario(`Committed consume with delayed response: ${interruption} discards late delivery`, async h => {
      let release, arrived = false, finished
      const held = new Promise(resolve => { release = resolve })
      await h.context.route('**/api/v1/vault-security/operations/consume', async route => {
        const response = await route.fetch(); arrived = true
        finished = held.then(async () => { try { await route.fulfill({ response }) } catch { /* Browser aborted after clearing page-local state. */ } })
        await finished
      })
      await h.open('reveal'); await h.unlock()
      await eventually(() => arrived, 'Consume response did not reach deterministic barrier')
      check(h.releaseCount() === 1, 'Barrier did not hold an already committed real consume')
      if (interruption === 'timeout') await h.page.getByRole('alert').waitFor({ timeout: 10000 })
      else if (interruption === 'tenant') await h.page.evaluate(token => {
        document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth').completeLogin(token, 'synthetic-other-refresh')
      }, fixture.alternateAccessToken())
      else await h.page.evaluate(() => window.dispatchEvent(new Event('blur')))
      release(); await finished; await h.noValue()
      check(h.requests.filter(path => path.endsWith('/operations/consume')).length === 1, 'Lost consume response was retried')
      if (interruption !== 'tenant') await h.assertPrivate()
      else check(!(await h.page.locator('body').textContent()).includes(fixture.value), 'Previous tenant received late plaintext')
    })
    await scenario('Mobile unlock dialog fits viewport; secret absent from screenshot and PEM actions', async h => {
      await h.open('reveal'); await h.page.getByRole('dialog').waitFor()
      const bounds = await h.page.getByRole('dialog').boundingBox()
      check(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Unlock dialog overflows mobile viewport')
      check(await h.page.locator('[data-vault-id="pem:1"]').getByRole('button', { name: /Revelar senha|Copiar senha/ }).count() === 0, 'PEM exposes delivery actions')
      await h.page.screenshot({ path: join(output, 'mobile-locked.png'), fullPage: true, animations: 'disabled' }); await h.assertPrivate()
    }, { mobile: true })
    return { status: 'passed', scenarios, count: scenarios.length }
  } finally { await Promise.allSettled([...contexts].map(context => context.close())) }
}
async function runVaultHttpBoundary(browser, base, fixture, output) {
  check(new URL(base).protocol === 'http:', 'HTTP boundary requires a non-TLS browser origin')
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'pt-BR', viewport: { width: 1360, height: 900 } })
  let vaultRequests = 0
  try {
    await context.addInitScript(({ access, refresh }) => {
      localStorage.setItem('na_access_token', access); localStorage.setItem('na_refresh_token', refresh)
    }, { access: fixture.accessToken, refresh: fixture.refreshToken })
    await context.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path.startsWith('/api/v1/vault-security/')) vaultRequests++
      const body = path.endsWith('/features') ? { secretsLicensed: true, secrets: true }
        : path === '/api/v1/secrets' ? [metadata] : path === '/api/v1/pem-keys' || path.endsWith('/groups') ? [] : {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    await page.goto(`${base}/vault`, { waitUntil: 'networkidle' })
    await page.getByRole('alert').filter({ hasText: 'HTTPS' }).waitFor()
    for (const name of ['Revelar senha: database', 'Copiar senha: database']) {
      const button = page.getByRole('button', { name, exact: true })
      check(await button.isDisabled(), 'HTTP exposes an enabled secret-delivery action')
      await button.evaluate(element => element.click())
    }
    check(vaultRequests === 0, 'HTTP dispatched a Vault API request despite the disabled actions')
    check(await page.getByRole('dialog').count() === 0, 'HTTP opened a secret-delivery dialog')
    await page.screenshot({ path: join(output, 'http-blocked.png'), fullPage: true, animations: 'disabled' })
    return { status: 'passed', reasonVisible: true, revealDisabled: true, copyDisabled: true, vaultRequests }
  } finally { await context.close() }
}
module.exports = { runVaultFrontendFlow, runVaultHttpBoundary }
