const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright')
const { installRoutes, authenticate } = require('../frontend/session-playback-playwright.cjs')
const { settings, navigationFixture } = require('../frontend/sonar-flow-fixtures.cjs')
const { artifactPath } = require('../shared/private-artifacts.cjs')

test('TACACS TLS configuration explains compatibility and validates certificate identity on desktop/mobile', {
  skip: process.env.RUN_TACACS_TLS_UX !== 'true', timeout: 120000,
}, async () => {
  const base = process.env.FRONTEND_BASE
  assert.ok(base && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use a disposable local frontend')
  const output = process.env.TACACS_TLS_UX_OUTPUT || mkdtempSync(join(tmpdir(), 'nodeaccess-tacacs-tls-ux-'))
  artifactPath('report.json', output)
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  const report = { checks: [], captureRunId: process.env.BROWSER_COVERAGE_RUN_ID, output, transport: 'intercepted API, actual Vue/Chromium; no device or daemon configured' }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await installRoutes(context)
    const overview = { settings: { defaultProfile: 'server_ssh', tacacsEnabled: false }, devices: [], credentials: [], grants: [], events: [] }
    let failLoad = true, failSave = false
    const writes = []
    await context.route('**/api/v1/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      let body = navigationFixture(path)
      if (path === '/api/v1/settings') body = settings
      if (path === '/api/v1/hosts') body = { data: [{ id: 9, name: 'Switch sintético', ip: '192.0.2.9' }], total: 1 }
      if (path === '/api/v1/network-access/health') body = { status: 'disabled', instances: [] }
      if (path === '/api/v1/network-access') {
        if (failLoad) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"fixture load failure"}' })
        body = overview
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        if (!path.startsWith('/api/v1/network-access/')) return route.fulfill({ status: 403, body: 'Fixture blocks all other writes' })
        writes.push({ path, method: request.method(), query: new URL(request.url()).search, body: request.postDataJSON() })
        if (failSave) return route.fulfill({ status: 503, contentType: 'application/json', body: failSave === 'generic' ? '{"message":{"code":"UNAVAILABLE"}}' : '{"message":"Não foi possível salvar o certificado de teste"}' })
        if (request.method() === 'DELETE') {
          if (path.includes('/credentials/')) overview.credentials = []
          if (path.includes('/grants/')) overview.grants = []
          if (path.includes('/devices/')) overview.devices = []
        }
        if (path.endsWith('/credentials')) overview.credentials = [{ name: 'Operador de teste', ...request.postDataJSON() }]
        if (path.endsWith('/grants')) overview.grants = [request.postDataJSON()]
        if (path.endsWith('/devices')) overview.devices = [{ id: 8, name: 'Switch sintético', ...request.postDataJSON() }]
        if (path.endsWith('/settings')) overview.settings = request.postDataJSON()
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage(), errors = []
    if (process.env.BROWSER_COVERAGE_DIR) await require('../coverage/playwright-coverage.cjs').attachBrowserCoverage(page, browser)
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await authenticate(page)
    await context.addInitScript(() => localStorage.setItem('nodeaccess_locale', 'pt-BR'))
    await page.goto(`${base}/admin/integrations?section=network-access`)
    const notice = page.getByTestId('tacacs-tls-compatibility')
    await notice.waitFor()
    assert.match(await notice.innerText(), /legado não é suportado.*MD5/s)
    await page.getByText('Não foi possível carregar a configuração de rede.', { exact: true }).waitFor()
    failLoad = false
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click()
    const card = page.getByTestId('network-access-settings')
    await card.getByText('Nenhum equipamento autorizado a consultar o serviço.', { exact: true }).waitFor()
    assert.equal(await card.getByLabel('Segredo compartilhado', { exact: true }).count(), 0)
    report.checks.push('Compatibility notice persists during load error/retry; empty state and no legacy secret input')

    overview.devices = [{ id: 8, hostId: 9, name: 'Switch sintético', sourceIp: '192.0.2.9', certificateFingerprintSha256: null, enabled: false }]
    await card.getByRole('button', { name: 'Atualizar', exact: true }).click()
    await card.getByText('Certificado não cadastrado — acesso bloqueado', { exact: false }).waitFor()
    await card.getByRole('button', { name: 'Editar', exact: true }).click()
    const fingerprint = card.getByLabel('Impressão SHA-256 do certificado', { exact: true })
    const save = card.getByRole('button', { name: 'Salvar equipamento e certificado', exact: true })
    for (const invalid of ['a'.repeat(63), 'g'.repeat(64), 'a:'.repeat(32), '-----BEGIN CERTIFICATE-----']) {
      await fingerprint.fill(invalid)
      assert.equal(await save.isDisabled(), true)
    }
    assert.equal(writes.length, 0)
    const pin = Array.from({ length: 32 }, () => 'AB').join(':')
    await fingerprint.fill(pin)
    assert.equal(await save.isEnabled(), true)
    await save.click()
    await page.getByText('Configuração salva e registrada na auditoria.', { exact: true }).waitFor()
    await page.waitForFunction(() => document.body.textContent.includes('Desabilitado'))
    assert.equal(writes[0].body.certificateFingerprintSha256, pin)
    assert.equal(writes[0].body.enabled, false, 'Editing a legacy record must not enable it implicitly')
    assert.equal('secret' in writes[0].body, false)
    await card.getByLabel('Permitir consultas deste equipamento', { exact: true }).click()
    await save.click()
    await card.getByText('Autorizado com certificado', { exact: false }).waitFor()
    assert.equal(writes[1].body.enabled, true)
    report.checks.push('Invalid/PEM fingerprints cannot save; valid colon-separated pin saves; legacy record requires explicit enable; payload has no shared secret')

    failSave = true
    await fingerprint.fill('cd'.repeat(32))
    await save.click()
    await page.getByText('Não foi possível salvar o certificado de teste', { exact: true }).waitFor()
    assert.equal(await fingerprint.inputValue(), 'cd'.repeat(32))
    failSave = false
    await card.getByLabel('Ativar TACACS+ do cliente', { exact: true }).click()
    await card.getByRole('button', { name: 'Salvar configuração', exact: true }).click()
    await page.getByText('Ativar TACACS+ deste cliente?', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.n-message').length === 0)
    await page.getByText('Ativar TACACS+ deste cliente?', { exact: true }).waitFor({ state: 'visible' })
    await page.screenshot({ path: artifactPath('tls-activation-confirmation.png', output), animations: 'disabled' })
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await page.getByText('Ativar TACACS+ deste cliente?', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(writes.filter(write => write.path.endsWith('/settings')).length, 0)
    assert.equal(await card.getByLabel('Ativar TACACS+ do cliente', { exact: true }).getAttribute('aria-checked'), 'false')
    report.checks.push('Save error preserves entered pin; activation cancellation performs no settings write')
    await page.waitForFunction(() => document.querySelectorAll('.n-message').length === 0)
    const deviceCard = card.locator('.n-card').filter({ hasText: '1. Equipamentos que consultam o TACACS+' })
    await deviceCard.screenshot({ path: artifactPath('tls-device-desktop.png', output) })
    await notice.scrollIntoViewIfNeeded()
    await page.screenshot({ path: artifactPath('tls-desktop.png', output), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1)
    assert.ok((await notice.boundingBox()).width >= 230, 'Nested cards must leave readable notice width at 390px')
    await fingerprint.focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement === document.body), false)
    await deviceCard.evaluate(element => element.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: artifactPath('tls-device-mobile-top.png', output) })
    await save.scrollIntoViewIfNeeded()
    await page.screenshot({ path: artifactPath('tls-device-mobile-bottom.png', output) })
    await notice.scrollIntoViewIfNeeded()
    await page.screenshot({ path: artifactPath('tls-mobile.png', output), fullPage: true })
    report.checks.push('Desktop/mobile screenshots; no horizontal page overflow; keyboard focus remains interactive')
    // Exercise the existing AAA workflow against the TLS device contract, using persisted fixtures.
    await page.setViewportSize({ width: 1440, height: 1000 })
    overview.credentials = [{ userId: 7, username: 'operator-test', name: 'Operador de teste', enabled: true }]
    overview.grants = [{ userId: 7, hostId: 9, commands: [['show', 'version']] }]
    overview.events = [
      { deviceId: 8, kind: 'authorization', outcome: 'permit', command: JSON.stringify({ arguments: ['show', 'version'] }) },
      { deviceId: 99, kind: 'accounting', outcome: 'stop', command: JSON.stringify({ hostId: 9, arguments: ['show', 'interfaces'] }) },
      { deviceId: 98, kind: 'authentication', outcome: 'deny', command: 'not-json-from-legacy-storage' },
      { deviceId: 97, kind: 'unknown-operation', outcome: 'unknown-result', command: JSON.stringify(['show', 'clock']) },
      { deviceId: 96, kind: 'accounting', outcome: 'start', command: JSON.stringify({ arguments: [42] }) },
    ].map((event, index) => ({ id: `event-${index}`, username: 'operator-test', createdAt: '2026-11-04T12:00:00Z', ...event }))
    await card.getByRole('button', { name: 'Atualizar', exact: true }).click()
    const identities = card.locator('.n-card').filter({ hasText: '2. Identidades individuais' })
    const grants = card.locator('.n-card').filter({ hasText: '3. Comandos permitidos por usuário e equipamento' })
    const rows = card.getByRole('table').locator('tbody tr')
    await rows.first().waitFor()
    assert.equal(await rows.count(), 5)
    assert.match(await rows.nth(0).innerText(), /Switch sintético.*Autorização.*Permitido.*show version/s)
    assert.match(await rows.nth(1).innerText(), /Host #9.*Registro de atividade.*Encerrado.*show interfaces/s)
    assert.match(await rows.nth(2).innerText(), /Equipamento #98.*Autenticação.*Negado/s)
    assert.equal(await rows.nth(2).locator('td').last().innerText(), '')
    assert.match(await rows.nth(3).innerText(), /unknown-operation.*unknown-result.*show clock/s)
    assert.equal(await rows.nth(4).locator('td').last().innerText(), '')
    await identities.getByRole('button', { name: 'Editar', exact: true }).click()
    const password = identities.getByLabel('Senha AAA', { exact: true })
    const rotate = identities.getByRole('button', { name: 'Salvar / rotacionar credencial', exact: true })
    assert.equal(await password.inputValue(), '')
    for (const invalid of ['short', 'x'.repeat(73)]) {
      await password.fill(invalid)
      assert.equal(await rotate.isDisabled(), true)
    }
    await password.fill('fixture-password-123456')
    await rotate.click()
    await page.waitForFunction(() => document.querySelector('input[aria-label="Senha AAA"]').value === '')
    assert.equal(writes.at(-1).body.userId, 7)
    assert.equal(writes.at(-1).body.password, 'fixture-password-123456')
    await grants.getByRole('button', { name: 'Editar', exact: true }).click()
    const commands = grants.getByLabel('Comandos completos permitidos', { exact: true })
    assert.equal(await commands.inputValue(), 'show version')
    await commands.fill(' show version \nconfigure terminal\ncustom-command')
    await grants.getByText('Consulta (indicativo):', { exact: false }).waitFor()
    await grants.getByText('Alteração de configuração:', { exact: false }).waitFor()
    await grants.getByText('Operação não classificada:', { exact: false }).waitFor()
    const grantSave = grants.getByRole('button', { name: 'Salvar permissões de comandos', exact: true })
    const beforeCancel = writes.length
    await grantSave.click()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal(writes.length, beforeCancel)
    await grantSave.click()
    await page.getByRole('button', { name: 'Confirmar permissões', exact: true }).click()
    await grants.getByText('operator-test → Switch sintético · 3 comandos', { exact: true }).waitFor()
    assert.deepEqual(writes.at(-1).body.commands, [['show', 'version'], ['configure', 'terminal'], ['custom-command']])
    await commands.fill('')
    await grantSave.click()
    await page.getByText(/0 comando\(s\) permitido\(s\)/).waitFor()
    await page.getByRole('button', { name: 'Confirmar permissões', exact: true }).click()
    await grants.getByText('operator-test → Switch sintético · 0 comandos', { exact: true }).waitFor()
    assert.deepEqual(writes.at(-1).body.commands, [])
    failSave = 'generic'
    await save.click()
    await page.getByText('Não foi possível salvar. Confira os campos e tente novamente.', { exact: true }).waitFor()
    failSave = false
    for (const enabled of [true, false]) {
      await card.getByLabel('Ativar TACACS+ do cliente', { exact: true }).click()
      await card.getByRole('button', { name: 'Salvar configuração', exact: true }).click()
      await page.getByRole('button', { name: 'Confirmar e salvar', exact: true }).click()
      await page.waitForFunction(expected => document.querySelector('[aria-label="Ativar TACACS+ do cliente"]').getAttribute('aria-checked') === String(expected), enabled)
      await page.getByText(enabled ? 'Habilitado na política do cliente. Isto não confirma que o listener está online.' : 'Desabilitado. Nenhuma consulta TACACS+ é acrescentada ao SSH comum.', { exact: true }).waitFor()
      assert.equal(writes.at(-1).body.tacacsEnabled, enabled)
    }
    const settingsCount = writes.length
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/network-access') && response.request().method() === 'GET'),
      card.getByRole('button', { name: 'Salvar configuração', exact: true }).click(),
    ])
    assert.equal(writes.length, settingsCount + 1)
    for (const [section, action, empty, path] of [
      [grants, 'Remover', 'Nenhuma permissão de comando. O padrão é negar.', '/grants/9'],
      [identities, 'Revogar', 'Nenhuma identidade AAA cadastrada.', '/credentials/7'],
      [deviceCard, 'Remover', 'Nenhum equipamento autorizado a consultar o serviço.', '/devices/8'],
    ]) {
      const count = writes.length
      await section.getByRole('button', { name: action, exact: true }).click()
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
      assert.equal(writes.length, count)
      if (path === '/grants/9') {
        failSave = true
        await section.getByRole('button', { name: action, exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Remover', exact: true }).click()
        await page.getByText('Não foi possível remover.', { exact: true }).waitFor()
        failSave = false
      }
      await section.getByRole('button', { name: action, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Remover', exact: true }).click()
      await section.getByText(empty, { exact: true }).waitFor()
      assert.equal(writes.at(-1).path, `/api/v1/network-access${path}`)
      assert.equal(writes.at(-1).method, 'DELETE')
      if (path === '/grants/9') assert.equal(writes.at(-1).query, '?userId=7')
    }
    report.checks[2] += '; credential rotation, command classifications/policies, event parsing, activation/deactivation and revocations validated'
    assert.deepEqual(errors, [])
    report.checks.push('No unhandled browser errors throughout the flow')
    writeFileSync(artifactPath('report.json', output), JSON.stringify({ ...report, passed: true }, null, 2))
  } finally { await browser.close() }
})
