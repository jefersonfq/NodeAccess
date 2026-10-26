#!/usr/bin/env node
// Browser UX simulation only. All APIs mocked; no emails, VMs or production hosts.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5188'
const output = process.env.TRIAL_ARTIFACTS || '/tmp/nodeaccess-trial-browser'
const config = { enabled: true, privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms', privacyVersion: 'v1', profile: { name: 'Teste', durationDays: 7, maxUsers: 2, maxHosts: 2, machineCount: 1, maxMachines: 2, allowCustomHosts: true, maxCustomHosts: 1, maxSessions: 2, retentionDays: 30, resources: ['ssh', 'sftp'] } }
const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '41', tenantId: 7, name: 'Admin fixture', role: 'admin', isPlatformAdmin: true, email: 'admin@example.test', stage: 'authenticated', exp: 4102444800 })).toString('base64url')}.fixture`
async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  const results = []
  try {
    const themes = process.env.TRIAL_THEMES ? process.env.TRIAL_THEMES.split(',') : ['dark', 'light']
    const widths = process.env.TRIAL_VIEWPORTS ? process.env.TRIAL_VIEWPORTS.split(',').map(Number) : [390, 768, 1440]
    assert.ok(themes.every(value => ['dark', 'light'].includes(value)) && widths.every(value => [390, 768, 1440].includes(value)))
    for (const theme of themes) for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, locale: 'pt-BR' })
      const state = { audit: false, enabled: true, failRegistration: false, fieldFailure: false, failVerify: false, phase: 'provisioning', activated: false, owner: true, users: 1, calls: [] }
      await context.addInitScript(theme => { localStorage.setItem('nodeaccess_locale', 'pt-BR'); localStorage.setItem('na_ui_theme_mode', theme) }, theme)
      await context.routeWebSocket(/.*/, socket => socket.close())
      await context.route('**/api/v1/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname
        const payload = request.postData() ? request.postDataJSON() : undefined
        state.calls.push({ path, method: request.method(), authorization: request.headers().authorization, payload })
        let status = 200, data = {}
        if (path.endsWith('/trials/public/config')) data = { ...config, enabled: state.enabled }
        else if (path.endsWith('/trials/public/register')) {
          status = state.fieldFailure ? 422 : state.failRegistration ? 503 : 200
          data = state.fieldFailure ? { message: 'Revise os dados', fields: { phone: 'Backend validation' } } : state.failRegistration ? { message: 'Sensitive provider failure' } : { message: 'Confira seu e-mail para continuar.' }
        } else if (path.endsWith('/trials/public/verify')) { status = state.failVerify ? 410 : 200; data = { accessToken: 'opaque-capability' } }
        else if (path.endsWith('/trials/public/status')) data = { status: state.phase, activated: state.activated, owner: state.owner, consentRequired: !state.owner && !state.activated, privacyVersion: 'v1', privacyUrl: config.privacyUrl, termsUrl: config.termsUrl, users: state.users, maxUsers: 2, tenantSlug: 'trial-fixture', expiresAt: '2026-11-01T12:00:00Z', marketingConsent: false, researchConsent: false }
        else if (path.endsWith('/trials/public/activate')) { state.activated = true; data = { tenantSlug: 'trial-fixture' } }
        else if (path.endsWith('/trials/public/invite')) { state.users = 2; data = { message: 'Convite solicitado.' } }
        else if (path.endsWith('/trials/public/cancel')) state.phase = 'cancelled'
        else if (path.endsWith('/platform/trials')) data = { provisionerReady: false, profile: { ...config.profile, ...(width === 1440 ? { experience: 'full', expiryNoticeHours: 24 } : {}), machineCount: 2, templateId: 'linux-v1', privacyUrl: config.privacyUrl, termsUrl: config.termsUrl, privacyVersion: config.privacyVersion, maxActiveTrials: 10, retentionDays: 30, expiryNoticeHours: 6, networkCidr: '10.64.0.0/24', maxSessions: 2 }, trials: [{ id: 'fixture', name: 'Visitor fixture', email: 'visitor@example.test', phone: width === 768 ? null : '+5511999991234', status: 'active', expiresAt: '2026-11-01T12:00:00Z', verifiedAt: '2026-10-24T12:00:00Z' }] }
        else if (path.endsWith('/features')) data = state.audit ? { trial: { expiresAt: '2026-11-01T12:00:00Z', resources: ['ssh', 'audit'] }, sessionAuditLicensed: true } : {}
        else if (path.endsWith('/session-audit')) data = { data: [], total: 0 }
        else if (path.endsWith('/settings')) data = { license: {}, tenant: { id: 7, name: 'Normal', slug: 'normal' } }
        else data = []
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${base}/trial`)
      await page.getByLabel('Limites do teste').getByText('Até 2 sessões simultâneas', { exact: false }).waitFor()
      await page.getByText('prazo de retenção de 30 dias', { exact: false }).waitFor()
      assert.equal(await page.locator('.trial-brand img').evaluate(image => image.complete && image.naturalWidth > 0), true)
      assert.equal(await page.locator('body').getAttribute('data-theme'), theme)
      assert.equal(await page.locator('.trial-page').evaluate(element => getComputedStyle(element).backgroundColor), theme === 'light' ? 'rgb(244, 246, 252)' : 'rgb(12, 12, 16)')
      const primary = page.getByRole('button', { name: 'Solicitar meu ambiente de teste' })
      assert.equal(await primary.isDisabled(), true)
      await page.locator('#trial-name').press('Enter')
      assert.equal(state.calls.filter(c => c.path.endsWith('/register')).length, 0)
      await page.getByRole('checkbox').last().check()
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.trial-form button[type=submit]')).backgroundColor === 'rgb(79, 70, 229)')
      const buttonColors = await primary.evaluate(button => { const style = getComputedStyle(button); return { background: style.backgroundColor, text: style.color } })
      assert.equal(buttonColors.background, 'rgb(79, 70, 229)')
      assert.equal(buttonColors.text, 'rgb(255, 255, 255)')
      await page.screenshot({ path: `${output}/registration-${theme}-${width}.png`, fullPage: true })
      await page.getByLabel('Nome completo', { exact: true }).fill('Ana')
      await primary.click()
      await page.locator('#trial-name-error').waitFor()
      assert.equal(await page.locator('#trial-name').evaluate(el => el === document.activeElement), true)
      await page.getByLabel('Nome completo', { exact: true }).fill('Visitor fixture')
      assert.equal(await page.locator('#trial-name-error').count(), 0)
      await page.getByLabel('Nome completo', { exact: true }).focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.getByLabel('E-mail', { exact: true }).evaluate(element => element === document.activeElement), true)
      await page.getByRole('checkbox').last().check()
      await page.getByLabel('E-mail', { exact: true }).fill('invalid-email')
      await page.getByRole('button', { name: 'Solicitar meu ambiente de teste' }).click()
      assert.equal(state.calls.filter(c => c.path.endsWith('/register')).length, 0)
      await page.getByLabel('E-mail', { exact: true }).fill('visitor@example.test')
      const phone = page.getByLabel('Telefone (opcional)', { exact: true })
      assert.equal(await phone.getAttribute('type'), 'tel')
      assert.equal(await phone.getAttribute('autocomplete'), 'tel')
      assert.equal(await phone.getAttribute('maxlength'), '40')
      assert.equal(await phone.getAttribute('required'), null)
      await page.getByLabel('E-mail', { exact: true }).focus()
      await page.keyboard.press('Tab')
      assert.equal(await phone.evaluate(element => element === document.activeElement), true)
      assert.notEqual(await phone.evaluate(element => getComputedStyle(element).outlineStyle), 'none')
      await phone.pressSequentially('11999991234')
      assert.equal(await phone.inputValue(), '(11) 99999-1234')
      await phone.press('Backspace')
      assert.equal(await phone.inputValue(), '(11) 9999-9123')
      await phone.fill('')
      await page.keyboard.insertText('1134567890')
      assert.equal(await phone.inputValue(), '(11) 3456-7890')
      await phone.evaluate(el => el.setSelectionRange(5, 5))
      await phone.press('Backspace')
      assert.equal((await phone.inputValue()).replace(/\D/g, ''), '134567890')
      await phone.fill('+44 20 7946 0958')
      assert.equal(await phone.inputValue(), '+44 20 7946 0958')
      await phone.fill('invalid-phone')
      await page.getByRole('button', { name: 'Solicitar meu ambiente de teste' }).click()
      await page.locator('#trial-phone-error').waitFor()
      assert.equal(await phone.getAttribute('aria-invalid'), 'true')
      assert.equal(await phone.evaluate(element => element === document.activeElement), true)
      assert.equal(state.calls.filter(c => c.path.endsWith('/register')).length, 0)
      await phone.fill('   ')
      assert.equal(await page.getByRole('checkbox').nth(0).isChecked(), false)
      assert.equal(await page.getByRole('checkbox').nth(1).isChecked(), false)
      await page.getByRole('checkbox').last().check()
      state.fieldFailure = true
      await phone.fill('1134567890')
      await primary.click()
      await page.locator('#trial-phone-error').waitFor()
      assert.equal(await page.locator('#trial-registration-error').count(), 0)
      assert.equal(await phone.evaluate(el => el === document.activeElement), true)
      await phone.fill('')
      assert.equal(await page.locator('#trial-phone-error').count(), 0)
      state.fieldFailure = false
      state.failRegistration = true
      await page.getByRole('button', { name: 'Solicitar meu ambiente de teste' }).click()
      await page.getByRole('alert').filter({ hasText: 'Não foi possível concluir agora' }).waitFor()
      assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'visitor@example.test')
      assert.equal(await page.getByText('Sensitive provider failure').count(), 0)
      assert.equal(await page.locator('#trial-registration-error').evaluate(el => el === document.activeElement), true)
      assert.equal(Object.hasOwn(state.calls.filter(c => c.path.endsWith('/register')).at(-1).payload, 'phone'), false)
      await phone.fill('+55 (11) 99999-1234')
      await page.getByRole('button', { name: 'Solicitar meu ambiente de teste' }).click()
      await page.getByRole('alert').filter({ hasText: 'Não foi possível concluir agora' }).waitFor()
      assert.equal(await phone.inputValue(), '+55 (11) 99999-1234')
      await page.screenshot({ path: `${output}/registration-error-${theme}-${width}.png`, fullPage: true })
      state.failRegistration = false
      await page.getByRole('button', { name: 'Solicitar meu ambiente de teste' }).click()
      await page.getByRole('heading', { name: 'Confira seu e-mail' }).waitFor()
      const registration = state.calls.filter(c => c.path.endsWith('/register')).at(-1)
      assert.equal(registration.payload.phone, '+55 (11) 99999-1234')
      assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('99999-1234') || JSON.stringify(sessionStorage).includes('99999-1234')), false)
      await page.screenshot({ path: `${output}/email-${theme}-${width}.png`, fullPage: true })
      assert.equal(registration.payload.marketingConsent, false)
      assert.equal(registration.payload.researchConsent, false)
      assert.equal(registration.authorization, undefined)
      await page.goto(`${base}/trial#token=verification-fixture`)
      await page.getByRole('heading', { name: 'Preparando seu ambiente' }).waitFor()
      await page.screenshot({ path: `${output}/provisioning-${theme}-${width}.png`, fullPage: true })
      assert.equal(new URL(page.url()).hash, '')
      assert.equal(await page.evaluate(() => sessionStorage.getItem('na_trial_access')), 'opaque-capability')
      state.phase = 'active'
      await page.getByRole('button', { name: 'Atualizar andamento', exact: true }).click()
      await page.getByLabel('Senha', { exact: true }).fill('Good-test-password-2026')
      await page.getByLabel('Confirme a senha').fill('Different-test-password')
      await page.getByRole('button', { name: 'Ativar minha conta' }).click()
      await page.getByText('As senhas precisam ser iguais.').waitFor()
      assert.equal(state.calls.filter(c => c.path.endsWith('/activate')).length, 0)
      await page.getByLabel('Confirme a senha').fill('Good-test-password-2026')
      await page.getByRole('button', { name: 'Ativar minha conta' }).click()
      await page.getByRole('link', { name: 'Entrar no meu ambiente de teste' }).waitFor()
      await page.getByLabel('Nome do convidado').fill('Guest fixture')
      await page.getByLabel('E-mail do convidado').fill('guest@example.test')
      await page.getByRole('button', { name: 'Enviar convite' }).click()
      await page.getByText('O limite de participantes deste teste foi atingido.').waitFor()
      assert.equal(state.calls.find(c => c.path.endsWith('/invite')).payload.email, 'guest@example.test')
      await page.getByRole('checkbox').first().check()
      await page.getByRole('button', { name: 'Salvar preferências' }).click()
      await page.getByText('Preferências atualizadas.').waitFor()
      assert.equal(state.calls.find(c => c.path.endsWith('/preferences')).authorization, 'Bearer opaque-capability')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      await page.screenshot({ path: `${output}/active-${theme}-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Encerrar meu teste' }).click()
      await page.getByRole('button', { name: 'Continuar usando' }).click()
      assert.equal(state.calls.filter(c => c.path.endsWith('/cancel')).length, 0)
      await page.getByRole('button', { name: 'Encerrar meu teste' }).click()
      await page.getByRole('button', { name: 'Encerrar teste', exact: true }).click()
      await page.getByRole('heading', { name: 'Demonstração cancelada' }).waitFor()
      await page.evaluate(() => sessionStorage.clear())
      state.failVerify = true
      await page.goto(`${base}/trial#token=expired-fixture`)
      await page.getByText('Este link expirou ou já foi utilizado.', { exact: false }).waitFor()
      assert.equal(new URL(page.url()).hash, '')
      state.owner = false; state.failVerify = false; state.phase = 'active'; state.activated = false
      await page.goto(`${base}/trial#token=invited-fixture`)
      await page.getByLabel('Senha', { exact: true }).fill('Guest-test-password-2026')
      await page.getByLabel('Confirme a senha').fill('Guest-test-password-2026')
      assert.equal(await page.getByRole('checkbox').nth(1).isChecked(), false)
      await page.getByRole('checkbox').first().check()
      await page.getByRole('button', { name: 'Ativar minha conta' }).click()
      assert.equal(state.calls.filter(c => c.path.endsWith('/activate')).at(-1).payload.termsAccepted, true)
      assert.equal(state.calls.filter(c => c.path.endsWith('/activate')).at(-1).payload.marketingConsent, false)
      await page.getByRole('link', { name: 'Entrar no meu ambiente de teste' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Encerrar meu teste' }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Enviar convite' }).count(), 0)
      await page.getByRole('button', { name: 'Encerrar minha participação' }).click()
      await page.getByText('Somente sua participação será encerrada.', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Continuar usando' }).click()
      await page.evaluate(() => sessionStorage.clear())
      state.enabled = false
      state.failVerify = true
      await page.goto(`${base}/trial#token=another-expired-fixture`)
      await page.getByText('Este link expirou ou já foi utilizado.', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Solicitar novo link' }).click()
      await page.getByRole('heading', { name: 'Novos testes estão temporariamente indisponíveis' }).waitFor()
      await page.screenshot({ path: `${output}/disabled-${theme}-${width}.png`, fullPage: true })
      // Existing normal account survives visiting the public onboarding and capability errors.
      await page.evaluate(token => { localStorage.setItem('na_access_token', token); localStorage.setItem('na_refresh_token', 'normal-refresh') }, token)
      await page.reload()
      await page.getByRole('link', { name: 'Voltar ao meu ambiente' }).waitFor()
      assert.equal(await page.evaluate(() => localStorage.getItem('na_access_token')), token)
      assert.equal(state.calls.filter(c => c.path.endsWith('/auth/refresh')).length, 0)
      await page.goto(`${base}/platform/trials`)
      await page.getByRole('heading', { name: 'Testes', exact: true }).waitFor()
      await page.getByText(width === 768 ? 'Telefone: —' : 'Telefone: +5511999991234', { exact: true }).waitFor()
      assert.equal(await page.getByLabel('Experiência do tenant').inputValue(), width === 1440 ? 'full' : 'guided')
      if (width === 1440) {
        assert.equal(await page.getByLabel('IA local', { exact: true }).isChecked(), true)
        await page.getByLabel('IA local', { exact: true }).uncheck()
        await page.getByLabel('Jira', { exact: true }).uncheck()
        assert.equal(await page.getByLabel('Solicitações de IA durante o teste').inputValue(), '100')
        await page.getByLabel('Solicitações de IA durante o teste').fill('80')
        await page.getByLabel('Solicitações simultâneas de IA').fill('2')
      }
      await page.getByLabel('Nome da oferta').fill('Nova oferta')
      await page.getByRole('button', { name: 'Salvar perfil' }).click()
      await page.getByText('Perfil salvo.', { exact: false }).waitFor()
      const savedProfile = state.calls.find(c => c.path.endsWith('/platform/trials/profile')).payload
      assert.equal(savedProfile.name, 'Nova oferta')
      assert.equal(savedProfile.machineCount, 2)
      if (width === 1440) { assert.equal(savedProfile.maxAiRequests, 80); assert.equal(savedProfile.maxAiConcurrentRequests, 2); assert.equal(savedProfile.features.localAi, false); assert.equal(savedProfile.integrations.jira, false) }
      await page.getByRole('button', { name: 'Encerrar teste de Visitor fixture' }).click()
      await page.getByRole('button', { name: 'Voltar', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.getByRole('heading', { name: 'Testes', exact: true }).scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      await page.screenshot({ path: `${output}/admin-${theme}-${width}.png`, fullPage: true })
      state.audit = true
      await page.goto(`${base}/trial/audits`)
      await page.getByRole('heading', { name: 'Auditoria do teste', exact: true }).waitFor()
      await page.getByText('Nenhuma sessão registrada ainda.').waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      state.audit = false
      await page.reload()
      await page.getByText('A auditoria não está habilitada neste teste.').waitFor()
      assert.deepEqual(errors, [])
      results.push({ theme, width, result: 'PASS', scope: 'Mocked browser UX; does not certify SMTP/VM/network isolation', cases: ['terms disabled and Enter no POST', 'full name inline focus and correction', 'BR progressive mask typing/paste/backspace', 'international phone preserved', '422 field recovery without global stale error', '503 alert focused', 'existing logo loaded', 'optional phone and explicit purpose', 'invalid phone blocked and focused', 'blank phone omitted', 'formatted phone preserved across 503', 'phone absent from browser storage', 'admin phone visible', 'keyboard focus', 'invalid email rejected locally', 'optional marketing refused', '503 retains form', 'verification fragment scrubbed', 'provisioning-to-active', 'password mismatch', 'activation', 'invitation and quota', 'participant accepts own terms and optional consent', 'participant cancellation scope and cannot invite', 'preferences', 'cancel confirmation', 'expired link', 'registration disabled', 'normal session preserved', 'admin profile', 'trial audit enabled empty state', 'trial audit disabled denial', 'responsive'] })
      await context.close()
    }
    await fs.writeFile(`${output}/results.json`, JSON.stringify({ at: new Date().toISOString(), headSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), results }, null, 2))
    console.log(JSON.stringify(results, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
