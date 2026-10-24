const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { chromium } = require('playwright')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const out = '/tmp/nodeaccess-auth-access-origin'
const agents = ['native-ssh-gateway', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', null, 'curl/8.0', '<script>alert(1)</script>']
const logs = agents.map((userAgent, i) => ({
  id: i + 1, userId: null, userName: null, userEmail: null, userAgent,
  eventType: i === 1 ? 'LOGIN' : 'LOGIN_FAILED', success: i === 1,
  ip: i === 2 ? null : '192.0.2.' + (i + 1), timestamp: '2026-10-23T10:00:00Z',
}))
async function main() {
  await fs.mkdir(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', args: ['--no-sandbox'] })
  const results = []
  try {
    for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
      const payload = { sub: '41', userId: 41, tenantId: 7, name: 'Demo', role: 'admin', stage: 'authenticated', exp: 4102444800 }
      await context.addInitScript(({ payload, theme }) => {
        localStorage.setItem('na_access_token', 'e30.' + btoa(JSON.stringify(payload)) + '.fixture')
        localStorage.setItem('na_refresh_token', 'fixture')
        localStorage.setItem('nodeaccess_locale', 'pt-BR')
        localStorage.setItem('na_ui_theme_mode', theme)
      }, { payload, theme })
      let mode = 'normal'
      await context.routeWebSocket(/.*/, socket => socket.close())
      await context.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname
        let body = [], status = 200
        if (path === '/api/v1/logs/auth') {
          status = mode === 'error' ? 503 : 200
          body = mode === 'error' ? { message: 'Simulated failure' } : { data: mode === 'empty' ? [] : logs, total: mode === 'empty' ? 0 : logs.length, page: 1, limit: 50 }
        } else if (path === '/api/v1/features') body = { integrationProviders: {}, integrationsLicensed: false, sessionAuditAiLicensed: false, localAiLicensed: false }
        else if (path === '/api/v1/users/me/preferences') body = null
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      })
      const page = await context.newPage(), errors = []
      page.on('pageerror', err => errors.push(err.message))
      await page.goto(base + '/admin/logs')
      const origins = page.locator('[data-auth-origin]')
      await origins.first().waitFor()
      assert.deepEqual(await origins.evaluateAll(els => els.map(el => el.dataset.authOrigin)), ['gateway', 'web', 'unknown', 'unknown', 'unknown'])
      assert.equal(await origins.first().innerText(), 'Gateway SSH')
      assert.equal(await origins.nth(1).innerText(), 'Interface web')
      assert.match(await origins.first().getAttribute('title'), /native-ssh-gateway/)
      assert.match(await origins.first().getAttribute('aria-label'), /não comprova/)
      assert.equal(await origins.first().locator('xpath=ancestor::tr').getByText('192.0.2.1', { exact: true }).count(), 1)
      assert.equal(await origins.first().locator('xpath=ancestor::tr').getByText('Falha', { exact: true }).count(), 1)
      assert.equal(await origins.nth(1).locator('xpath=ancestor::tr').getByText('Sucesso', { exact: true }).count(), 1)
      await origins.first().focus()
      assert.equal(await origins.first().evaluate(el => document.activeElement === el), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      await page.screenshot({ path: out + '/' + theme + '-' + width + '.png', fullPage: true })
      mode = 'error'
      await page.getByRole('button', { name: 'Buscar', exact: true }).click()
      await page.getByText('Erro ao carregar logs de autenticação', { exact: true }).waitFor()
      mode = 'empty'
      await page.getByRole('button', { name: 'Buscar', exact: true }).click()
      await origins.first().waitFor({ state: 'detached' })
      mode = 'normal'
      await page.getByRole('button', { name: 'Buscar', exact: true }).click()
      await origins.first().waitFor()
      assert.deepEqual(errors, [])
      results.push({ theme, width, rows: logs.length, failureRetry: true, empty: true })
      await context.close()
    }
    await fs.writeFile(out + '/report.json', JSON.stringify({ ok: true, results }, null, 2))
    console.log(JSON.stringify({ ok: true, results }))
  } finally { await browser.close() }
}
main().catch(err => { console.error(err); process.exitCode = 1 })
