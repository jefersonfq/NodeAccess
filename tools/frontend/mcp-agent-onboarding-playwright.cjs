#!/usr/bin/env node
// Isolated browser fixtures: no real credentials, host access or SSH.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const SECRET = 'na_mcp_disposable_browser_fixture'
function authToken() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '1', tenantId: 1, name: 'Admin', role: 'admin', email: 'admin@example.test', isPlatformAdmin: false, stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}
async function createContext(browser, viewport, enabled = true) {
  const context = await browser.newContext({ viewport })
  const state = { mode: 'success', calls: [], created: null, delayCreation: false, releaseCreation: null, tokenLoads: 0, tokens: [], definitions: null, updated: null }
  await context.addInitScript(token => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'harness')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('clipboard denied fixture') } } })
  }, authToken())
  await context.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = [], status = 200
    if (path === '/api/v1/features') body = { mcpLicensed: true, mcpEnvironmentEnabled: enabled, mcpOperational: enabled }
    else if (path === '/api/v1/mcp/capabilities') {
      state.calls.push('capabilities')
      assert.equal(request.headers().authorization, `Bearer ${SECRET}`)
      if (state.mode === 'unauthorized') { status = 401; body = { message: 'Unauthorized' } }
      else body = { capabilities: ['search_hosts'] }
    } else if (path === '/api/v1/mcp/jsonrpc') {
      const rpc = request.postDataJSON()
      const runtime = rpc.id === 'nodeaccess-ui-runtime-status'
      if (!runtime) {
        state.calls.push(rpc.method)
        assert.equal(request.headers().authorization, `Bearer ${SECRET}`)
        assert.match(request.headers().accept, /application\/json/)
        assert.match(request.headers().accept, /text\/event-stream/)
        if (rpc.method !== 'initialize') assert.equal(request.headers()['mcp-protocol-version'], '2025-06-18')
      }
      if (rpc.method === 'notifications/initialized') return route.fulfill({ status: 202, body: '' })
      let result = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'nodeaccess-mcp', version: '0.1.0' } }
      if (rpc.method === 'tools/list') result = { tools: state.mode === 'skipped' ? [] : [{ name: 'search_hosts', inputSchema: { type: 'object' } }] }
      if (rpc.method === 'resources/list') result = { resources: [] }
      if (rpc.method === 'prompts/list') result = { prompts: [] }
      if (rpc.method === 'tools/call') {
        assert.equal(rpc.params.name, 'search_hosts')
        result = { content: [{ type: 'text', text: '[]' }], ...(state.mode === 'tool-error' ? { isError: true } : {}) }
      }
      body = { jsonrpc: '2.0', id: rpc.id, result }
      if (!runtime && state.mode === 'rpc-error' && rpc.method === 'tools/list') body = { jsonrpc: '2.0', id: rpc.id, error: { code: -32603, message: 'fixture failure' } }
    } else if (path === '/api/v1/mcp/admin/tokens' && request.method() === 'POST') {
      state.created = request.postDataJSON()
      if (state.delayCreation) await new Promise(resolve => { state.releaseCreation = resolve })
      body = { token: SECRET, record: { id: 1, active: true, createdByName: 'Fixture admin', lastUsage: null, ...state.created, allowedActionModes: [], allowedHostIds: [], createdAt: new Date().toISOString(), revokedAt: null } }
    } else if (/\/mcp\/admin\/tokens\/\d+$/.test(path) && request.method() === 'PATCH') {
      state.updated = request.postDataJSON()
      const id = Number(path.split('/').at(-1))
      body = { ...state.tokens.find(token => token.id === id), ...state.updated }
    } else if (path === '/api/v1/mcp/admin/tokens') { state.tokenLoads++; body = state.tokens }
    else if (path === '/api/v1/mcp/admin/capabilities') body = state.definitions || [
      { key: 'search_hosts', kind: 'tool', title: 'Buscar hosts', description: 'Busca hosts.', module: 'hosts', scope: 'tenant', risk: 'low', accessMode: 'read_only' },
      { key: 'search_snippets', kind: 'tool', title: 'Buscar snippets', description: 'Busca snippets.', module: 'snippets', scope: 'snippet', risk: 'low', accessMode: 'read_only' },
    ]
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return { context, state }
}
async function select(page, id, label) {
  await page.getByTestId(id).click()
  await page.locator('.n-base-select-option').filter({ hasText: label }).click()
}
async function validateGuide(page, state, mobile) {
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${FRONTEND}/admin/mcp-tokens`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Servidor MCP disponível', exact: true }).waitFor()
  assert.equal(await page.locator('.availability-details').getAttribute('open'), null)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page horizontal overflow')
  assert(await page.getByRole('checkbox', { name: 'Somente ativos' }).isChecked())
  const connect = page.getByRole('button', { name: 'Conectar agente', exact: true })
  assert.equal(await page.locator('.n-empty').count(), 1)
  assert.equal(await page.locator('.n-data-table').count(), 0)
  await page.getByText('Nenhum token criado neste tenant.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Conectar primeiro agente', exact: true }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByTestId('mcp-agent-setup')
  await dialog.waitFor()
  await page.keyboard.press('Tab')
  assert(await page.evaluate(() => !!document.activeElement.closest('.n-modal')), 'Focus must remain inside modal')
  const localTest = page.getByTestId('mcp-server-test')
  assert.equal(await localTest.getAttribute('open'), null)
  const alternative = page.getByTestId('mcp-config-alternative')
  assert.equal(await alternative.getAttribute('open'), null)
  await page.getByTestId('mcp-register').waitFor()
  await alternative.locator('summary').focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('mcp-config').waitFor()
  for (const [agent, label, destination] of [['codex', 'Codex CLI', 'config.toml'], ['claude', 'Claude Code', '.mcp.json'], ['gemini', 'Gemini CLI', 'settings.json']]) {
    await select(page, 'mcp-agent-select', label)
    assert((await page.getByTestId('mcp-config-destination').innerText()).includes(destination))
    const config = await page.getByTestId('mcp-config').innerText()
    assert(!config.includes(SECRET))
    if (agent === 'codex') assert.match(config, /bearer_token_env_var = "NODEACCESS_MCP_TOKEN"/)
    else {
      const server = JSON.parse(config).mcpServers.nodeaccess
      assert.equal(server.headers.Authorization, 'Bearer ${NODEACCESS_MCP_TOKEN}')
      if (agent === 'claude') assert.equal(server.type, 'http')
      else { assert(server.httpUrl); assert.equal(server.url, undefined) }
    }
    for (const [shell, shellLabel] of [['bash', 'Bash (Linux, macOS, WSL)'], ['powershell', 'PowerShell 5.1+']]) {
      await select(page, 'mcp-shell-select', shellLabel)
      const start = await page.getByTestId('mcp-start').innerText()
      assert(start.includes(`  ${agent}\n`))
      assert(start.includes(shell === 'bash' ? 'read -rsp' : '-AsSecureString'))
    }
  }
  const endpoint = dialog.getByRole('textbox', { name: 'Endereço acessível pelo agente' })
  await endpoint.fill('https://example.test/mcp?secret=unsafe')
  await dialog.getByText('Informe uma URL HTTP(S) válida, sem credenciais, parâmetros ou fragmentos.').waitFor()
  assert.equal(await page.getByTestId('mcp-config').count(), 0)
  await endpoint.fill('https://agent.example.test/api/v1/mcp/jsonrpc')
  await dialog.getByRole('button', { name: 'Copiar configuração', exact: true }).click()
  await page.getByText('Clipboard indisponível. Selecione o texto do bloco e copie manualmente.').waitFor()
  await localTest.locator('summary').focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('mcp-test-different-endpoint').waitFor()
  assert((await page.getByTestId('mcp-tested-endpoint').innerText()).endsWith('/api/v1/mcp/jsonrpc'))
  assert(!(await page.getByTestId('mcp-tested-endpoint').innerText()).includes('agent.example.test'))
  const externalRequests = []
  page.on('request', request => { if (request.url().includes('agent.example.test')) externalRequests.push(request.url()) })
  const secret = dialog.getByLabel('Token para teste (temporário)', { exact: true })
  assert.equal(await secret.getAttribute('type'), 'password')
  for (const mode of ['success', 'skipped', 'tool-error', 'rpc-error', 'unauthorized']) {
    state.mode = mode; state.calls = []
    await secret.fill(SECRET)
    assert.equal(await page.getByTestId('mcp-probe-summary').count(), 0)
    await dialog.getByRole('button', { name: 'Executar teste somente leitura' }).click()
    await page.getByTestId('mcp-probe-summary').waitFor()
    const details = page.getByTestId('mcp-probe-details')
    const failed = !['success', 'skipped'].includes(mode)
    assert.equal(await details.getAttribute('open') !== null, failed)
    if (!failed) {
      const summary = await page.getByTestId('mcp-probe-summary').innerText()
      assert(summary.includes(mode === 'success' ? 'Consulta de hosts concluída.' : 'Consulta de hosts não executada:'))
      await details.locator('summary').focus()
      await page.keyboard.press('Enter')
    }
    await dialog.locator('.probe-step').first().waitFor()
    await page.waitForFunction(() => document.querySelector('input[aria-label="Token para teste (temporário)"]').value === '')
    assert.equal(await dialog.getByText('Aprovado', { exact: true }).count(), { success: 6, skipped: 5, 'tool-error': 5, 'rpc-error': 2, unauthorized: 0 }[mode])
    assert.equal(await dialog.getByText('Falhou', { exact: true }).count(), ['success', 'skipped'].includes(mode) ? 0 : 1)
    if (mode === 'success') assert.deepEqual(state.calls, ['capabilities', 'initialize', 'notifications/initialized', 'tools/list', 'resources/list', 'prompts/list', 'tools/call'])
    if (mode === 'rpc-error') assert.equal(state.calls.at(-1), 'tools/list')
    if (mode === 'unauthorized') assert.deepEqual(state.calls, ['capabilities'])
  }
  assert.deepEqual(externalRequests, [])
  await secret.fill(SECRET)
  await dialog.getByRole('button', { name: 'Fechar guia' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await connect.click()
  await dialog.waitFor()
  assert.equal(await secret.inputValue(), '')
  assert.equal(await endpoint.inputValue(), 'https://agent.example.test/api/v1/mcp/jsonrpc')
  await dialog.getByRole('button', { name: 'Criar token de consulta' }).click()
  const creation = page.locator('.n-modal').filter({ hasText: 'Novo token MCP' })
  await creation.waitFor()
  await creation.getByPlaceholder('Ex.: Claude - Operação').fill('Browser fixture')
  await creation.getByRole('button', { name: 'Criar token', exact: true }).click()
  await page.getByTestId('created-token-result').waitFor()
  assert(state.created.allowedCapabilities.includes('search_hosts'))
  assert.deepEqual(state.created.allowedActionModes, ['read_only'])
  await creation.getByRole('button', { name: 'Concluir', exact: true }).click()
  await dialog.waitFor()
  assert.equal(await secret.inputValue(), SECRET)
  assert.notEqual(await localTest.getAttribute('open'), null)
  assert.equal(await endpoint.inputValue(), 'https://agent.example.test/api/v1/mcp/jsonrpc')
  assert(!(await page.getByTestId('mcp-config').innerText()).includes(SECRET))
  assert(await page.evaluate(token => !JSON.stringify({ ...localStorage, ...sessionStorage }).includes(token), SECRET))
  if (mobile) {
    const box = await dialog.boundingBox()
    assert(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile horizontal overflow')
  }
  await dialog.getByRole('button', { name: 'Fechar guia' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await connect.click()
  assert.equal(await secret.inputValue(), '')
  await dialog.getByRole('button', { name: 'Fechar guia' }).click()
  await dialog.waitFor({ state: 'hidden' })
  const search = page.getByPlaceholder('Buscar por nome, criador, capability ou host')
  await search.fill('missing-fixture-token')
  await page.getByText('Nenhum token corresponde aos filtros.', { exact: true }).waitFor()
  assert.equal(await page.locator('.n-empty').count(), 1)
  assert.equal(await page.locator('.n-data-table').count(), 0)
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click()
  assert.equal(await search.inputValue(), '')
  await page.locator('.n-data-table').waitFor()
  assert.equal(await page.locator('.n-empty').count(), 0)
  await connect.click()
  await dialog.waitFor()
  // A response from a closed form must never populate a newly opened form.
  state.delayCreation = true
  await dialog.getByRole('button', { name: 'Criar token de consulta' }).click()
  await creation.waitFor()
  await creation.getByPlaceholder('Ex.: Claude - Operação').fill('Discarded creation')
  const pendingRequest = page.waitForRequest(request => request.url().endsWith('/mcp/admin/tokens') && request.method() === 'POST')
  await creation.getByRole('button', { name: 'Criar token', exact: true }).click()
  await pendingRequest
  await creation.locator('.n-base-close').click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Criar token de consulta' }).click()
  await creation.waitFor()
  await creation.getByPlaceholder('Ex.: Claude - Operação').fill('Current creation')
  const discardedResponse = page.waitForResponse(response => response.url().endsWith('/mcp/admin/tokens') && response.request().method() === 'POST')
  assert(state.releaseCreation, 'Delayed creation must be pending')
  state.releaseCreation()
  await (await discardedResponse).finished()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByTestId('created-token-result').count(), 0)
  assert.equal(await creation.getByPlaceholder('Ex.: Claude - Operação').inputValue(), 'Current creation')
  assert(await creation.getByRole('button', { name: 'Criar token', exact: true }).isEnabled())
  assert(!(await creation.innerText()).includes(SECRET))
  await creation.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await dialog.waitFor()
  assert.equal(await secret.inputValue(), '')

  assert.equal(await endpoint.inputValue(), 'https://agent.example.test/api/v1/mcp/jsonrpc')
  await localTest.locator('summary').click()

  // Dev-only Pinia access simulates the existing tenant signal without a real account.
  await secret.fill(SECRET)
  const oldLoads = state.tokenLoads
  const reload = page.waitForResponse(response => response.url().includes('/mcp/admin/tokens') && response.request().method() === 'GET')
  await page.evaluate(() => {
    const auth = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('auth')
    auth.user = { ...auth.user, tenantId: 2 }
  })
  await reload
  await dialog.waitFor({ state: 'hidden' })
  assert(state.tokenLoads > oldLoads, 'Tenant switch must reload tokens')
  await connect.click()
  await dialog.waitFor()
  assert.equal(await secret.inputValue(), '')
  assert.equal(await page.getByTestId('created-token-result').count(), 0)
  assert(!(await endpoint.inputValue()).includes('agent.example.test'))
  // Let the modal entrance transition finish before measuring/capturing geometry.
  await page.waitForTimeout(400)
  await page.screenshot({ animations: 'disabled', path: `/tmp/na0057-ux-${page.viewportSize().width}.png`, fullPage: true })
  const dimensions = await dialog.boundingBox()
  await dialog.getByRole('button', { name: 'Fechar guia' }).click()
  await dialog.waitFor({ state: 'hidden' })
  const audit = page.getByRole('button', { name: 'Abrir opções de auditoria' })
  await audit.focus()
  await page.keyboard.press('Enter')
  await page.getByText('Todos os registros MCP', { exact: true }).waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/admin/logs?**')
  const query = new URL(page.url()).searchParams
  assert.equal(query.get('tab'), 'admin')
  assert.equal(query.get('targetType'), 'MCP')
  assert.equal(query.get('action'), 'MCP_TOOL_CALLED')
  assert.equal(query.get('search'), 'approve_action_run')
  assert.deepEqual(errors, [])
  return { mobile, configurations: 3, agentShellCombinations: 6, probeModes: 5, dimensions, disclosureKeyboard: true, auditKeyboard: true, endpointRetention: true, singleEmptyState: true, firstAgentCta: true, clearEmptyFilter: true, externalEndpointNotProbed: true, clipboardFailure: true, secretCleared: true, createTokenReturn: true, keyboardFocus: true, staleCreationDiscarded: true, tenantSwitchClearsSecretAndReloads: true }
}
async function validatePermissions(page, state) {
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  state.definitions = Array.from({length:20}, (_, i) => ({key: 'fixture_'+i, title: 'Permissão '+i, description:'Descrição '+i, kind:'tool', module:'hosts', risk:i===0?'high':'low', scope:'tenant', accessMode:'read_only'}))
  state.definitions.push({key:'open_interactive_ssh_session', title:'Shell interativo', description:'Shell', kind:'tool', module:'sessions', risk:'high', scope:'tenant', accessMode:'read_only'})
  const permissions = [...state.definitions.map(item => item.key), 'unknown_fixture']
  const record = {active:true, createdByName:'Fixture admin', lastUsage:null, allowedActionModes:[], allowedHostIds:[], createdAt:new Date().toISOString(), revokedAt:null, expiresAt:null}
  state.tokens = [{...record,id:21,name:'Many',allowedCapabilities:permissions},{...record,id:22,name:'Inherited',allowedCapabilities:[]}]
  await page.goto(FRONTEND+'/admin/mcp-tokens')
  const summary = page.getByTestId('mcp-permission-summary').first()
  await summary.waitFor()
  assert((await summary.innerText()).includes('22 permissões'))
  for(const text of ['Shell interativo','1 de alto risco','1 com risco não informado']) await summary.getByText(text,{exact:true}).waitFor()
  await page.getByText('Herdadas do ambiente',{exact:true}).waitFor()
  const summaryHeight = (await summary.boundingBox()).height
  assert(summaryHeight<160)
  const trigger = page.getByRole('button',{name:'Ver permissões de Many',exact:true})
  await trigger.focus()
  await page.keyboard.press('Enter')
  const modal = page.getByTestId('mcp-permission-details')
  await modal.waitFor()
  assert.equal(await modal.locator('li').count(),22)
  await modal.getByText('Risco: Não informado',{exact:true}).waitFor()
  assert(await modal.locator('.permission-list').evaluate(el=>el.scrollHeight>el.clientHeight))
  await page.waitForTimeout(350)
  const box = await modal.boundingBox()
  assert(box.x>=0 && box.x+box.width<=page.viewportSize().width)
  await page.screenshot({path:'/tmp/na0057-permissions-details-'+page.viewportSize().width+'.png',fullPage:true})
  await page.keyboard.press('Escape')
  await modal.waitFor({state:'hidden'})
  assert(await trigger.evaluate(el=>document.activeElement===el),'Focus must return')
  await page.getByRole('button',{name:'Ver permissões de Inherited',exact:true}).click()
  await modal.getByText(/Isso não significa/).waitFor()
  await page.keyboard.press('Escape')
  await modal.waitFor({state:'hidden'})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:'/tmp/na0057-permissions-table-'+page.viewportSize().width+'.png',fullPage:true})
  await page.getByRole('button',{name:'Editar',exact:true}).first().click()
  const edit = page.locator('.n-modal').filter({hasText:'Editar token MCP'})
  await edit.waitFor()
  const selector = edit.getByTestId('mcp-capability-selector')
  const group = selector.getByTestId('mcp-capability-module-hosts')
  assert.equal(await group.getAttribute('open'),null)
  await group.locator('summary').first().focus()
  await page.keyboard.press('Enter')
  assert.notEqual(await group.getAttribute('open'),null)
  const search = selector.getByRole('textbox',{name:'Buscar permissão ou módulo'})
  await search.fill('unknown_fixture')
  assert(await selector.getByTestId('mcp-capability-option-unknown_fixture').getByRole('checkbox').isChecked())
  await search.fill('absent_query')
  await selector.getByText('Nenhuma permissão encontrada. Altere a busca; sua seleção foi preservada.').waitFor()
  assert((await selector.getByTestId('mcp-capability-selection').innerText()).includes('22 permissões selecionadas'))
  await edit.getByRole('button',{name:'Salvar',exact:true}).click()
  await edit.waitFor({state:'hidden'})
  assert.deepEqual(state.updated.allowedCapabilities,permissions)
  await page.getByRole('button',{name:'Editar',exact:true}).first().click()
  await edit.waitFor()
  await search.fill('unknown_fixture')
  await selector.getByTestId('mcp-capability-option-unknown_fixture').getByRole('checkbox').click()
  await edit.getByRole('button',{name:'Salvar',exact:true}).click()
  await edit.waitFor({state:'hidden'})
  assert.deepEqual(state.updated.allowedCapabilities,permissions.filter(key=>key!=='unknown_fixture'))
  await page.getByRole('button',{name:'Novo token',exact:true}).click()
  const create = page.locator('.n-modal').filter({hasText:'Novo token MCP'})
  await create.waitFor()
  await create.getByPlaceholder('Ex.: Claude - Operação').fill('Selector fixture')
  const createSelector = create.getByTestId('mcp-capability-selector')
  await createSelector.getByText('Herdadas do ambiente',{exact:true}).waitFor()
  const createSearch = createSelector.getByRole('textbox',{name:'Buscar permissão ou módulo'})
  await createSearch.fill('fixture_19')
  await createSelector.getByTestId('mcp-capability-option-fixture_19').getByRole('checkbox').check()
  await createSearch.fill('absent_query')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:'/tmp/na0057-permissions-create-'+page.viewportSize().width+'.png',fullPage:true})
  await create.getByRole('button',{name:'Criar token',exact:true}).click()
  await page.getByTestId('created-token-result').waitFor()
  assert.deepEqual(state.created.allowedCapabilities,['fixture_19'])
  assert.deepEqual(errors,[])
  return {width:page.viewportSize().width,summaryHeight,permissions:22,keyboard:true,focusReturn:true,preservedFilteredSelection:true,unknownPreservedAndRemovable:true,createPayload:true,noPageErrors:true,noOverflow:true}
}
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  try {
    const scenarios = []
    const permissions = []
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      const { context, state } = await createContext(browser, viewport)
      scenarios.push(await validateGuide(await context.newPage(), state, viewport.width < 600))
      await context.close()
      const populated = await createContext(browser, viewport)
      permissions.push(await validatePermissions(await populated.context.newPage(), populated.state))
      await populated.context.close()
    }
    const { context } = await createContext(browser, { width: 1440, height: 1000 }, false)
    const page = await context.newPage()
    await page.goto(`${FRONTEND}/admin/mcp-tokens`)
    await page.getByRole('heading', { name: 'Servidor MCP indisponível', exact: true }).waitFor()
    assert(await page.getByRole('button', { name: 'Conectar agente', exact: true }).isDisabled())
    await context.close()
    console.log(JSON.stringify({ ok: true, scenarios, permissions, unavailable: { connectDisabled: true }, transport: 'mocked browser only' }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
