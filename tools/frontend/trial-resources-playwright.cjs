#!/usr/bin/env node
// Real Vue component with simulated API responses; no infrastructure provisioning.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { chromium } = require('playwright')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5188'
const output = process.env.TRIAL_ARTIFACTS || '/tmp/na0068-trial-resources-browser'
async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  const mainSource = await (await fetch(`${base}/src/main.ts`)).text()
  const vueUrl = mainSource.match(/from "([^"]*\/vue\.js[^"]*)"/)[1]
  const piniaUrl = mainSource.match(/from "([^"]*\/pinia\.js[^"]*)"/)[1]
  const results = []
  try {
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } })
      const state = { trial: true, experience: undefined, fail: false, failHost: false, calls: [], resources: { customHosts: [], machineCount: 1, requestedMachines: 1, maxMachines: 3, customHostCount: 0, maxCustomHosts: 1, allowCustomHosts: true, maxHosts: 3, provisioning: false, error: null } }
      const errors = []
      await context.route('**/trial-resource-harness', route => route.fulfill({ contentType: 'text/html', body: `<html><body><div id="fixture"></div><script type="module">import { createApp, h } from '${vueUrl}'; import { createPinia } from '${piniaUrl}'; import Panel from '/src/components/TrialResourcesPanel.vue'; window.hostRefreshes=0; createApp({render:()=>h(Panel,{onChanged:()=>window.hostRefreshes++})}).use(createPinia()).mount('#fixture');</script></body></html>` }))
      await context.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname
        state.calls.push({ path, method: route.request().method(), body: route.request().postDataJSON() })
        let data = [], status = 200
        if (path.endsWith('/features')) data = { trial: state.trial ? { experience: state.experience, resources: ['ssh'] } : null }
        if (path.endsWith('/trials/me/resources')) data = state.resources
        if (path.endsWith('/trials/me/machines')) {
          status = state.fail ? 503 : 202
          if (!state.fail) { state.resources.provisioning = true; state.resources.requestedMachines = route.request().postDataJSON().count }
          data = {}
        }
        if (/\/trials\/me\/hosts(?:\/\d+)?$/.test(path)) {
          const request = route.request()
          if (state.failHost) { status = 403; data = { code: 'TRIAL_DESTINATION_BLOCKED' } }
          else if (request.method() === 'POST' || request.method() === 'PUT') {
            const body = request.postDataJSON()
            state.resources.customHosts = [{ id: 91, name: body.name, ip: body.ip, port: body.port, sshUser: body.sshUser, authType: body.authType }]
            state.resources.customHostCount = 1; data = { id: 91 }
          } else if (request.method() === 'DELETE') { state.resources.customHosts = []; state.resources.customHostCount = 0; data = {} }
        }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
      })
      const page = await context.newPage()
      page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
      page.on('response', response => { if (response.status() >= 400) console.error(response.status(), new URL(response.url()).pathname) })
      await page.goto(`${base}/trial-resource-harness`)
      await page.locator('summary').click()
      const count = page.getByLabel('Quantidade total desejada de máquinas de demonstração')
      await count.fill('4')
      await page.getByRole('button', { name: 'Solicitar máquinas' }).click()
      assert.equal(state.calls.filter(c => c.path.endsWith('/machines')).length, 0)
      await count.fill('3')
      state.fail = true
      await page.getByRole('button', { name: 'Solicitar máquinas' }).click()
      await page.getByText('Não foi possível solicitar as máquinas.', { exact: false }).waitFor()
      assert.equal(await count.inputValue(), '3')
      state.fail = false
      await page.getByRole('button', { name: 'Solicitar máquinas' }).click()
      await page.getByText('Preparando seu laboratório para 3 máquina(s).', { exact: false }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Solicitar máquinas' }).count(), 0)
      state.resources.machineCount = 3; state.resources.provisioning = false
      // The real component must observe readiness via its own scheduled refresh.
      await page.getByText('O limite de máquinas de demonstração', { exact: false }).waitFor()
      assert.equal(await page.evaluate(() => window.hostRefreshes), 1)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: `${output}/quota-${width}.png`, fullPage: true })
      state.resources.machineCount = 1; state.resources.requestedMachines = 1
      await page.getByRole('button', { name: 'Atualizar laboratório' }).click()
      await page.getByRole('button', { name: 'Cadastrar meu host' }).click()
      await page.getByLabel('Nome do host', { exact: true }).fill('Meu servidor')
      await page.getByLabel('IPv4 público do host').fill('1.1.1.1')
      await page.getByLabel('Usuário SSH', { exact: true }).fill('teste')
      await page.getByLabel('Senha SSH', { exact: true }).fill('Synthetic-fixture-password')
      state.failHost = true
      await page.getByRole('button', { name: 'Salvar meu host' }).click()
      await page.getByText('O destino, a quota ou a permissão', { exact: false }).waitFor()
      assert.equal(await page.getByLabel('Senha SSH', { exact: true }).inputValue(), 'Synthetic-fixture-password')
      state.failHost = false
      await page.getByRole('button', { name: 'Salvar meu host' }).click()
      await page.getByRole('button', { name: 'Editar host Meu servidor' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Cadastrar meu host', exact: true }).isDisabled(), true)
      await page.getByRole('button', { name: 'Editar host Meu servidor' }).click()
      assert.equal(await page.getByLabel('Senha SSH', { exact: true }).inputValue(), '')
      await page.getByLabel('Nome do host', { exact: true }).fill('Meu servidor editado')
      await page.getByRole('button', { name: 'Salvar meu host' }).click()
      await page.getByRole('button', { name: 'Editar host Meu servidor editado' }).waitFor()
      assert.equal(state.calls.findLast(c => c.method === 'PUT').body.password, undefined)
      await page.getByRole('button', { name: 'Remover host Meu servidor editado' }).click()
      await page.getByRole('button', { name: 'Manter host', exact: true }).click()
      assert.equal(state.calls.filter(c => c.method === 'DELETE').length, 0)
      await page.getByRole('button', { name: 'Remover host Meu servidor editado' }).click()
      await page.getByRole('button', { name: 'Remover cadastro', exact: true }).click()
      await page.getByText('Cadastro removido.', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Cadastrar meu host', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Cadastrar meu host', exact: true }).isDisabled(), false)
      state.experience = 'full'
      await page.reload()
      await page.locator('summary').waitFor()
      assert.equal(await page.locator('details').evaluate(el => el.open), false)
      await page.locator('summary').click()
      await page.getByText('Use o cadastro normal de hosts', { exact: false }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Cadastrar meu host', exact: true }).count(), 0)
      await page.screenshot({ path: `${output}/full-resources-${width}.png`, fullPage: true })
      state.trial = false
      const before = state.calls.filter(c => c.path.endsWith('/trials/me/resources')).length
      await page.reload()
      await page.waitForTimeout(400)
      assert.equal(await page.getByRole('heading', { name: 'Seu laboratório de teste' }).count(), 0)
      assert.equal(state.calls.filter(c => c.path.endsWith('/trials/me/resources')).length, before)
      assert.deepEqual(errors, [])
      results.push({ width, result: 'PASS', cases: ['full panel collapsed and normal CRUD guidance', 'automatic readiness polling', 'total quota', 'invalid count', '503 preserves selection', 'provisioning feedback', 'ready refreshes Hosts', 'normal profile unaffected', 'custom host blocked destination preserves input', 'custom host creation quota', 'edit preserves undisplayed credential', 'delete requires confirmation', 'responsive'] })
      await context.close()
    }
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
