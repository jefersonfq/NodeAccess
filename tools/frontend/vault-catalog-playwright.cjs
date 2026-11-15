#!/usr/bin/env node
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { artifactPath } = require('../shared/private-artifacts.cjs')
const { harnessEndpoint } = require('../shared/harness-endpoint.cjs')
const now = '2026-11-15T12:00:00Z'
const secret = (id, alias, extra = {}) => ({ id, alias, tenantId: 7, description: 'Synthetic fixture', scope: 'PERSONAL', ownerUserId: 41, groupId: null, createdByUserId: 41, createdByUsername: 'Operator', source: 'MANUAL', usageCount: 2, createdAt: now, updatedAt: now, rotatedAt: null, revokedAt: null, ...extra })
const pem = (id, name) => ({ id, name, createdById: 41, createdAt: now, hasPassphrase: false })
const sensitive = 'Synthetic-only-Never-persist-7!'
async function runVaultFlow(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, serviceWorkers: 'block', locale: 'pt-BR' })
  const payload = { sub: '41', tenantId: 7, name: 'Operator', role: 'admin', stage: 'authenticated', exp: 4102444800 }
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`
  await context.addInitScript(token => { if (!localStorage.getItem('na_access_token')) localStorage.setItem('na_access_token', token) }, token)
  let secrets = [secret(1, 'database')], keys = [pem(1, 'gateway')]
  const requests = [], errors = []
  const state = { offline: false, licensed: true, failSave: false }
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname, method = req.method()
    requests.push({ path, method, body: method === 'GET' ? undefined : req.postDataJSON() })
    let body = {}, status = 200
    if (path.endsWith('/features')) body = { secretsLicensed: state.licensed, secrets: state.licensed }
    else if (path.endsWith('/groups')) body = [{ id: 8, name: 'Operations' }]
    else if (path === '/api/v1/secrets') {
      if (method === 'GET') { body = secrets; if (state.offline) { status = 503; body = { message: 'Offline fixture' } } }
      else if (state.failSave) { status = 400; body = { message: 'Synthetic save failure' } }
      else { body = secret(2, req.postDataJSON().alias); secrets.push(body) }
    } else if (/\/secrets\/\d+\/consumers$/.test(path)) body = { hostCount: 1, hosts: [{ id: 11, name: 'Fixture host', sshUser: 'ops' }], snippetCount: 1, snippets: [{ id: 12, name: 'Fixture snippet' }] }
    else if (/\/secrets\/\d+/.test(path)) {
      const row = secrets.find(item => item.id === Number(path.split('/')[4]))
      if (path.endsWith('/rotate')) row.rotatedAt = now
      else if (path.endsWith('/revoke')) row.revokedAt = now
      else if (method === 'DELETE') secrets = secrets.filter(item => item !== row)
      else Object.assign(row, req.postDataJSON())
      body = row
    } else if (path === '/api/v1/pem-keys') {
      if (method === 'GET') body = keys
      else { body = pem(2, req.postDataJSON().name); keys.push(body) }
    } else if (/\/pem-keys\/\d+/.test(path)) {
      const row = keys.find(item => item.id === Number(path.split('/')[4]))
      if (method === 'DELETE') keys = keys.filter(item => item !== row)
      else row.hasPassphrase = !!req.postDataJSON().passphrase
      body = row
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body ?? {}) })
  })
  const page = await context.newPage()
  if (process.env.BROWSER_COVERAGE_DIR) await require('../coverage/playwright-coverage.cjs').attachBrowserCoverage(page, browser)
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000)
  const row = key => page.locator(`[data-vault-id="${key}"]`)
  const action = async (key, label) => { await row(key).getByRole('button').click(); await page.locator('.n-dropdown-option').getByText(label).click() }
  const close = async () => { await page.keyboard.press('Escape'); await page.locator('.n-modal').waitFor({ state: 'hidden' }) }
  try {
    await page.goto(`${base}/vault`, { waitUntil: 'networkidle' })
    await row('secret:1').waitFor(); await row('pem:1').waitFor()
    await page.getByPlaceholder('Buscar por nome, alias ou descrição').fill('GATEWAY')
    await row('secret:1').waitFor({ state: 'hidden' }); await row('pem:1').waitFor()
    await page.getByPlaceholder('Buscar por nome, alias ou descrição').fill('missing')
    await page.getByText('Nenhum registro corresponde aos filtros.').waitFor()
    await page.getByPlaceholder('Buscar por nome, alias ou descrição').fill('')
    await action('secret:1', /^Usos/); await page.getByText('Fixture snippet', { exact: true }).waitFor(); await page.getByText('Fixture host', { exact: true }).waitFor(); await close()
    await action('secret:1', /^Editar$/)
    await page.getByPlaceholder('mysql-root-prod').fill('database-updated')
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await row('secret:1').getByText('database-updated', { exact: true }).waitFor()
    const edit = requests.find(r => r.method === 'PATCH' && r.path === '/api/v1/secrets/1')
    assert.ok(edit); assert.equal('value' in edit.body, false)
    await action('secret:1', /^Rotacionar$/)
    await page.getByPlaceholder('Cole o novo valor', { exact: true }).fill(sensitive)
    await page.locator('.n-modal').getByRole('button', { name: 'Rotacionar', exact: true }).click()
    await page.locator('.n-modal').waitFor({ state: 'hidden' })
    await action('secret:1', /^Revogar$/); await page.locator('.n-dialog').getByRole('button', { name: 'Revogar', exact: true }).click()
    await row('secret:1').getByText('Revogado', { exact: true }).waitFor()
    await action('secret:1', /^Excluir$/); await page.getByRole('button', { name: 'Excluir definitivamente', exact: true }).click(); await row('secret:1').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Novo secret', exact: true }).click()
    await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await page.getByText('Informe o alias do secret', { exact: true }).waitFor()
    await page.getByPlaceholder('mysql-root-prod').fill('created-fixture')
    await page.getByPlaceholder('Cole o valor uma única vez').fill(sensitive)
    state.failSave = true; await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await page.getByText('Synthetic save failure', { exact: true }).waitFor()
    state.failSave = false; await page.getByRole('button', { name: 'Salvar', exact: true }).click(); await row('secret:2').waitFor()
    await page.getByRole('button', { name: 'Importar chave PEM', exact: true }).click()
    await page.evaluate(() => {
      const original = File.prototype.text
      File.prototype.text = function () { if (this.name !== 'old.pem') return original.call(this); return new Promise(resolve => { window.resolveOldPem = resolve }) }
    })
    await page.locator('input[type=file]').setInputFiles({ name: 'old.pem', mimeType: 'text/plain', buffer: Buffer.from('OLD SYNTHETIC') })
    await page.locator('.n-modal').getByRole('button', { name: 'Cancelar', exact: true }).click()
    await page.getByRole('button', { name: 'Importar chave PEM', exact: true }).click()
    await page.evaluate(() => window.resolveOldPem('OLD SYNTHETIC'))
    assert.equal(await page.locator('.n-modal textarea').inputValue(), '')
    await page.locator('input[type=file]').setInputFiles({ name: 'imported-fixture.pem', mimeType: 'text/plain', buffer: Buffer.from('-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----') })
    await page.getByRole('button', { name: 'Salvar chave', exact: true }).click(); await row('pem:2').waitFor()
    await action('pem:2', /senha/)
    await page.locator('.n-modal input[type=password]').fill(sensitive)
    await page.getByRole('button', { name: 'Validar e salvar', exact: true }).click()
    await row('pem:2').getByText('Com senha da chave', { exact: true }).waitFor()
    await action('pem:2', /^Excluir$/); await page.locator('.n-dialog').getByRole('button', { name: 'Excluir', exact: true }).click(); await row('pem:2').waitFor({ state: 'hidden' })
    assert.equal(JSON.stringify(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, inputs: [...document.querySelectorAll('input, textarea')].map(e => e.value) }))).includes(sensitive), false)
    await page.locator('.n-dialog').waitFor({ state: 'hidden' })
    await page.locator('.n-message').first().waitFor({ state: 'hidden' })
    await page.screenshot({ path: artifactPath('vault-desktop.png', process.env.VAULT_REVIEW_OUTPUT), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    await page.screenshot({ path: artifactPath('vault-mobile.png', process.env.VAULT_REVIEW_OUTPUT), fullPage: true })
    state.offline = true; await page.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await page.getByText('Não foi possível carregar todo o cofre', { exact: true }).waitFor(); await row('pem:1').waitFor()
    state.offline = false; await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await row('secret:2').waitFor()
    // Full navigation resets feature caches; an unlicensed source must issue no Secrets request.
    state.licensed = false; const before = requests.filter(r => r.path === '/api/v1/secrets' && r.method === 'GET').length
    await page.reload({ waitUntil: 'networkidle' }); await row('pem:1').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Novo secret', exact: true }).count(), 0)
    assert.equal(requests.filter(r => r.path === '/api/v1/secrets' && r.method === 'GET').length, before)
    state.licensed = true
    secrets = [secret(2, 'created-fixture', { ownerUserId: 99, createdByUserId: 99, scope: 'GROUP', groupId: 8 })]
    const userToken = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...payload, role: 'user', canManageHosts: false })).toString('base64url')}.fixture`
    await page.evaluate(value => localStorage.setItem('na_access_token', value), userToken)
    await page.reload({ waitUntil: 'networkidle' }); await row('secret:2').waitFor()
    assert.equal(await row('secret:2').getByRole('button').isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Importar chave PEM', exact: true }).count(), 0)
    await page.evaluate(value => localStorage.setItem('na_access_token', value), token)
    // Legacy deep links remain operable with the extracted editors.
    state.licensed = true; await page.goto(`${base}/secrets`, { waitUntil: 'networkidle' }); await page.getByText('created-fixture', { exact: true }).waitFor()
    await page.goto(`${base}/pem-keys`, { waitUntil: 'networkidle' }); await page.getByText('gateway', { exact: true }).waitFor()
    // Exercise existing auth action without navigation: watchers must discard open drafts.
    const otherToken = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...payload, tenantId: 8 })).toString('base64url')}.fixture`
    const switchContext = async value => page.evaluate(value => {
      const auth = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth')
      auth.completeLogin(value, 'fixture-refresh')
    }, value)
    for (const path of ['/vault', '/secrets', '/pem-keys']) {
      secrets = [secret(2, 'created-fixture')]; keys = [pem(1, 'gateway')]
      await switchContext(token)
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
      if (path === '/pem-keys') {
        await page.getByRole('button', { name: /Adicionar chave|Nova chave/ }).click()
        await page.locator('.n-modal textarea').fill(sensitive)
      } else {
        await page.getByRole('button', { name: /Novo secret/ }).click()
        await page.getByPlaceholder('Cole o valor uma única vez').fill(sensitive)
      }
      secrets = [secret(3, 'other-context', { tenantId: 8 })]; keys = [pem(3, 'other-gateway')]
      await switchContext(otherToken)
      await page.locator('.n-modal').waitFor({ state: 'hidden' })
      await page.getByText(path === '/pem-keys' ? 'other-gateway' : 'other-context', { exact: true }).waitFor()
      assert.equal(await page.getByText('created-fixture', { exact: true }).count(), 0)
      assert.equal(await page.evaluate(value => [...document.querySelectorAll('input,textarea')].some(node => node.value === value), sensitive), false)
    }
    assert.deepEqual(errors, [])
    return { status: 'passed', scenarios: ['typed identities/search/empty', 'consumers', 'edit without value', 'rotate/revoke/delete', 'create validation and recovery', 'PEM file/import/passphrase/delete', 'no browser persistence', 'desktop/mobile', 'partial failure/retry', 'license blocks dispatch', 'legacy routes', 'read-only ACL', 'same-instance tenant switch clears drafts on all routes', 'late PEM file discarded'] }
  } finally { await context.close() }
}
module.exports = { runVaultFlow }
if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  try { console.log(JSON.stringify(await runVaultFlow(browser, harnessEndpoint(process.env.FRONTEND_BASE || 'http://127.0.0.1:5199')))) } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
