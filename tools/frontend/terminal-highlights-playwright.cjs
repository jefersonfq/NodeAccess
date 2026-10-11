#!/usr/bin/env node
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const rule = (name, color = 'amber', priority = 50) => ({ id: require('node:crypto').randomUUID(), name, pattern: 'ERROR', mode: 'literal', caseSensitive: false, wholeWord: true, foreground: color, background: null, bold: true, enabled: true, priority })
const token = role => `e30.${Buffer.from(JSON.stringify({ sub: role === 'admin' ? '1' : '2', tenantId: 1, role, name: role, stage: 'authenticated', exp: 4102444800 })).toString('base64url')}.mock`

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const failures = new Map(), delays = new Map(), requests = [], errors = [], checks = []
  let templates = [], preference = { enabled: true, rules: [] }, nextId = 81
  const failNext = (method, path, message = 'Falha temporária simulada') => failures.set(`${method} ${path}`, message)
  function effective(userId) {
    const assigned = templates.filter(t => t.active && (t.userIds.includes(userId) || t.groupIds.includes(7)))
    const rules = assigned.flatMap(t => t.rules.map(r => ({ ...r, source: 'template', assignment: t.userIds.includes(userId) ? 'direct' : 'group', templateId: t.id, templateName: t.name })))
    if (userId === 2) rules.push(...preference.rules.map(r => ({ ...r, source: 'personal', assignment: 'personal', templateId: null, templateName: null })))
    const rank = { direct: 0, group: 1, personal: 2 }
    rules.sort((a, b) => rank[a.assignment] - rank[b.assignment] || b.priority - a.priority)
    return { enabled: userId === 2 ? preference.enabled : true, rules: rules.filter(r => r.enabled).slice(0, 40), templates: assigned.map(t => ({ id: t.id, name: t.name, version: t.version, assignment: t.userIds.includes(userId) ? 'direct' : 'group' })), omittedRules: 0, version: 'test', limits: { maxRules: 40, budgetMs: 8, maxMatchesPerPass: 120 } }
  }
  async function pageFor(role) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' })
    await context.addInitScript(({auth, theme}) => { localStorage.setItem('na_access_token', auth); localStorage.setItem('nodeaccess_locale', 'pt-BR'); localStorage.setItem('na_ui_theme_mode', theme) }, {auth: token(role), theme: process.env.UI_THEME || 'dark'})
    await context.routeWebSocket('**/ws/events*', () => {})
    await context.route('**/api/v1/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), key = `${method} ${path}`
      requests.push({ role, method, path })
      if (delays.has(key)) { const delay = delays.get(key); delays.delete(key); await new Promise(resolve => setTimeout(resolve, delay)) }
      if (failures.has(key)) { const message = failures.get(key); failures.delete(key); if (message === 'NETWORK_ABORT') return route.abort('failed'); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message }) }) }
      let body = {}, status = 200
      if (path === '/api/v1/terminal-highlights/preference') { if (method === 'PUT') preference = request.postDataJSON(); body = { ...preference, version: 1 } }
      else if (path === '/api/v1/terminal-highlights/effective') body = effective(role === 'admin' ? 1 : 2)
      else if (/\/admin\/users\/\d+\/effective$/.test(path)) body = effective(Number(path.split('/').at(-2)))
      else if (path === '/api/v1/terminal-highlights/admin/templates') {
        if (method === 'POST') { const t = { id: nextId++, version: 1, updatedAt: new Date().toISOString(), ...request.postDataJSON() }; templates.push(t); body = t } else body = templates
      } else if (/\/admin\/templates\/\d+$/.test(path)) {
        const id = Number(path.split('/').at(-1))
        if (method === 'DELETE') { templates = templates.filter(t => t.id !== id); status = 204 }
        else if (method === 'PUT') { templates = templates.map(t => t.id === id ? { ...t, ...request.postDataJSON(), version: t.version + 1 } : t); body = templates.find(t => t.id === id) }
      } else if (path.endsWith('/duplicate')) body = { id: 99 }
      else if (path.endsWith('/versions')) body = [{ id: '1', version: 1, name: 'Operação', rules: templates[0]?.rules || [], createdAt: new Date().toISOString() }]
      else if (path.endsWith('/restore')) body = { id: 81 }
      else if (path.endsWith('/admin/telemetry')) body = []
      else if (path.endsWith('/admin/cache')) { body = { entries: 0, ttlMs: 30000 }; if (method === 'DELETE') status = 204 }
      else if (path.endsWith('/admin/adoption')) body = { configuredUsers: 1, disabledUsers: preference.enabled ? 0 : 1, templates: templates.length, userAssignments: templates.reduce((n, t) => n + t.userIds.length, 0), groupAssignments: templates.reduce((n, t) => n + t.groupIds.length, 0), activeUsers30d: 1 }
      else if (path === '/api/v1/users') body = { data: [{ id: 2, name: 'Usuário teste', email: 'user@test', active: true }, { id: 3, name: 'Segundo usuário', email: 'second@test', active: true }], total: 2, page: 1, totalPages: 1 }
      else if (path === '/api/v1/groups') body = [{ id: 7, name: 'NOC' }]
      else if (path === '/api/v1/users/me/preferences') body = null
      else if (path === '/api/v1/hosts') body = { data: [], total: 0, page: 1, totalPages: 0 }
      else if (path === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 0, folders: {}, groups: {}, tags: {} }, folders: [], groups: [], tags: [] }
      else if (path === '/api/v1/sessions/access-map') body = { totals: {}, hosts: [] }
      else if (path === '/api/v1/features') body = { integrationProviders: {} }
      else if (path === '/api/v1/tags' || path === '/api/v1/folders') body = []
      await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body) })
    })
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    page.on('pageerror', error => { errors.push(error.message); console.error('BROWSER ERROR', error.message) })
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    return page
  }
  const button = (page, name) => page.getByRole('button', { name, exact: true })
  async function check(name, fn) {
    try { await fn(); checks.push(name); console.log(`PASS ${name}`) }
    catch (error) {
      for (const [index, context] of browser.contexts().entries()) {
        const page = context.pages()[0]
        if (page) await page.screenshot({ path: `/tmp/nodeaccess-highlights-failure-${index}.png`, fullPage: true }).catch(() => {})
      }
      fs.writeFileSync('/tmp/nodeaccess-highlights-failure.json', JSON.stringify({ scenario: name, errors, message: error.message }, null, 2))
      throw error
    }
  }
  try {
    const user = await pageFor('user'), admin = await pageFor('admin')
    await check('personal load error has retry and cannot overwrite unloaded preferences', async () => {
      failNext('GET', '/api/v1/terminal-highlights/preference')
      await user.goto(`${FRONTEND}/profile/terminal-highlights`)
      await user.getByText('Não foi possível carregar suas regras.', { exact: true }).waitFor()
      assert.equal(await button(user, 'Salvar personalização').count(), 0)
      await button(user, 'Tentar novamente').click(); await button(user, 'Adicionar regra').waitFor()
      assert.equal(await button(user, 'Novo template').count(), 0)
      await user.getByText('Nenhum template atribuído.', { exact: true }).waitFor()
    })
    await check('personal save failure retains draft; retry and invalid regex work', async () => {
      await button(user, 'Adicionar regra').click()
      await user.getByPlaceholder('Nome da regra').fill('Meu ERROR')
      await user.getByPlaceholder('ERROR ou WARN*').fill('ERROR')
      failNext('PUT', '/api/v1/terminal-highlights/preference')
      await button(user, 'Salvar personalização').click(); await user.getByText('Falha temporária simulada', { exact: true }).waitFor()
      assert.equal(await user.getByPlaceholder('Nome da regra').inputValue(), 'Meu ERROR')
      await button(user, 'Salvar personalização').click(); await user.locator('[data-effective-rule]').waitFor()
      assert.equal(preference.rules.length, 1)
      const editor = user.locator('[data-terminal-highlight-rule-editor]')
      await editor.locator('.n-base-selection').first().click(); await user.getByText('Regex avançado', { exact: true }).last().click()
      await user.getByPlaceholder('\\bERROR\\b').fill('(')
      const saves = requests.filter(r => r.method === 'PUT').length
      await button(user, 'Salvar personalização').click(); await user.getByText('Regex inválido: Meu ERROR', { exact: true }).waitFor()
      assert.equal(requests.filter(r => r.method === 'PUT').length, saves)
      await user.reload(); await user.locator('[data-effective-rule]').waitFor()
    })
    await check('user cannot navigate to administration or request admin data', async () => {
      await user.goto(`${FRONTEND}/admin/terminal-highlights`)
      await user.waitForURL('**/hosts')
      assert.equal(requests.filter(r => r.role === 'user' && r.path.includes('/terminal-highlights/admin/')).length, 0)
      await user.goto(`${FRONTEND}/profile/terminal-highlights`)
    })
    await check('admin navigation is separate; initial failure retries', async () => {
      await admin.goto(`${FRONTEND}/profile/terminal-highlights`)
      assert.equal(await button(admin, 'Novo template').count(), 0)
      failNext('GET', '/api/v1/terminal-highlights/admin/templates')
      await admin.getByRole('link', { name: 'Gerenciar destaques da organização' }).click()
      await admin.getByText('Não foi possível carregar a gestão de destaques.', { exact: true }).waitFor()
      await button(admin, 'Tentar novamente').click(); await button(admin, 'Novo template').waitFor()
      assert.equal(await button(admin, 'Salvar personalização').count(), 0)
      await admin.getByText('Nenhum template administrativo configurado.', { exact: true }).waitFor()
    })
    await check('admin creates template for multiple users and group; failed save preserves modal', async () => {
      await button(admin, 'Novo template').click(); const modal = admin.locator('.n-modal:visible').last()
      await modal.locator('input').first().fill('Operação')
      await button(modal, 'Adicionar regra').click(); await modal.getByPlaceholder('Nome da regra').fill('ERROR corporativo')
      await modal.getByPlaceholder('ERROR ou WARN*').fill('ERROR')
      await modal.locator('[data-terminal-highlight-rule-editor] .n-base-selection').nth(1).click(); await admin.getByText('Vermelho', { exact: true }).last().click()
      await modal.locator('.n-base-selection--multiple').first().click(); await admin.getByText('Usuário teste · user@test', { exact: true }).click(); await admin.getByText('Segundo usuário · second@test', { exact: true }).click()
      await modal.locator('.n-card-header__main').click()
      await modal.locator('.n-base-selection--multiple').nth(1).click(); await admin.getByText('NOC', { exact: true }).last().click()
      failNext('POST', '/api/v1/terminal-highlights/admin/templates', 'Falha ao gravar template')
      await button(modal, 'Salvar e aplicar').click(); await admin.getByText('Falha ao gravar template', { exact: true }).waitFor()
      assert.equal(await modal.locator('input').first().inputValue(), 'Operação')
      await button(modal, 'Salvar e aplicar').click(); await modal.waitFor({ state: 'hidden' })
      assert.deepEqual(templates[0].userIds, [2, 3]); assert.deepEqual(templates[0].groupIds, [7])
      assert.equal(preference.rules[0].name, 'Meu ERROR')
    })
    await check('admin user preview retries failure and displays effective order', async () => {
      failNext('GET', '/api/v1/terminal-highlights/admin/users/2/effective')
      await admin.getByLabel('Usuário para consulta', { exact: true }).click()
      await admin.getByText('Usuário teste · user@test', { exact: true }).last().click()
      await admin.getByText('Não foi possível consultar este usuário.', { exact: true }).waitFor()
      await button(admin, 'Recarregar configuração').click(); await admin.locator('[data-effective-rule]').first().waitFor()
      assert.match(await admin.locator('[data-effective-rule]').first().innerText(), /Atribuição direta/)
      assert.equal(await admin.locator('[data-effective-rule]').count(), 2)
    })
    await check('personal view receives read-only templates, preview, opt-out and recovery', async () => {
      await user.reload(); await user.getByText('Operação', { exact: true }).first().waitFor()
      assert.equal(await user.locator('[data-terminal-highlight-rule-editor]').count(), 1)
      assert.equal(await button(user, 'Editar e vincular').count(), 0)
      await user.getByLabel('Simular com uma linha de exemplo').fill('ERROR e OK')
      assert.match(await user.locator('[data-effective-preview]').innerText(), /ERROR e OK/)
      assert.equal(await user.locator('[data-effective-preview] span').first().evaluate(e => getComputedStyle(e).color), 'rgb(248, 113, 113)')
      await user.getByRole('switch', { name: 'Aplicar destaques no terminal', exact: true }).click()
      await button(user, 'Salvar personalização').click(); await user.getByText('Destaques desativados pelo usuário.', { exact: false }).waitFor()
      assert.equal(preference.enabled, false)
      await admin.reload(); await admin.getByLabel('Usuário para consulta', { exact: true }).click(); await admin.getByText('Usuário teste · user@test', { exact: true }).last().click()
      await admin.getByText('Destaques desativados pelo usuário.', { exact: false }).waitFor()
      await user.getByRole('switch', { name: 'Aplicar destaques no terminal', exact: true }).click()
      failNext('GET', '/api/v1/terminal-highlights/effective')
      await button(user, 'Salvar personalização').click(); await user.getByText('Não foi possível consultar a configuração em uso.', { exact: true }).waitFor()
      assert.equal(preference.enabled, true)
      await button(user, 'Recarregar configuração').click(); await user.locator('[data-effective-rule]').first().waitFor()
    })
    await check('desktop/mobile views fit and keyboard reaches personal save', async () => {
      for (const [name, page, selector] of [['personal', user, '[data-terminal-highlights-page]'], ['admin', admin, '[data-terminal-highlights-admin-page]']]) {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200)
          const bounds = await page.locator(selector).boundingBox(); assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, JSON.stringify(bounds))
          assert.equal(await page.locator(selector).evaluate(e => e.scrollWidth <= e.clientWidth + 1), true)
          await page.screenshot({ path: `/tmp/nodeaccess-highlights-${name}-${width}.png`, fullPage: true })
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      await button(user, 'Salvar personalização').focus(); assert.equal(await button(user, 'Salvar personalização').evaluate(e => e === document.activeElement), true)
      await user.keyboard.press('Enter'); await user.getByText('Personalização salva. Terminais abertos foram atualizados.').last().waitFor()
    })
    await check('late admin preview cannot replace the newly selected user', async () => {
      delays.set('GET /api/v1/terminal-highlights/admin/users/2/effective', 800)
      await button(admin, 'Atualizar consulta').click()
      await admin.getByLabel('Usuário para consulta', { exact: true }).click()
      await admin.getByText('Segundo usuário · second@test', { exact: true }).last().click()
      await admin.locator('[data-effective-rule]').first().waitFor()
      assert.equal(await admin.locator('[data-effective-rule]').count(), 1)
      await admin.waitForTimeout(1000)
      assert.equal(await admin.locator('[data-effective-rule]').count(), 1, 'late response leaked previous user rules')
      assert.equal(await admin.getByText('2. Meu ERROR', { exact: true }).count(), 0)
    })
    await check('network interruption preserves personal draft and recovers on retry', async () => {
      await user.getByPlaceholder('Nome da regra').fill('Meu ERROR revisado')
      failNext('PUT', '/api/v1/terminal-highlights/preference', 'NETWORK_ABORT')
      await button(user, 'Salvar personalização').click()
      await user.getByText('Não foi possível salvar as regras. Suas alterações foram mantidas.', { exact: true }).waitFor()
      assert.equal(await user.getByPlaceholder('Nome da regra').inputValue(), 'Meu ERROR revisado')
      assert.equal(preference.rules[0].name, 'Meu ERROR')
      await user.getByPlaceholder('Nome da regra').fill('Meu ERROR')
      await button(user, 'Salvar personalização').click()
      await user.getByText('Personalização salva. Terminais abertos foram atualizados.').last().waitFor()
    })
    await check('canceling an edit discards its isolated draft without changing the saved template', async () => {
      await button(admin, 'Editar e vincular').click()
      const modal = admin.locator('.n-modal:visible').last()
      await modal.getByPlaceholder('Nome da regra').fill('Rascunho cancelado')
      const writes = requests.filter(r => r.method === 'PUT' && r.path.includes('/admin/templates/')).length
      await button(modal, 'Cancelar').click(); await modal.waitFor({ state: 'hidden' })
      await button(admin, 'Editar e vincular').click()
      assert.equal(await modal.getByPlaceholder('Nome da regra').inputValue(), 'ERROR corporativo')
      assert.equal(requests.filter(r => r.method === 'PUT' && r.path.includes('/admin/templates/')).length, writes)
      await button(modal, 'Cancelar').click(); await modal.waitFor({ state: 'hidden' })
    })
    await check('removing direct links falls back to group; deactivation falls back to personal and reactivation restores group', async () => {
      await button(admin, 'Editar e vincular').click()
      let modal = admin.locator('.n-modal:visible').last()
      const recipients = modal.locator('.n-base-selection--multiple').first()
      await recipients.locator('.n-tag__close').first().click()
      await recipients.locator('.n-tag__close').first().click()
      failNext('PUT', '/api/v1/terminal-highlights/admin/templates/81', 'Falha ao atualizar vínculos')
      await button(modal, 'Salvar e aplicar').click(); await admin.getByText('Falha ao atualizar vínculos', { exact: true }).waitFor()
      assert.equal(await recipients.locator('.n-tag').count(), 0)
      assert.deepEqual(templates[0].userIds, [2, 3])
      await button(modal, 'Salvar e aplicar').click(); await modal.waitFor({ state: 'hidden' })
      assert.deepEqual(templates[0].userIds, [])
      await user.reload(); await user.locator('[data-effective-rule]').first().waitFor()
      assert.match(await user.locator('[data-effective-rule]').first().innerText(), /Por grupo/)
      assert.equal(await user.locator('[data-effective-preview] span').first().evaluate(e => getComputedStyle(e).color), 'rgb(248, 113, 113)')
      await button(admin, 'Editar e vincular').click(); modal = admin.locator('.n-modal:visible').last()
      await modal.locator('.n-form-item').filter({ hasText: 'Status' }).getByRole('switch').click()
      await button(modal, 'Salvar e aplicar').click(); await modal.waitFor({ state: 'hidden' })
      await user.reload(); await user.getByText('Nenhum template atribuído.', { exact: true }).waitFor()
      assert.equal(await user.locator('[data-effective-rule]').count(), 1)
      assert.equal(await user.locator('[data-effective-preview] span').first().evaluate(e => getComputedStyle(e).color), 'rgb(251, 191, 36)')
      await button(admin, 'Editar e vincular').click(); modal = admin.locator('.n-modal:visible').last()
      await modal.locator('.n-form-item').filter({ hasText: 'Status' }).getByRole('switch').click()
      await button(modal, 'Salvar e aplicar').click(); await modal.waitFor({ state: 'hidden' })
      await user.reload(); await user.locator('[data-effective-rule]').first().waitFor()
      assert.match(await user.locator('[data-effective-rule]').first().innerText(), /Por grupo/)
    })
    await check('history, restore confirmation, duplicate and cache recover from errors', async () => {
      failNext('GET', '/api/v1/terminal-highlights/admin/templates/81/versions')
      await button(admin, 'Histórico').click(); await admin.getByText('Não foi possível carregar o histórico. Tente novamente.', { exact: true }).waitFor()
      await button(admin, 'Histórico').click(); await admin.getByText('Versão 1', { exact: true }).last().waitFor()
      await button(admin, 'Restaurar').click(); const cancelDialog = admin.locator('.n-dialog'); await cancelDialog.getByRole('button', { name: 'Cancelar', exact: true }).click(); await cancelDialog.waitFor({ state: 'hidden' })
      await button(admin, 'Restaurar').click()
      failNext('POST', '/api/v1/terminal-highlights/admin/templates/81/versions/1/restore', 'Falha ao restaurar')
      const restoreDialog = admin.locator('.n-dialog')
      await button(restoreDialog, 'Restaurar').click(); await admin.getByText('Falha ao restaurar', { exact: true }).waitFor()
      await button(restoreDialog, 'Restaurar').click(); await restoreDialog.waitFor({ state: 'hidden' })
      await admin.getByText('Versão 1 restaurada como uma nova revisão.', { exact: true }).waitFor()
      failNext('POST', '/api/v1/terminal-highlights/admin/templates/81/duplicate', 'Falha ao duplicar')
      await button(admin, 'Duplicar').click(); await admin.getByText('Falha ao duplicar', { exact: true }).waitFor()
      await button(admin, 'Duplicar').click(); await admin.getByText('Cópia criada inativa para revisão.', { exact: true }).waitFor()
      failNext('DELETE', '/api/v1/terminal-highlights/admin/cache', 'Falha ao limpar cache')
      await button(admin, 'Limpar cache').click(); await admin.getByText('Falha ao limpar cache', { exact: true }).waitFor()
      await button(admin, 'Limpar cache').click(); await admin.getByText('Cache limpo. Terminais conectados receberam o evento de atualização.', { exact: true }).waitFor()
    })
    await check('deletion confirms, retains dialog on failure and preserves personal rules', async () => {
      await button(admin, 'Excluir').click()
      failNext('DELETE', '/api/v1/terminal-highlights/admin/templates/81', 'Falha ao excluir')
      const dialog = admin.getByRole('dialog').last()
      await button(dialog, 'Excluir').click(); await admin.getByText('Falha ao excluir', { exact: true }).waitFor()
      await button(dialog, 'Excluir').click(); await dialog.waitFor({ state: 'hidden' })
      assert.equal(templates.length, 0)
      await user.reload(); await user.getByText('Nenhum template atribuído.', { exact: true }).waitFor()
      assert.equal(await user.getByPlaceholder('Nome da regra').inputValue(), 'Meu ERROR')
      assert.equal(await user.locator('[data-effective-rule]').count(), 1)
    })
    await check('preset library previews without writes; cancel preserves draft and failures retain generated rules', async () => {
      await button(admin, 'Novo template').click()
      const modal = admin.locator('.n-modal:visible').last()
      await modal.locator('input').first().fill('Meu rascunho')
      await modal.locator('.n-base-selection--multiple').first().click()
      await admin.getByText('Usuário teste · user@test', {exact:true}).last().click()
      await modal.locator('.n-card-header__main').click()
      await modal.locator('.n-base-selection--multiple').nth(1).click()
      await admin.getByText('NOC', {exact:true}).last().click()
      await modal.locator('.n-card-header__main').click()
      await button(modal, 'Usar modelo pronto').click()
      const picker = modal.locator('[data-highlight-preset-picker]')
      const writes = () => requests.filter(r => r.method === 'POST' && r.path.endsWith('/admin/templates')).length
      const before = writes()
      for (const name of ['Clássico', 'Linux e infraestrutura', 'Redes / NOC', 'Logs de aplicações', 'Discreto']) {
        await button(picker, name).click()
        assert.ok((await picker.locator('[data-highlight-preset-preview]').innerText()).length > 0)
        assert.ok(await picker.locator('[data-highlight-preset-preview] span[style*=color]').count())
      }
      await button(picker, 'Clássico').focus(); await button(picker, 'Clássico').press('Enter')
      assert.equal(await button(picker, 'Clássico').getAttribute('aria-pressed'), 'true')
      assert.equal(writes(), before)
      await admin.setViewportSize({width:390,height:844})
      await picker.scrollIntoViewIfNeeded()
      assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await admin.screenshot({path:`/tmp/nodeaccess-highlight-presets-mobile-${process.env.UI_THEME || 'dark'}.png`,fullPage:true})
      await admin.setViewportSize({width:1440,height:900})
      await button(picker, 'Usar este modelo').click()
      await button(admin.getByRole('dialog').last(), 'Manter rascunho').click()
      assert.equal(await modal.locator('input').first().inputValue(), 'Meu rascunho')
      await button(picker, 'Redes / NOC').click()
      await admin.waitForTimeout(250)
      await admin.screenshot({path:`/tmp/nodeaccess-highlight-presets-desktop-${process.env.UI_THEME || 'dark'}.png`,fullPage:true})
      await button(picker, 'Usar este modelo').click()
      await button(admin.getByRole('dialog').last(), 'Substituir rascunho').click()
      assert.equal(await modal.locator('input').first().inputValue(), 'Redes / NOC')
      assert.equal(await modal.getByPlaceholder('Nome da regra').count(), 4)
      failNext('POST', '/api/v1/terminal-highlights/admin/templates', 'Falha ao salvar modelo')
      await button(modal, 'Salvar e aplicar').click()
      await admin.getByText('Falha ao salvar modelo',{exact:true}).waitFor()
      assert.equal(await modal.getByPlaceholder('Nome da regra').count(),4)
      await button(modal, 'Salvar e aplicar').click()
      await modal.waitFor({state:'hidden'})
      assert.equal(templates[0].rules.length,4)
      assert.deepEqual(templates[0].userIds,[2]); assert.deepEqual(templates[0].groupIds,[7])
      await user.reload()
      await user.getByText('Redes / NOC',{exact:true}).first().waitFor()
      assert.equal(await button(user,'Usar modelo pronto').count(),0)
      assert.equal(preference.rules[0].name,'Meu ERROR')
    })
    assert.deepEqual(errors, [])
    fs.writeFileSync('/tmp/nodeaccess-terminal-highlights-report.json', JSON.stringify({ result: 'passed', frontend: FRONTEND, mockedApi: true, checks, errors }, null, 2))
    console.log(JSON.stringify({ result: 'passed', checks: checks.length, errors }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
