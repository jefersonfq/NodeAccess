#!/usr/bin/env node
const assert = require('node:assert/strict')
const { flowFailure } = require('./sonar-flow-diagnostics.cjs')
const { writeFileSync } = require('node:fs')
const { artifactPath } = require('../shared/private-artifacts.cjs')
const { chromium } = require('playwright')
const { harnessEndpoint } = require('../shared/harness-endpoint.cjs')
const { settings, diagnosticFixture, dashboardFixture, jiraResult, navigationFixture } = require('./sonar-flow-fixtures.cjs')
const base = harnessEndpoint(process.env.FRONTEND_BASE || 'http://127.0.0.1:5199')
const output = process.env.SONAR_FLOW_OUTPUT || artifactPath('sonar-flow-review')
function authToken() {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '7', tenantId: 7, name: 'Operador de teste', role: 'admin', email: 'operator@example.invalid', isPlatformAdmin: false, stage: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.fixture`
}
async function visible(page, text) { await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 }) }
async function closeDialog(page) { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }) }
async function assertLabelFocus(page, name) {
  const label = page.locator('label').filter({ hasText: name }).filter({ visible: true })
  assert.equal(await label.count(), 1)
  await label.click()
  assert.equal(await label.evaluate(element => element.control !== null && element.control === document.activeElement), true, `Label does not focus native control: ${name}`)
}
async function destinationReady(page, destination) {
  if (destination === '/admin/users') await visible(page, 'Nenhum usuário encontrado')
  else if (destination === '/hosts') {
    await page.getByRole('button', { name: 'Ver todos os hosts →', exact: true }).click()
    await visible(page, 'Nenhum host cadastrado ainda.')
  }
  else {
    await page.locator('[data-sessions-table="true"] .n-empty').waitFor({ state: 'visible' })
    await page.locator('[data-sessions-table="true"] .n-spin-body').waitFor({ state: 'hidden' })
  }
}
async function geometry(page) {
  const result = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(result.scroll <= result.viewport + 2, `Page overflow: ${JSON.stringify(result)}`)
  return result
}
async function main() {
  artifactPath('report.json', output)
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox'] })
  let stage = 'setup'
  const evidence = { status: 'failed', scenarios: [], screenshots: [], geometry: [] }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', acceptDownloads: true })
    await context.addInitScript(token => { localStorage.setItem('na_access_token', token); localStorage.setItem('na_refresh_token', 'fixture'); localStorage.setItem('na_ui_theme_mode', 'dark') }, authToken())
    const data = diagnosticFixture(), stats = dashboardFixture(), requests = [], errors = []
    let comparisonHistoryGate
    const state = { failRun: false, failDashboard: false, failSummary: false, failTrace: false, failComparison: false, failJira: false }
    await context.route('**/api/v1/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname, method = req.method()
      const fail = async message => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message }) })
      let body = navigationFixture(path)
      if (path === '/api/v1/settings') body = settings
      else if (path === '/api/v1/features') body = { agentsLicensed: true, integrationsLicensed: true, integrationProviders: { jira: true, oidc: true } }
      else if (path === '/api/v1/dashboard/stats') { if (state.failDashboard) return fail('Falha simulada dashboard'); body = stats }
      else if (path === '/api/v1/diagnostic-runs/41') { if (state.failRun) return fail('Falha simulada diagnóstico'); body = data.run }
      else if (path === '/api/v1/diagnostic-runs/41/report') body = data.report
      else if (path === '/api/v1/hosts/11/diagnostic-runs') {
        if (method === 'GET' && comparisonHistoryGate) await comparisonHistoryGate.promise
        body = [{ ...data.run, id: 40 }, data.run]
      }
      else if (path === '/api/v1/diagnostic-runs/41/compare/40') { if (state.failComparison) return fail('Comparação indisponível'); body = data.comparison }
      else if (path === '/api/v1/diagnostic-runs/41/traceability' && method === 'PATCH') {
        requests.push({ path, body: req.postDataJSON() }); if (state.failTrace) return fail('Origem fora do escopo simulado')
        Object.assign(data.report.traceability, req.postDataJSON()); body = data.run
      } else if (path === '/api/v1/diagnostic-runs/41/ai-summary' && method === 'POST') {
        requests.push({ path }); if (state.failSummary) return fail('Resumo indisponível')
        Object.assign(data.run, { aiSummaryStatus: 'COMPLETED', aiSummaryText: 'Resumo sintético concluído', aiSummaryStructured: { riskLevel: 'high', confidence: 'high', keyFindings: ['Achado sintético'], nextActions: ['Validar evidências'] } }); body = data.run
      } else if (path === '/api/v1/diagnostic-runs/41/report/jira' && method === 'POST') {
        requests.push({ path, body: req.postDataJSON() }); if (state.failJira) return fail('Publicação indisponível')
        body = jiraResult
      } else if (path === '/api/v1/diagnostic-runs/41/download') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data.report) })
      } else if (path === '/api/v1/session-audit/policy') body = null
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    const page = await context.newPage()
    if (process.env.BROWSER_COVERAGE_DIR) await require('../coverage/playwright-coverage.cjs').attachBrowserCoverage(page, browser)
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(15_000)
    stage = 'diagnostic'
    await page.goto(`${base}/diagnostic-runs/41`, { waitUntil: 'networkidle' })
    await visible(page, 'Diagnóstico de laboratório'); await visible(page, 'Resumo automático desabilitado neste tenant')
    assert.equal(await page.getByText('Saída sintética 0', { exact: true }).count(), 1)
    evidence.scenarios.push('diagnostic evidence and disabled automatic summary')
    stage = 'diagnostic-recovery'
    state.failRun = true; await page.getByRole('button', { name: 'Atualizar', exact: true }).click(); await visible(page, 'Nao foi possivel carregar esta execucao')
    state.failRun = false; await page.getByRole('button', { name: 'Atualizar', exact: true }).click(); await visible(page, 'Diagnóstico de laboratório')
    await page.getByRole('button', { name: 'Ajuda', exact: true }).click(); await visible(page, 'Como usar'); await closeDialog(page)
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Exportar JSON' }).click()
    assert.match((await download).suggestedFilename(), /-41\.json$/)
    evidence.scenarios.push('diagnostic load failure recovery, help and JSON download')
    stage = 'traceability'
    await page.getByRole('button', { name: 'Vincular origem' }).click()
    evidence.traceabilityLabels = []
    for (const [placeholder, label] of [['Ex.: 1824', 'ID da sessão'], ['Ex.: OPS-1234', 'Ticket Jira'], ['Ex.: 74', 'ID do ActionRun']]) {
      const actual = await page.getByPlaceholder(placeholder).evaluate(input => ({ id: input.id, labels: Array.from(input.labels || []).map(item => item.textContent.trim()) }))
      evidence.traceabilityLabels.push(actual); assert.ok(actual.labels.includes(label), `Native control is missing label: ${label}`)
      assert.equal(await page.getByLabel(label, { exact: true }).count(), 1)
      await assertLabelFocus(page, label)
    }
    await page.getByPlaceholder('Ex.: 1824').fill('-1'); await page.getByRole('button', { name: 'Validar e salvar' }).click()
    await visible(page, 'IDs numéricos positivos'); assert.equal(requests.filter(r => r.path.endsWith('/traceability')).length, 0)
    await page.getByPlaceholder('Ex.: 1824').fill('25'); await page.getByPlaceholder('Ex.: 74').fill('')
    await page.getByPlaceholder('Ex.: OPS-1234').fill(' LAB-42 ')
    state.failTrace = true; await page.getByRole('button', { name: 'Validar e salvar' }).click(); await visible(page, 'Origem fora do escopo simulado')
    state.failTrace = false; await page.getByRole('button', { name: 'Validar e salvar' }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.deepEqual(requests.filter(r => r.path.endsWith('/traceability')).at(-1).body, { sessionId: 25, actionRunId: null, ticketKey: 'LAB-42' })
    evidence.scenarios.push('traceability validation, failed save and successful scoped request')
    stage = 'comparison-summary'
    comparisonHistoryGate = Promise.withResolvers()
    const baselineInput = page.getByLabel('Execução de referência (antes)', { exact: true })
    try {
      await Promise.all([
        page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === '/api/v1/hosts/11/diagnostic-runs', { timeout: 15_000 }),
        page.getByRole('button', { name: 'Comparar antes/depois', exact: true }).click(),
      ])
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 })
      assert.equal(await baselineInput.count(), 0, 'History-dependent control must not appear before the response')
    } finally { comparisonHistoryGate.resolve() }
    await baselineInput.waitFor({ state: 'visible', timeout: 15_000 })
    assert.equal(await baselineInput.count(), 1)
    await assertLabelFocus(page, 'Execução de referência (antes)')
    state.failComparison = true; await page.getByRole('button', { name: 'Comparar', exact: true }).click(); await visible(page, 'Comparação indisponível')
    state.failComparison = false; await page.getByRole('button', { name: 'Comparar', exact: true }).click(); await visible(page, 'resultado misto'); await visible(page, 'Resolvido no laboratório'); await closeDialog(page)
    state.failSummary = true; await page.getByRole('button', { name: 'Regerar resumo' }).click(); await visible(page, 'Nao foi possivel solicitar a regeneracao')
    state.failSummary = false; await page.getByRole('button', { name: 'Regerar resumo' }).click(); await visible(page, 'Resumo sintético concluído')
    evidence.scenarios.push('comparison waits for controlled history response; comparison and summary failure recovery with rendered evidence')
    stage = 'jira'
    await page.getByRole('button', { name: 'Publicar no Jira', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Anexar também o relatório JSON verificável' }).check()
    const publish = page.getByRole('dialog').getByRole('button', { name: /Enfileirar|Publicar/ })
    assert.equal(await publish.isDisabled(), true)
    await page.getByRole('checkbox', { name: /Confirmo o envio/ }).check(); state.failJira = true; await publish.click(); await visible(page, 'Publicação indisponível')
    state.failJira = false; await publish.click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await visible(page, 'enfileirada')
    const sent = requests.filter(r => r.path.endsWith('/report/jira')).at(-1).body
    assert.equal(sent.includeAttachment, true); assert.equal(new URL(sent.reportUrl).pathname, '/diagnostic-runs/41')
    evidence.scenarios.push('Jira attachment explicit confirmation and queue failure recovery (API mocked)')
    await page.getByText('1 publicação(ões) enfileirada(s) para LAB-42.', { exact: true }).waitFor({ state: 'hidden' })
    stage = 'diagnostic-layout'
    evidence.geometry.push(await geometry(page)); await page.screenshot({ path: artifactPath('diagnostic-desktop.png', output), fullPage: true }); evidence.screenshots.push('diagnostic-desktop.png')
    await page.setViewportSize({ width: 390, height: 844 }); evidence.geometry.push(await geometry(page))
    evidence.mobileActions = await page.locator('.detail-actions button, .report-panel .ai-summary-header button').evaluateAll(buttons => buttons.map(button => { const rect = button.getBoundingClientRect(); return { text: button.textContent.trim(), left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth } }))
    const actionNames = ['Atualizar', 'Ajuda', 'Exportar JSON', 'Regerar resumo', 'Comparar antes/depois', 'Vincular origem', 'Publicar no Jira']
    assert.equal(evidence.mobileActions.length, actionNames.length)
    for (const name of actionNames) assert.equal(evidence.mobileActions.filter(action => action.text === name).length, 1, `Missing or duplicate mobile action: ${name}`)
    for (const action of evidence.mobileActions) assert.ok(action.width > 0 && action.left >= 0 && action.right <= action.viewport, `Clipped mobile action: ${action.text}`)
    await page.screenshot({ path: artifactPath('diagnostic-mobile.png', output), fullPage: true }); evidence.screenshots.push('diagnostic-mobile.png')
    stage = 'dashboard'
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${base}/admin/dashboard`, { waitUntil: 'networkidle' }); await visible(page, 'Operador de teste')
    evidence.geometry.push(await geometry(page)); await page.screenshot({ path: artifactPath('dashboard-desktop.png', output), fullPage: true }); evidence.screenshots.push('dashboard-desktop.png')
    const cards = page.locator('.stat-card[role="link"]'); assert.ok(await cards.count() >= 6)
    const destinations = ['/admin/users', '/hosts', '/admin/reports/sessions', '/admin/reports/sessions']
    for (let i = 0; i < destinations.length; i++) {
      stage = ['users-destination', 'hosts-destination', 'sessions-destination', 'sessions-destination'][i]
      await cards.nth(i).focus(); await page.keyboard.press('x'); assert.equal(new URL(page.url()).pathname, '/admin/dashboard')
      await page.keyboard.press(i % 2 ? 'Space' : 'Enter'); await page.waitForURL(url => url.pathname === destinations[i]); await destinationReady(page, destinations[i]); assert.deepEqual(errors, []); await page.goto(`${base}/admin/dashboard`, { waitUntil: 'networkidle' })
    }
    evidence.scenarios.push('dashboard rendered aggregates and four keyboard navigation contracts')
    stage = 'dashboard-recovery'
    state.failDashboard = true; await page.getByRole('button', { name: /Atualizar|Refresh/ }).first().click(); await visible(page, 'Erro ao carregar estatísticas')
    state.failDashboard = false; await page.getByRole('button', { name: /Atualizar|Refresh/ }).first().click(); await visible(page, 'Operador de teste')
    await page.setViewportSize({ width: 390, height: 844 }); evidence.geometry.push(await geometry(page)); await page.screenshot({ path: artifactPath('dashboard-mobile.png', output), fullPage: true }); evidence.screenshots.push('dashboard-mobile.png')
    assert.deepEqual(errors, []); evidence.pageErrors = errors; evidence.status = 'passed'; stage = 'complete'
    await context.close()
  } catch (error) { evidence.failure = flowFailure(stage, error); throw error }
  finally { await browser.close(); writeFileSync(artifactPath('report.json', output), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 }) }
  console.log(JSON.stringify(evidence))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
