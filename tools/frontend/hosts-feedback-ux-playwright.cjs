#!/usr/bin/env node
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5186'
const token = id => `e30.${Buffer.from(JSON.stringify({ sub: String(id), userId: id, tenantId: 7, role: 'admin', name: 'Teste', canManageHosts: true, stage: 'authenticated', exp: 4102444800 })).toString('base64url')}.mock`
async function main() {
 const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
 const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' })
 const results = [], errors = []
 let networkLoads = 0, networkFailure = false
 let tags = [{ id: 51, name: 'Homologação', color: '#2563eb' }], duplicate = true, mutations = 0, sftpFailure = 503, hostsFail = false, includeHost = false
 const folder = { id: 10, name: 'Cliente de teste', userId: 41, tenantId: 7, parentId: null }
 await context.addInitScript(auth => { if (!localStorage.getItem('na_access_token')) localStorage.setItem('na_access_token', auth); localStorage.setItem('nodeaccess_locale', 'pt-BR'); localStorage.setItem('na_hosts_default_view', 'all') }, token(41))
 await context.route('**/api/v1/**', async route => {
  const p = new URL(route.request().url()).pathname
  let body = [], status = 200
  if (p === '/api/v1/network-access') { networkLoads++; status = networkFailure ? 503 : 200; body = networkFailure ? {message: 'Falha simulada'} : {settings:{defaultProfile:'server_ssh',tacacsEnabled:false},devices:[],credentials:[],grants:[],events:[]} }
  else if (p === '/api/v1/network-access/profiles') body = {defaultProfile:'server_ssh'}
  else if (p === '/api/v1/network-access/health') body = { status: 'disabled', instances: [] }
  else if (p === '/api/v1/users') body = {data:[],total:0}
  else if (p === '/api/v1/hosts/sidebar-bootstrap') body = { summary: { all: 0, global: 0, unfiled: 0, maxHosts: 50, folders: { 10: 0 }, groups: {}, tags: { 51: 0 } }, folders: [folder], groups: [], tags }
  else if (p === '/api/v1/tags') body = tags
  else if (p === '/api/v1/tags/51' && route.request().method() === 'PATCH') {
   mutations++; if (duplicate) { status = 409; body = { message: 'Já existe uma tag com esse nome' } }
   else { tags = [{ id: 51, ...route.request().postDataJSON() }]; body = tags[0] }
  } else if (p === '/api/v1/folders') body = [folder]
  else if (p === '/api/v1/hosts') {
   if (hostsFail) { status = 503; body = { message: 'Falha HTTP simulada na VPN' } }
   else body = { data: includeHost ? [{ id: 20, name: 'Proxy de laboratório', ip: '192.0.2.20', port: 22, sshUser: 'lab', accessProtocol: 'ssh', authType: 'password', scope: 'global', tags: [], associatedLinks: [], accessPermissions: { view: true, connect: true, edit: true } }] : [], total: includeHost ? 1 : 0, page: 1, limit: 20, totalPages: 1 }
  }
  else if (p === '/api/v1/sessions/access-map') body = { totals: {}, hosts: [] }
  else if (p.startsWith('/api/v1/sftp/')) { if (sftpFailure === 'network') return route.abort('failed'); status = sftpFailure; body = { message: 'SFTP indisponível' } }
  else if (p === '/api/v1/integrations/oidc') body = { enabled:false, scopes:[], allowedDomains:[], acceptedAmrValues:[], acceptedAcrValues:[], autoProvision:false, requireMfaClaim:false }
  else if (p === '/api/v1/features') body = { integrationProviders: {}, integrationsLicensed: false, sessionAuditAiLicensed: false, localAiLicensed: false }
  else if (p === '/api/v1/session-supervision/permission') body = { enabled: false }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
 })
 await context.routeWebSocket('**/ws/events*', () => {})
 const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.text().includes('non-element root')) errors.push(message.text()) })
 async function check(name, fn) { await fn(); results.push(name) }
 try {
  await page.goto(`${base}/hosts`)
  const tag = () => page.locator('[data-hosts-sidebar-key="tag-51"]')
  const search = () => page.getByPlaceholder('Buscar por nome ou IP...')
  await page.locator('[data-hosts-sidebar-panel="tags"]').click(); await tag().waitFor()
  await check('keyboard tag edit, duplicate error retains edits, cancel does not save', async () => {
   const edit = page.getByRole('button', { name: 'Editar tag: Homologação', exact: true })
   await edit.focus(); await page.keyboard.press('Enter')
   const modal = page.locator('.n-modal'), name = modal.getByRole('textbox', { name: 'Nome', exact: true })
   await name.fill('Duplicada'); await modal.getByRole('button', { name: 'Salvar', exact: true }).click()
   await page.getByText('Já existe uma tag com esse nome', { exact: true }).waitFor()
   assert.equal(await name.inputValue(), 'Duplicada')
   await modal.getByRole('button', { name: 'Cancelar', exact: true }).click()
   assert.equal(mutations, 1)
   await edit.click(); await name.fill('Homologação revisada')
   const color = modal.getByLabel('Cor', { exact: true }); await color.fill('#ff0000')
   duplicate = false; await modal.getByRole('button', { name: 'Salvar', exact: true }).click()
   await modal.waitFor({ state: 'hidden' }); assert.deepEqual(tags[0], { id: 51, name: 'Homologação revisada', color: '#ff0000' })
  })
  await check('tag and search persist through navigation; explicit URL wins', async () => {
   await tag().click(); await search().fill('servidor procurado'); await page.getByRole('button', { name: 'Buscar', exact: true }).click()
   await page.goto(`${base}/agents`); await page.goto(`${base}/hosts`); await tag().waitFor()
   assert.match(await tag().getAttribute('class'), /active/); assert.equal(await search().inputValue(), 'servidor procurado')
   await page.goto(`${base}/hosts?view=all&search=outro`); await search().waitFor(); assert.equal(await search().inputValue(), 'outro')
   assert.ok(!(await tag().getAttribute('class')).includes('active'))
  })
  await check('removed filter, corrupt storage and another user recover safely', async () => {
   await page.evaluate(() => sessionStorage.setItem('na:hosts-navigation:7:41', JSON.stringify({ view: 'tag-999', search: '' })))
   await page.goto(`${base}/hosts`); await search().waitFor(); assert.equal(await search().inputValue(), ''); assert.match(await page.locator('[data-hosts-sidebar-key="all"]').getAttribute('class'), /active/)
   await page.evaluate(() => sessionStorage.setItem('na:hosts-navigation:7:41', '{invalid'))
   await page.reload(); await search().waitFor()
   await search().fill('privado do usuário 41'); await page.getByRole('button', { name: 'Buscar', exact: true }).click()
   await page.evaluate(auth => localStorage.setItem('na_access_token', auth), token(42)); await page.reload(); await search().waitFor()
   assert.equal(await search().inputValue(), '')
  })
  await check('recovery notice expires and SFTP failure keeps document alive', async () => {
   await page.evaluate(() => sessionStorage.setItem('na:backend-recovery', '1')); await page.reload()
   const notice = page.getByText('A interface foi recarregada após a recuperação do backend.', { exact: true })
   await notice.waitFor(); await notice.waitFor({ state: 'hidden', timeout: 9000 })
   await page.evaluate(() => sessionStorage.setItem('na:backend-recovery', '1')); await page.reload(); await notice.waitFor()
   await page.evaluate(async () => { window.__navigationDocument = true; await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/session-supervision') })
   await notice.waitFor({ state: 'hidden', timeout: 2000 }); assert.equal(await page.evaluate(() => window.__navigationDocument), true)

   for (const failure of [403, 502, 503, 504, 'network']) {
    sftpFailure = failure
    await page.evaluate(async () => { window.__sameDocument = true; const { sftpService } = await import('/src/services/sftp.service.ts'); try { await sftpService.list(10, '/tmp') } catch {} })
    await page.waitForTimeout(1000); assert.equal(await page.evaluate(() => window.__sameDocument), true, `SFTP ${failure} reloaded document`)
   }
  })
  await check('failed initial Hosts load is not an empty inventory; retry recovers', async () => {
   hostsFail = true
   await page.goto(`${base}/hosts?view=all&search=first-failure`)
   const failure = page.locator('[data-hosts-load-error]'); await failure.waitFor()
   assert.equal(await page.getByText('Nenhum host cadastrado ainda.', { exact: true }).count(), 0)
   assert.equal(await page.getByRole('button', { name: '+ Criar primeiro host', exact: true }).count(), 0)
   await page.evaluate(() => { window.__hostRecoveryDocument = true })
   hostsFail = false; includeHost = true
   await failure.getByRole('button', { name: 'Tentar novamente' }).click()
   await page.getByText('Proxy de laboratório', { exact: true }).first().waitFor()
   assert.equal(await page.evaluate(() => window.__hostRecoveryDocument), true)
  })
  await check('failed refresh preserves last hosts and recovers locally', async () => {
   hostsFail = true
   await search().fill('refresh-failure'); await page.getByRole('button', { name: 'Buscar', exact: true }).click()
   await page.locator('[data-hosts-load-error]').waitFor()
   await page.getByText('Não foi possível atualizar a lista. Exibindo os últimos dados carregados, que podem estar desatualizados.', { exact: true }).waitFor()
   await page.getByText('Proxy de laboratório', { exact: true }).first().waitFor()
   hostsFail = false
   await page.locator('[data-hosts-load-error]').waitFor({ state: 'hidden', timeout: 12000 })
   assert.equal(await page.evaluate(() => window.__hostRecoveryDocument), true)
  })
  await check('SPA navigation, lazy TACACS integration, legacy link and mobile retry', async () => {
   const navigate = path => page.evaluate(path => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path), path)
   await navigate('/admin/integrations')
   const integration = page.getByTestId('network-access-integration')
   await integration.waitFor()
   assert.equal(networkLoads, 0, 'TACACS should not load while collapsed')
   assert.equal(await page.getByText('As regras de login, MFA, JIT e conta de emergência pertencem às configurações do tenant.', {exact:false}).count(), 0)
   const sections = integration.locator('details')
   assert.equal(await sections.count(), 2)
   await sections.filter({has: page.locator('summary', {hasText:'Casos práticos que resolve'})}).locator('summary').click()
   await integration.getByText('Acesso individual a roteadores e switches',{exact:true}).waitFor()
   assert.equal(networkLoads, 0, 'Use cases must not load AAA settings')
   await integration.screenshot({path:'/tmp/nodeaccess-tacacs-card-desktop.png'})
   const configSummary = sections.filter({has: page.locator('summary', {hasText:'Configuração'})}).locator('summary')
   await configSummary.focus(); await page.keyboard.press('Enter')
   await page.getByTestId('network-access-settings').waitFor()
   assert.equal(networkLoads, 1)
   for (let i = 0; i < 3; i++) {
    await navigate('/hosts'); await search().waitFor(); assert.equal(await search().isVisible(), true)
    await navigate('/admin/integrations?section=network-access'); await page.getByTestId('network-access-settings').waitFor()
   }
   await navigate('/hosts'); await search().waitFor()
   networkFailure = true
   await page.setViewportSize({width:390,height:844})
   await navigate('/admin/settings?section=network-access')
   await page.waitForURL('**/admin/integrations?section=network-access')
   await page.getByText('Não foi possível carregar a configuração de rede.', {exact:true}).waitFor()
   networkFailure = false
   await page.getByRole('button',{name:'Tentar novamente',exact:true}).click()
   await page.getByTestId('network-access-settings').waitFor()
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
   await page.screenshot({path:'/tmp/nodeaccess-tacacs-integrations-mobile.png',fullPage:true})
  })
  await check('equipment fields stay in organization and summary follows profile and OS', async () => {
   await page.goto(`${base}/hosts?cdp_perf=equipment-layout`)
   await page.waitForFunction(() => typeof window.__nodeAccessHostsPerf?.openCreateHostForm === 'function')
   await page.evaluate(() => window.__nodeAccessHostsPerf.openCreateHostForm())
   const modal = page.locator('.n-modal')
   const section = modal.getByRole('tab', {name:'Organização', exact:true})
   const connection = modal.getByRole('tab', {name:'Conexão', exact:true})
   const equipment = modal.getByTestId('host-equipment-fields')
   await connection.click()
   await equipment.waitFor({state:'hidden'})
   await section.click(); await equipment.waitFor()
   await equipment.getByLabel('Sistema operacional',{exact:true}).click()
   await page.getByText('Ubuntu',{exact:true}).click()
   await equipment.getByLabel('Perfil do equipamento',{exact:true}).click()
   await page.getByText('Equipamento de rede (genérico)',{exact:true}).click()
   assert.equal(await page.evaluate(() => window.__nodeAccessHostsPerf.startupSnippetFormState().startupSnippetAvailable), false)
   await connection.click(); await equipment.waitFor({state:'hidden'})
   await section.click(); await equipment.waitFor()
   await equipment.getByLabel('Perfil do equipamento',{exact:true}).click()
   await page.getByText('Servidor SSH',{exact:true}).click()
   assert.equal(await page.evaluate(() => window.__nodeAccessHostsPerf.startupSnippetFormState().startupSnippetAvailable), true)
   await modal.screenshot({path:'/tmp/nodeaccess-host-equipment-mobile.png'})
  })
  assert.deepEqual(errors, [])
  await fs.writeFile('/tmp/nodeaccess-hosts-feedback-ux.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify({ passed: results.length, scenarios: results }))
 } catch (error) { console.error({ browserErrors: errors, text: (await page.locator('body').innerText()).slice(0,4500) }); throw error } finally { await browser.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
