#!/usr/bin/env node
'use strict'
// Real Vue pages/components and Chromium; all API/WS traffic is simulated, no customer data.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5174'
const output = process.env.UX_REPORT_DIR || '/tmp/nodeaccess-lucien-ux'
const token = `e30.${Buffer.from(JSON.stringify({ sub: '9', tenantId: 7, role: 'admin', name: 'Auditor de laboratório', stage: 'authenticated', exp: 4102444800 })).toString('base64url')}.simulation`
const session = { id: 42, hostId: 2, startedAt: new Date().toISOString(), host: { name: 'Servidor financeiro de homologação' }, user: { name: 'Operador de teste' } }

async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const results = []
  try {
    for (const theme of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
      const state = { mode: 'empty', permissionFailure: true, writes: [], impactFailure: true, maintenanceFailure: true, maintenance: false }
      const errors = []
      await context.addInitScript(({ token, theme }) => {
        localStorage.setItem('na_access_token', token); localStorage.setItem('na_ui_theme_mode', theme)
        localStorage.setItem('nodeaccess_locale', 'pt-BR')
        const Native = window.WebSocket
        window.__observers = []
        window.WebSocket = class extends EventTarget {
          constructor(url, protocols) {
            super()
            if (!String(url).includes('/ws/session-supervision/')) return new Native(url, protocols)
            this.url = url; this.readyState = 0; this.sent = []; window.__observers.push(this)
            setTimeout(() => { if (this.readyState === 3) return; this.readyState = 1; this.onopen?.({}) }, 30)
          }
          send(data) { this.sent.push(data); this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) }) }
          close() { this.readyState = 3; this.onclose?.({}) }
        }
      }, { token, theme })
      await context.route('**/api/v1/**', async route => {
        const req = route.request(), p = new URL(req.url()).pathname
        let body = [], status = 200
        if (p === '/api/v1/session-supervision/permission') body = { enabled: true }
        else if (p === '/api/v1/session-supervision') {
          if (state.mode === 'error') { status = 403; body = { message: 'Permissão revogada' } }
          else body = state.mode === 'empty' ? [] : [session]
        } else if (/\/session-supervision\/permissions\//.test(p)) {
          if (req.method() === 'PUT') { state.writes.push(req.postDataJSON()); status = 204 }
          else if (state.permissionFailure) { status = 503; body = { message: 'Consulta indisponível' } }
          else body = { enabled: false }
        } else if (p.endsWith('/impact')) {
          if (state.impactFailure) { status = 403; body = { message: 'Impacto indisponível; tente novamente' } }
          else body = { hostCount: 0, activeSessionCount: 1, safeToRevoke: false }
        } else if (p.endsWith('/maintenance')) {
          if (state.maintenanceFailure) { status = 403; body = { message: 'Não foi possível pausar o agente' } }
          else { state.maintenance = req.postDataJSON().enabled; body = { maintenanceMode: state.maintenance, activeConnections: 1 } }
        } else if (p === '/api/v1/features') body = { agentsLicensed: true }
        await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body) })
      })
      const page = await context.newPage(); page.setDefaultTimeout(10000)
      page.on('pageerror', e => errors.push(e.message))
      async function check(name, action) { await action(); results.push({ theme, name, passed: true }) }
      try {
        await page.goto(`${base}/session-supervision`)
        await check('page purpose, scope and empty state', async () => {
          await page.getByRole('heading', { name: 'Supervisão de sessões SSH', exact: true }).waitFor()
          await page.getByText('Nenhuma sessão SSH autorizada em andamento.', { exact: true }).waitFor()
          assert.match(await page.locator('main').last().innerText(), /somente leitura.*sem aviso individual/s)
          assert.match(await page.locator('main').last().innerText(), /não inclui histórico anterior/)
          assert.equal(await page.getByRole('button', { name: 'Acompanhar', exact: true }).count(), 0)
        })
        state.mode = 'active'; await page.getByRole('button', { name: 'Atualizar sessões' }).click()
        const start = page.getByRole('button', { name: 'Acompanhar', exact: true })
        await check('reason validation and keyboard activation', async () => {
          await start.waitFor(); assert.equal(await start.isDisabled(), true)
          const reason = page.getByRole('textbox', { name: 'Justificativa', exact: true })
          await reason.fill('    '); assert.equal(await start.isDisabled(), true)
          await reason.fill('Auditoria de incidente'); await start.focus(); await page.keyboard.press('Enter')
          await page.getByRole('status').filter({ hasText: 'Acompanhando' }).waitFor()
          assert.equal(await page.evaluate(() => window.__observers[0].sent.length), 1)
          assert.equal(await page.evaluate(() => JSON.parse(window.__observers[0].sent[0]).reason), 'Auditoria de incidente')
        })
        await check('observer output, no input and explicit end state', async () => {
          await page.evaluate(() => { const ws = window.__observers.at(-1); ws.onmessage({ data: JSON.stringify({ type: 'resize', cols: 160, rows: 40 }) }); ws.onmessage({ data: new TextEncoder().encode('OUTPUT_SIMULADO\r\n').buffer }) })
          await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('comando indevido')
          assert.equal(await page.evaluate(() => window.__observers.at(-1).sent.length), 1)
          await page.evaluate(() => window.__observers.at(-1).close())
          await page.getByRole('status').filter({ hasText: 'Supervisão encerrada' }).waitFor()
        })
        await check('mobile layout keeps actions and terminal inside page', async () => {
          await page.setViewportSize({ width: 390, height: 844 })
          await page.getByRole('button', { name: 'Encerrar acompanhamento' }).scrollIntoViewIfNeeded()
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Horizontal page overflow')
          await page.screenshot({ path: path.join(output, `supervision-${theme}-mobile.png`), fullPage: true })
          await page.getByRole('button', { name: 'Encerrar acompanhamento' }).click()
          assert.equal(await page.locator('.xterm').count(), 0)
          await page.setViewportSize({ width: 1366, height: 900 })
        })
        await check('permission failure cannot leave stale actionable sessions', async () => {
          state.mode = 'error'; await page.getByRole('button', { name: 'Atualizar sessões' }).click()
          await page.getByText(/Não foi possível consultar as sessões/).waitFor()
          assert.equal(await start.count(), 0, 'Stale session action remains after permission failure')
          state.mode = 'active'; await page.getByRole('button', { name: 'Atualizar sessões' }).click(); await start.waitFor()
        })
        // Mount the real permission editor with the same providers as the app.
        await mount(page, 'SessionSupervisionPermission', { userId: 9 })
        await check('failed permission load is safe and can be retried', async () => {
          await page.getByText('Não foi possível consultar a permissão de supervisão.').waitFor()
          assert.equal(await page.getByRole('button', { name: 'Salvar permissão de supervisão' }).isDisabled(), true)
          assert.equal(state.writes.length, 0)
          state.permissionFailure = false
          await page.getByRole('button', { name: 'Tentar novamente' }).click()
          const toggle = page.getByRole('switch', { name: 'Pode supervisionar sessões SSH' })
          await toggle.click(); await page.getByRole('button', { name: 'Salvar permissão de supervisão' }).click()
          await page.getByText('Permissão de supervisão salva.').waitFor()
          assert.deepEqual(state.writes, [{ enabled: true }])
          await toggle.click(); assert.equal(await page.getByText('Permissão de supervisão salva.').count(), 0, 'Success must not describe unsaved edits')
        })
        await mount(page, 'AgentOperationsPanel', { agent: { id: 1, agentMode: 'USER_BOUND', online: true, tlsMode: 'verified', heartbeatAgeMs: 1, versionStatus: 'current', version: '1.5.0', maintenanceMode: false } })
        await check('impact failure, dynamic use and maintenance recovery', async () => {
          await page.getByRole('button', { name: 'Ver uso e impacto' }).click()
          await page.getByText('Impacto indisponível; tente novamente', { exact: true }).waitFor()
          state.impactFailure = false; await page.getByRole('button', { name: 'Ver uso e impacto' }).click()
          await page.getByText(/0 host\(s\) com vínculo explícito, 1 sessão/).waitFor()
          await page.getByText(/Revogar pode interromper sessões/).waitFor()
          assert.match(await page.locator('[data-agent-operations]').innerText(), /Pausar impede novas conexões e mantém as sessões atuais/)
          await page.getByRole('button', { name: 'Pausar novas conexões' }).click()
          await page.getByText('Não foi possível pausar o agente', { exact: true }).waitFor()
          assert.equal(state.maintenance, false)
          state.maintenanceFailure = false; await page.getByRole('button', { name: 'Pausar novas conexões' }).click()
          await page.getByText('Novas conexões pausadas; sessões atuais foram preservadas.').waitFor()
        })
        assert.deepEqual(errors, [], 'Unhandled browser errors')
      } catch (error) { await page.screenshot({ path: path.join(output, `failure-${theme}.png`), fullPage: true }); throw error }
      finally { await context.close() }
    }
  } finally { await browser.close(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2)) }
  console.log(JSON.stringify({ passed: results.length, report: path.join(output, 'report.json') }))
}
async function mount(page, component, props) {
  await page.evaluate(async ({ component, props }) => {
    const { createApp, h } = await import('/node_modules/.vite/deps/vue.js')
    const { NMessageProvider } = await import('/node_modules/.vite/deps/naive-ui.js')
    const { default: Component } = await import(`/src/components/${component}.vue`)
    document.querySelector('#app').__vue_app__.unmount()
    createApp({ render: () => h(NMessageProvider, null, { default: () => h(Component, props) }) }).mount('#app')
  }, { component, props })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
