const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { chromium } = require('playwright')
const { makeSnapshot, fakeJwt, mockApi } = require('./observability-cdp-harness.cjs')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5178'
const dir = '/tmp/nodeaccess-observability-review'
async function main() {
  await fs.mkdir(dir, { recursive: true })
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium-browser', headless: true })
  const report = []
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
      await context.addInitScript(({ token, theme }) => {
        localStorage.setItem('na_access_token', token); localStorage.setItem('na_refresh_token', 'mock')
        localStorage.setItem('nodeaccess_locale', 'pt-BR'); localStorage.setItem('na_ui_theme_mode', theme)
      }, { token: fakeJwt(), theme })
      let snapshot = makeSnapshot('healthy'), failure = 503, requests = 0, delayed = false, release
      snapshot.timestamp = new Date().toISOString()
      await context.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
        if (path === '/admin/observability/summary') {
          requests++
          if (failure === 'offline') return route.abort('connectionfailed')
          if (failure) return route.fulfill({ status: failure, json: { message: 'simulated failure' } })
          if (delayed) await new Promise(resolve => { release = resolve })
          return route.fulfill({ json: snapshot })
        }
        const mocked = mockApi(route.request().method(), path)
        await route.fulfill({ status: mocked.status, json: mocked.body })
      })
      await context.routeWebSocket('**/ws/events*', () => {})
      const page = await context.newPage(), errors = []
      page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(15000)
      await page.goto(`${base}/admin/observability`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.getByTestId('observability-load-error').waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Visão geral' }).count(), 0)
      failure = false
      await page.getByRole('button', { name: 'Tentar novamente' }).click()
      await page.getByText('Sem alertas nesta coleta', { exact: true }).waitFor()
      await page.getByText(/recursos visíveis à API, sem consolidação do cluster/).waitFor()
      await page.evaluate(() => { window.__observabilityDocument = true })
      const refresh = () => page.getByTestId('observability-refresh').click()
      await page.getByText('Carga por núcleo', { exact: true }).first().waitFor()
      assert.match(await page.locator('.observability-view').innerText(), /não verifica integridade|Não verifica integridade/)
      for (const kind of [503, 'offline']) {
        failure = kind; await refresh()
        await page.getByText('Dados desatualizados', { exact: true }).waitFor()
        assert.equal(await page.getByRole('heading', { name: 'Visão geral' }).isVisible(), true)
        assert.equal(await page.evaluate(() => window.__observabilityDocument), true)
        failure = false
        await page.getByRole('button', { name: 'Tentar novamente' }).click()
        await page.getByTestId('observability-load-error').waitFor({ state: 'hidden' })
      }
      delayed = true
      const before = requests
      await refresh()
      await page.waitForFunction(() => document.querySelector('button.n-button--loading'))
      assert.equal(await page.getByRole('heading', { name: 'Visão geral' }).isVisible(), true)
      assert.equal(requests, before + 1)
      assert.equal(await page.getByTestId('observability-refresh').isEnabled(), false)
      while (!release) await new Promise(resolve => setTimeout(resolve, 10))
      release(); delayed = false
      await page.waitForFunction(() => !document.querySelector('button.n-button--loading'))

      for (const [reason, message] of [
        ['cli_missing', 'Docker CLI não está instalado no ambiente da API.'],
        ['permission_denied', 'O processo da API não tem permissão para consultar o Docker.'],
        ['timeout', 'A coleta Docker foi interrompida pelo limite de tempo.'],
        ['daemon_unreachable', 'O coletor não conseguiu alcançar o daemon Docker.'],
        ['invalid_output', 'O Docker retornou dados que não puderam ser interpretados.'],
      ]) {
        snapshot = makeSnapshot('healthy'); snapshot.status = 'degraded'
        snapshot.docker = { status: 'unavailable', containers: [], reason, message }
        snapshot.warnings = ['Docker stats indisponivel']
        await refresh()
        const diagnostic = page.getByTestId('docker-diagnostic')
        await diagnostic.getByText(message, { exact: true }).waitFor()
        assert.equal(await diagnostic.isVisible(), true, 'Docker reason must not require opening technical details')
        assert.match(await diagnostic.innerText(), /não confirma que os containers estejam parados/)
        assert.equal(await page.getByText('Docker stats indisponivel', { exact: true }).count(), 0)
        await page.locator('summary').filter({ hasText: 'Containers' }).click()
        await page.getByText('Coleta incompleta', { exact: true }).waitFor()
        assert.equal(await page.locator('details[open] .n-data-table').count(), 0)
        await page.locator('summary').filter({ hasText: 'Containers' }).click()
      }
      snapshot = makeSnapshot('empty-api'); snapshot.docker.containers = []; snapshot.history = []; snapshot.host.disks = []; snapshot.host.cpu.loadPercentOfCores = null
      await refresh()
      await page.getByTestId('observability-no-history').waitFor()
      await page.getByText('Coletando amostras', { exact: true }).waitFor()
      assert.equal(await page.locator('.metric-tile').nth(2).locator('.n-progress').count(), 0)
      await page.locator('summary').filter({ hasText: 'Containers' }).click()
      await page.getByText('Nenhum container retornado', { exact: true }).waitFor()
      snapshot = makeSnapshot('degraded'); await refresh()
      await page.getByTestId('component-diagnostic').filter({ hasText: 'Gateway SSH: timeout' }).waitFor()
      await page.setViewportSize({ width: 390, height: 844 })
      const geometry = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth }))
      assert.ok(geometry.body <= geometry.width + 1, JSON.stringify(geometry))
      await page.screenshot({ path: `${dir}/${theme}-mobile.png`, fullPage: true })
      await page.setViewportSize({ width: 1440, height: 960 })
      await page.screenshot({ path: `${dir}/${theme}-desktop.png`, fullPage: true })
      failure = 403; await refresh()
      await page.getByText('Sem permissão para consultar a observabilidade.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Visão geral' }).count(), 0, 'Permission denial must remove previous operational data')
      assert.deepEqual(errors, [])
      report.push({ theme, requests, initial503: true, staleDataAndNetworkRecovery: true, dockerReasons: 5, emptyStates: true, forbiddenClearsData: true, geometry, runtimeErrors: errors })
      await context.close()
    }
    await fs.writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
