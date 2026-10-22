#!/usr/bin/env node
// Isolated browser acceptance: every API and WebSocket is mocked; never touches client hosts.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')

const base = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const output = process.env.HOST_FORM_ARTIFACTS || '/tmp/nodeaccess-host-form-tabs'
const timestamp = '2026-10-22T12:00:00.000Z'
const original = { id: 21, tenantId: 7, name: 'Host de demonstração', ip: '192.0.2.21', port: 2222,
  accessProtocol: 'ssh', operatingSystem: 'linux', sshUser: 'ops', authType: 'password', connectionMode: 'direct',
  scope: 'personal', ownerId: 41, groupId: null, folderId: null, inventoryParentId: 800, bastionId: null,
  pemKeyId: null, passwordSecretId: null, hasPasswordCredential: true, description: null,
  onePasswordRef: null, startupSnippetId: null, startupSnippetMode: 'disabled', tags: [], associatedLinks: [],
  accessPermissions: { view: true, connect: true, edit: true, admin: true }, createdAt: timestamp, updatedAt: timestamp }
const tabs = ['Conexão', 'Acesso', 'Organização', 'Recursos']
const tabKeys = ['connection', 'access', 'organization', 'resources']
const results = []
const startedAt = new Date().toISOString()
function gitRef(...args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}
const revision = {
  changeId: 'NA-0058',
  branch: process.env.GITHUB_HEAD_REF || gitRef('branch', '--show-current'),
  testedSha: gitRef('rev-parse', 'HEAD'),
  baseSha: '1755022aa2e8d884ddf295e3e2470acfdcb5ad24',
  nodeVersion: process.version,
}

async function main() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  try {
    for (const theme of (process.env.HOST_FORM_THEMES || 'dark,light').split(',')) for (const width of (process.env.HOST_FORM_WIDTHS || '1440,768,390').split(',').map(Number)) {
      const height = Number(process.env.HOST_FORM_HEIGHT || (width === 390 ? 844 : 960))
      const context = await browser.newContext({ viewport: { width, height }, locale: 'pt-BR', colorScheme: theme })
      const state = { host: { ...original }, writes: [], tests: [], failSave: false, failTest: false }
      const errors = []
      const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '41', userId: 41, tenantId: 7, name: 'Admin demonstração', role: 'admin', email: 'demo@example.test', stage: 'authenticated', iat: 1, exp: 4102444800 })).toString('base64url')}.fixture`
      await context.addInitScript(({ token, theme }) => {
        localStorage.setItem('na_access_token', token)
        localStorage.setItem('na_refresh_token', 'fixture')
        localStorage.setItem('na_hosts_default_view', 'all')
        localStorage.setItem('na_ui_theme_mode', theme)
        localStorage.setItem('nodeaccess_locale', 'pt-BR')
      }, { token, theme })
      await context.routeWebSocket(/.*/, socket => socket.close())
      await context.route('**/api/v1/**', async route => {
        const req = route.request(), url = new URL(req.url()).pathname
        let body = [], status = 200
        if (url === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 1, global: 0, unfiled: 0, maxHosts: 50, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
        else if (url === '/api/v1/hosts/test-connection') {
          state.tests.push(req.postDataJSON())
          body = state.failTest ? { success: false, latencyMs: null, message: 'Falha simulada de conexão', error: 'ECONNREFUSED' } : { success: true, latencyMs: 12, message: 'Conexão realizada com sucesso' }
        } else if ((url === '/api/v1/hosts' && req.method() === 'POST') || (url === '/api/v1/hosts/21' && req.method() === 'PATCH')) {
          state.writes.push({ method: req.method(), payload: req.postDataJSON(), failed: state.failSave })
          if (state.failSave) { status = 500; body = { message: 'Falha simulada ao salvar' } }
          else { state.host = { ...state.host, ...req.postDataJSON() }; body = state.host }
        } else if (url === '/api/v1/hosts') body = { data: [state.host], total: 1, page: 1, limit: 20, totalPages: 1 }
        else if (url === '/api/v1/hosts/21') body = state.host
        else if (url === '/api/v1/inventory') body = [{ id: 800, parentId: null, type: 'ROOT', name: 'Infraestrutura', path: '/Infraestrutura', depth: 0 }, { id: 801, parentId: 800, type: 'HOST', hostId: 21, name: state.host.name, path: '/Infraestrutura/demo', depth: 1 }]
        else if (url === '/api/v1/secrets') body = [{ id: 91, alias: 'Secret de demonstração', scope: 'PERSONAL', ownerId: 41, tenantId: 7, createdAt: timestamp }]
        else if (url === '/api/v1/pem-keys') body = [{ id: 31, name: 'PEM de demonstração', scope: 'personal', ownerId: 41, createdAt: timestamp }]
        else if (url === '/api/v1/snippets') body = [{ id: 51, name: 'Macro de demonstração', command: 'printf fixture', scope: 'personal', ownerId: 41 }]
        else if (url === '/api/v1/sessions/access-map') body = { generatedAt: timestamp, refreshAfterSeconds: 30, totals: { activeSessions: 0, activeHosts: 0, uniqueUsers: 0, concurrentHosts: 0 }, hosts: [] }
        else if (url === '/api/v1/features') body = { secrets: true }
        else if (url === '/api/v1/settings') body = { tenant: { id: 7, name: 'Demonstração', slug: 'demo' }, license: { maxUsers: 10, maxHosts: 50, activeUsers: 1, registeredHosts: 1, hasKey: true, featureEntitlements: { secrets: true }, integrationEntitlements: {} } }
        else if (url === '/api/v1/integrations/onepassword/status') body = { active: false }
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => errors.push(error.message))
      const modal = page.getByTestId('host-form-modal')
      const tab = name => modal.locator('#host-form-tab-' + tabKeys[tabs.indexOf(name)])
      const field = label => modal.getByLabel(label, { exact: true })
      const choose = async (control, option) => { await control.click(); await page.locator('.n-base-select-option').filter({ hasText: option }).filter({ visible: true }).getByText(option, { exact: true }).click() }
      const save = () => modal.getByRole('button', { name: /^(Salvar|Criar|Save|Create)$/ }).click()
      const screenshot = async suffix => {
        if (/^(create|edit)-/.test(suffix)) {
          await page.locator('.n-message').first().waitFor({ state: 'hidden', timeout: 10000 })
          await modal.locator('.host-form-scroll').evaluate(el => { el.scrollTop = 0 })
        }
        return page.screenshot({ path: path.join(output, `${theme}-${width}-${suffix}.png`), fullPage: true })
      }
      try {
        await page.goto(`${base}/hosts`, { waitUntil: 'domcontentloaded' })
        await page.getByText('Ver todos os hosts →', { exact: true }).click()
        await page.locator('[data-host-new-button="true"]').first().click()
        await modal.waitFor()
        assert.equal(await tab('Conexão').getAttribute('aria-selected'), 'true')
        await tab('Conexão').focus()
        await page.keyboard.press('ArrowRight')
        assert.equal(await tab('Acesso').getAttribute('aria-selected'), 'true')
        await page.keyboard.press('End')
        assert.equal(await tab('Recursos').getAttribute('aria-selected'), 'true')
        await page.keyboard.press('Home')
        assert.equal(await tab('Conexão').getAttribute('aria-selected'), 'true')
        await tab('Recursos').click()
        await save()
        assert.equal(state.writes.length, 0)
        await tab('Conexão').waitFor()
        assert.equal(await tab('Conexão').getAttribute('aria-selected'), 'true')
        assert.equal(await field('Nome').evaluate(el => el === document.activeElement), true)
        await field('Nome').fill('Host piloto')
        await field('Endereço IP / Hostname').fill('192.0.2.42')
        await field('Usuário SSH').fill('ops')
        await modal.locator('#host-form-password').fill('fixture-only-password')
        await field('Porta').fill('2222')
        const assertControlAlignment = async () => {
          if (width < 640) return // Mobile intentionally stacks these fields.
          const pairs = await modal.evaluate(el => {
            const rect = selector => {
              const target = el.querySelector(selector)
              const control = target?.closest('.n-input') || target?.querySelector('.n-base-selection') || target
              if (!control) throw new Error(`Missing alignment control: ${selector}`)
              const box = control.getBoundingClientRect()
              return { top: box.top, left: box.left, width: box.width, height: box.height }
            }
            return [
              { name: 'SSH user/authentication', first: rect('#host-form-ssh-user'), second: rect('#host-form-auth-type') },
              { name: 'Connection mode/bastion', first: rect('#host-form-route'), second: rect('#host-form-bastion') },
            ]
          })
          for (const pair of pairs) {
            assert.ok(pair.first.height > 0 && pair.second.height > 0, `${pair.name}: controls must be visible`)
            assert.ok(Math.abs(pair.first.top - pair.second.top) <= 1, `${pair.name}: control tops must align: ${JSON.stringify(pair)}`)
          }
        }
        for (const [index, name] of tabs.entries()) {
          await tab(name).click()
          assert.equal(await modal.locator(`[data-host-form-tab="${tabKeys[index]}"]`).isVisible(), true)
          assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
          for (const control of [tab(name), modal.getByRole('button', { name: 'Criar', exact: true }), modal.getByRole('button', { name: 'Cancelar', exact: true })]) {
            const rect = await control.boundingBox()
            assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1, 'Tab/footer outside viewport: ' + JSON.stringify(rect))
          }
          await screenshot(`create-${tabKeys[index]}`)
          if (name === 'Conexão') await assertControlAlignment()
        }
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const name of ['Acesso', 'Organização', 'Recursos', 'Conexão']) {
          await tab(name).click()
          const panel = modal.locator(`[data-host-form-tab="${tabKeys[tabs.indexOf(name)]}"]`)
          assert.equal(await panel.evaluate(el => getComputedStyle(el).animationName), 'none', `${name}: reduced motion must disable panel animation`)
          assert.equal(await tab(name).evaluate(el => el === document.activeElement), true, 'Changing tabs must retain keyboard focus on its navigation control')
        }
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await tab('Conexão').click()
        assert.equal(await field('Nome').inputValue(), 'Host piloto')
        assert.equal(await modal.locator('#host-form-password').inputValue(), 'fixture-only-password')
        state.failTest = true
        await modal.getByRole('button', { name: 'Testar conexão', exact: true }).click()
        await page.getByText('Falha simulada de conexão', { exact: false }).first().waitFor()
        await screenshot('test-error')
        state.failTest = false
        await modal.getByRole('button', { name: 'Testar conexão', exact: true }).click()
        await page.getByText('Conexão realizada com sucesso', { exact: false }).first().waitFor()
        state.failSave = true
        await save()
        await page.waitForFunction(() => document.body.innerText.includes('Falha simulada ao salvar'))
        assert.equal(await field('Nome').inputValue(), 'Host piloto')
        state.failSave = false
        await tab('Recursos').click()
        await modal.getByRole('button', { name: 'Adicionar link', exact: true }).click()
        await field('URL / template').fill('https://example.test/incomplete')
        await tab('Conexão').click()
        const writesBeforeInvalidLink = state.writes.length
        await save()
        assert.equal(state.writes.length, writesBeforeInvalidLink)
        assert.equal(await tab('Recursos').getAttribute('aria-selected'), 'true')
        assert.equal(await field('Rótulo').evaluate(el => el === document.activeElement), true)
        await field('Rótulo').fill('Painel de demonstração')
        await field('URL / template').fill('https://example.test/hosts/{{HOST.IP}}')
        await choose(field('Modo'), 'Sugerir ao conectar')
        await tab('Conexão').click()
        await save()
        assert.equal(state.writes.length, writesBeforeInvalidLink)
        assert.equal(await tab('Recursos').getAttribute('aria-selected'), 'true')
        assert.equal(await modal.locator('#host-form-snippet').evaluate(el => el === document.activeElement || el.contains(document.activeElement)), true)
        await choose(field('Snippet'), 'Macro de demonstração')
        await save()
        await modal.waitFor({ state: 'hidden' })
        assert.equal(state.writes.at(-1).payload.password, 'fixture-only-password')
        assert.equal(state.writes.at(-1).payload.port, 2222)
        assert.equal(state.writes.at(-1).payload.startupSnippetId, 51)
        assert.equal(state.writes.at(-1).payload.startupSnippetMode, 'suggest')
        assert.equal(state.writes.at(-1).payload.associatedLinks[0].urlTemplate, 'https://example.test/hosts/{{HOST.IP}}')
        const edit = async () => {
          await page.locator('[data-host-id="21"]').first().locator('[data-host-actions-button="true"]').click()
          await page.getByText('Editar', { exact: true }).last().click()
          await modal.waitFor()
          assert.equal(await tab('Conexão').getAttribute('aria-selected'), 'true')
        }
        await edit()
        assert.equal(await field('Porta').inputValue(), '2222')
        await choose(modal.locator('[data-host-credential-source="true"]'), 'Usar Secret salvo')
        await choose(modal.locator('[data-host-secret-select="true"]'), 'Secret de demonstração')
        await tab('Organização').click(); await tab('Conexão').click()
        await save(); await modal.waitFor({ state: 'hidden' })
        assert.equal(state.writes.at(-1).payload.passwordSecretId, 91)
        assert.equal('password' in state.writes.at(-1).payload, false)
        await edit()
        for (const protocol of ['Telnet', 'RDP', 'VNC', 'SSH']) {
          await choose(field('Protocolo'), protocol)
          assert.equal(await field('Usuário SSH').isVisible(), protocol === 'SSH')
          assert.equal(await field('Tipo de autenticação').isVisible(), protocol === 'SSH')
          await screenshot(`edit-${protocol.toLowerCase()}`)
        }
        assert.equal(await field('Porta').inputValue(), '2222', 'Protocol switching must preserve a custom port')
        await choose(field('Tipo de autenticação'), '🔑 Chave PEM')
        await tab('Recursos').click()
        const writesBeforeInvalidPem = state.writes.length
        await save()
        assert.equal(state.writes.length, writesBeforeInvalidPem)
        assert.equal(await tab('Conexão').getAttribute('aria-selected'), 'true')
        assert.equal(await modal.locator('#host-form-pem').evaluate(el => el === document.activeElement || el.contains(document.activeElement)), true, 'Missing PEM must focus its select')
        await choose(field('Chave PEM'), 'PEM de demonstração')
        await save(); await modal.waitFor({ state: 'hidden' })
        assert.equal(state.writes.at(-1).payload.pemKeyId, 31)
        assert.equal(state.writes.at(-1).payload.authType, 'pem')
        for (const protocol of ['Telnet', 'RDP', 'VNC']) {
          await edit()
          await choose(field('Protocolo'), protocol)
          await save(); await modal.waitFor({ state: 'hidden' })
          const payload = state.writes.at(-1).payload
          assert.equal(payload.accessProtocol, protocol.toLowerCase())
          assert.equal(payload.port, 2222)
          assert.equal(payload.sshUser, '')
          assert.equal(payload.authType, 'password')
          assert.equal('pemKeyId' in payload, false)
          assert.equal('bastionId' in payload, false)
        }
        // A cancelled invalid draft must not poison validation of a saved host.
        await page.locator('[data-host-new-button="true"]').first().click()
        await modal.waitFor()
        await field('Nome').fill('Rascunho cancelado')
        await field('Endereço IP / Hostname').fill('host inválido ?')
        await tab('Acesso').click()
        await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
        await modal.waitFor({ state: 'hidden' })
        await edit()
        await field('Endereço IP / Hostname').fill('123.example.com')
        await save(); await modal.waitFor({ state: 'hidden' })
        assert.equal(state.writes.at(-1).payload.ip, '123.example.com')
        assert.deepEqual(errors, [])
        results.push({ theme, width, height, ok: true, writes: state.writes.length, connectionTests: state.tests.length })
        console.log(JSON.stringify(results.at(-1)))
      } catch (error) {
        console.error({ theme, width, browserErrors: errors, failure: String(error) })
        if (page.isClosed() || !browser.isConnected()) throw error
        console.error(JSON.stringify(await page.evaluate(() => ['.host-form-scroll', '.host-form-actions'].map(selector => {
          let el = document.querySelector(selector)
          const chain = []
          while (el && chain.length < 8) {
            const css = getComputedStyle(el), rect = el.getBoundingClientRect()
            chain.push({ tag: el.tagName, class: el.className, y: rect.y, height: rect.height, display: css.display, flex: css.flex, minHeight: css.minHeight, overflow: css.overflow })
            el = el.parentElement
          }
          return { selector, chain }
        })), null, 2))
        await screenshot('failure')
        await fs.writeFile(path.join(output, `${theme}-${width}-failure.txt`), await page.locator('body').innerText())
        throw error
      } finally { await context.close().catch(() => {}) }
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ ...revision, startedAt, finishedAt: new Date().toISOString(), ok: true, results }, null, 2))
    console.log(JSON.stringify({ ok: true, output, results }, null, 2))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
