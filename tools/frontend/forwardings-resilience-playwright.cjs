const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5190'
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(() => {
      localStorage.setItem('nodeaccess_locale', 'en')
      localStorage.setItem('na_access_token', `${btoa('{}')}.${btoa(JSON.stringify({ sub: '1', userId: 1, tenantId: 7, role: 'admin', name: 'Admin', stage: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 }))}.test`)
      localStorage.setItem('na_refresh_token', 'test')
    })
    const template = { id: 8, hostId: 7, hostName: 'Forward host', hostIp: '10.0.0.7', hostConnectionMode: 'DIRECT', description: 'Internal app', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 80, bindAddress: '127.0.0.1', autoStart: true, webEnabled: false, webProtocol: 'http' }
    let failToggle = true, toggles = 0
    let failList = true, failOpen = true, failClose = true, creates = 0, live = [], releaseOld, holdOld = false
    const errors = []
    let personalAgentOnline = false, localCalls = 0
    await context.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname, method = route.request().method()
      let body = [], status = 200
      if (path === '/api/v1/features') body = { portForwardingLicensed: true, sharedSessions: { expiryMinutes: [5], maxExpiryMinutes: 5 } }
      else if (path === '/api/v1/agents') body = [
        { id: 1, name: 'Meu notebook', agentMode: 'USER_BOUND', online: personalAgentOnline, owner: { id: 1 } },
        { id: 2, name: 'Outro usuário', agentMode: 'USER_BOUND', online: true, owner: { id: 99 } },
        { id: 3, name: 'Compartilhado', agentMode: 'SERVICE_BOUND', online: true, owner: { id: 1 } },
      ]
      else if (path.endsWith('/local-agent') && method === 'POST') {
        localCalls++
        if (localCalls === 1) { status = 409; body = { message: 'Porta em uso no agente' } }
        else { assert.deepEqual(route.request().postDataJSON(), { agentId: 1, port: 13306 }); live[0].localAgent = { id: 1, name: 'Meu notebook', port: 13306 }; body = live[0] }
      }
      else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Test' }, license: { hasKey: true, featureEntitlements: {}, integrationEntitlements: {} } }
      else if (path === '/api/v1/hosts') body = { data: [{ id: 7, name: 'Forward host', ip: '10.0.0.7', accessProtocol: 'ssh' }], total: 1 }
      else if (/^\/api\/v1\/forwardings\/\d+\/\d+$/.test(path) && method === 'PATCH') {
        toggles++
        await new Promise(resolve => setTimeout(resolve, 150))
        if (failToggle) { failToggle = false; status = 500; body = { message: 'Toggle failed' } }
        else { template.autoStart = route.request().postDataJSON().autoStart; body = template }
      }
      else if (path === '/api/v1/forwardings') {
        if (failList) { failList = false; status = 503; body = { message: 'Temporary outage' } }
        else body = [template]
      } else if (path === '/api/v1/forwardings/7') {
        if (holdOld) { holdOld = false; await new Promise(resolve => { releaseOld = resolve }) }
        body = [template]
      } else if (path === '/api/v1/forwardings/9') body = [{ ...template, id: 9, hostId: 9, description: 'Other host config' }]
      else if (path === '/api/v1/tunnels' && method === 'POST') {
        creates++
        if (failOpen) { failOpen = false; status = 502; body = { message: 'SSH unavailable' } }
        else {
          await new Promise(resolve => setTimeout(resolve, 100))
          live = [{ id: 'tunnel-1', userId: 1, tenantId: 7, hostId: route.request().postDataJSON().hostId, hostName: 'Forward host', bindAddress: '127.0.0.1', localPort: 24000, requestedLocalPort: 8080, assignedLocalPort: 24000, usedPortFallback: true, remoteHost: '127.0.0.1', remotePort: 80, connectionMethod: 'direct', createdAt: new Date().toISOString() }]
          status = 201; body = live[0]
        }
      } else if (path.startsWith('/api/v1/tunnels/') && method === 'DELETE') {
        if (failClose) { failClose = false; status = 500; body = { message: 'Close failed' } }
        else { live = []; status = 204 }
      } else if (path === '/api/v1/tunnels') body = live
      await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body) })
    })
    const page = await context.newPage(); page.setDefaultTimeout(60000)
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${FRONTEND}/forwardings`)
    try { await page.locator('[data-forwardings-load-error]').getByRole('button', { name: 'Try again' }).click({ timeout: 15000 }) } catch (err) { console.error('body', await page.locator('body').innerText(), 'errors', errors); throw err }
    const autoStart = page.getByRole('switch', { name: 'Open automatically' })
    assert.equal(await autoStart.getAttribute('aria-checked'), 'true')
    await autoStart.click()
    await page.getByText('Toggle failed', { exact: true }).waitFor()
    assert.equal(await autoStart.getAttribute('aria-checked'), 'true')
    await autoStart.click()
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false')
    assert.equal(toggles, 2)
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByText('SSH unavailable', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).waitFor()
    assert.ok((await page.locator('body').innerText()).includes('24000'))
    // Local publication: no eligible agent, ownership filtering, validation, conflict and retry.
    await page.getByRole('button', { name: 'Disponibilizar na minha máquina', exact: true }).click()
    await page.getByText('Nenhum agente pessoal online. Conecte seu agente e reabra esta janela.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Publicar porta local' }).isDisabled(), true)
    await page.keyboard.press('Escape'); personalAgentOnline = true
    await page.getByRole('button', { name: 'Disponibilizar na minha máquina', exact: true }).click()
    await page.locator('.n-modal').getByText('Meu notebook', { exact: true }).waitFor()
    assert.equal(await page.locator('.n-modal').getByText('Outro usuário', { exact: true }).count(), 0)
    const localPort = page.getByRole('spinbutton', { name: 'Porta na minha máquina' })
    const publish = page.getByRole('button', { name: 'Publicar porta local' })
    for (const value of ['22', '65536', '1024.5', '']) { await localPort.fill(value); assert.equal(await publish.isDisabled(), true, 'Invalid local port accepted: ' + value) }
    await localPort.fill('13306'); await publish.click()
    await page.getByText('Porta em uso no agente', { exact: true }).waitFor()
    assert.equal(await localPort.inputValue(), '13306')
    await publish.click(); await page.getByRole('button', { name: 'Minha máquina: 127.0.0.1:13306' }).waitFor()
    assert.equal(localCalls, 2)

    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByText('Close failed', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).waitFor()
    // Mount the actual terminal manager with its providers to exercise host switching deterministically.
    holdOld = true
    await page.evaluate(async () => {
      const { createApp, reactive, h } = await import('/node_modules/.vite/deps/vue.js')
      const { createPinia } = await import('/node_modules/.vite/deps/pinia.js')
      const { NMessageProvider } = await import('/node_modules/.vite/deps/naive-ui.js')
      const { i18n } = await import('/src/plugins/i18n.ts')
      const { default: Manager } = await import('/src/components/TunnelManager.vue')
      document.querySelector('#app').__vue_app__.unmount()
      const props = reactive({ hostId: 7, hostName: 'Forward host' })
      window.__forwardingProps = props
      createApp({ render: () => h(NMessageProvider, null, { default: () => h(Manager, props) }) }).use(createPinia()).use(i18n).mount('#app')
    })
    const deadline = Date.now() + 10000
    while (!releaseOld) { if (Date.now() > deadline) throw new Error('Old request not held'); await page.waitForTimeout(20) }
    await page.evaluate(() => { window.__forwardingProps.hostId = 9 })
    await page.getByText('Other host config', { exact: true }).waitFor()
    releaseOld()
    await page.waitForTimeout(200)
    assert.equal(await page.getByText('Internal app', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Start', exact: true }).click()
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Start', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await page.getByRole('button', { name: 'Start', exact: true }).waitFor()
    // External closure (another tab or SSH disconnect) converges without reopening the panel.
    live = [{ id: 'external', hostId: 9, bindAddress: '127.0.0.1', localPort: 8080, requestedLocalPort: 8080, assignedLocalPort: 8080, remoteHost: '127.0.0.1', remotePort: 80, connectionMethod: 'direct' }]
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor()
    live = []
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByRole('button', { name: 'Start', exact: true }).waitFor()
    assert.equal(creates, 3)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: '/tmp/nodeaccess-forwardings-manager.png', fullPage: true })
    console.log(JSON.stringify({ ok: true, scenarios: ['no eligible personal agent', 'exclude other user and service agents', 'invalid local ports blocked', 'occupied local port retry preserves input', 'published endpoint shown', 'auto-start persisted enabled', 'toggle failure preserves enabled', 'toggle confirmed disabled', 'external tunnel open/close convergence', 'load 503 retry', 'SSH failure retry', 'assigned port fallback', 'close failure preserves state', 'close recovery', 'terminal host switch ignores stale response', 'manual tunnel mapped to template', 'terminal stop removes active state'] }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
