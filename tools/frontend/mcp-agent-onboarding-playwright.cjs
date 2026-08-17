#!/usr/bin/env node

const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')

function authToken() {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '1', tenantId: 1, name: 'Admin', role: 'admin', email: 'admin@example.test',
    isPlatformAdmin: false, stage: 'authenticated', iat: now, exp: now + 3600,
  }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function createContext(browser, viewport, mcpRuntime = { licensed: true, environmentEnabled: true }) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'harness')
  }, authToken())
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path === '/api/v1/features') body = {
      mcpLicensed: mcpRuntime.licensed,
      mcpEnvironmentEnabled: mcpRuntime.environmentEnabled,
      mcpOperational: mcpRuntime.licensed && mcpRuntime.environmentEnabled,
    }
    else if (path === '/api/v1/mcp/jsonrpc') body = {
      jsonrpc: '2.0',
      id: 'nodeaccess-ui-runtime-status',
      result: { protocolVersion: '2025-06-18', serverInfo: { name: 'nodeaccess-mcp', version: '0.1.0' } },
    }
    else if (path === '/api/v1/mcp/admin/tokens') body = []
    else if (path === '/api/v1/mcp/admin/capabilities') body = [
      { key: 'search_hosts', kind: 'tool', title: 'Buscar hosts', description: 'Busca hosts.', module: 'hosts', scope: 'tenant', risk: 'low', accessMode: 'read_only' },
      { key: 'search_snippets', kind: 'tool', title: 'Buscar snippets', description: 'Busca snippets.', module: 'snippets', scope: 'snippet', risk: 'low', accessMode: 'read_only' },
      { key: 'run_host_operation', kind: 'tool', title: 'Executar objetivo operacional no host', description: 'Executa objetivo governado.', module: 'ai_ssh_actions', scope: 'action', risk: 'high', accessMode: 'approval_required' },
    ]
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return context
}

async function validateUnavailable(page) {
  page.setDefaultTimeout(10_000)
  await page.goto(`${FRONTEND}/admin/mcp-tokens`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  const runtime = page.getByTestId('mcp-runtime-status')
  await runtime.getByText('Licenciado', { exact: true }).waitFor()
  await runtime.getByText('FEATURE_MCP inativo', { exact: true }).waitFor()
  await runtime.getByText('Indisponível', { exact: true }).waitFor()
  if (!await page.getByRole('button', { name: 'Conectar agente' }).isDisabled()) {
    throw new Error('Conexão de agente ficou disponível com FEATURE_MCP inativo')
  }
  return { environmentDisabled: true, connectDisabled: true }
}

async function validateGuide(page, mobile) {
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${FRONTEND}/admin/mcp-tokens`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
  await page.getByRole('heading', { name: 'Tokens MCP' }).waitFor()
  const activeFilter = page.getByRole('checkbox', { name: 'Somente ativos' })
  if (!await activeFilter.isChecked()) throw new Error('Filtro padrão não ocultou tokens revogados')
  const runtime = page.getByTestId('mcp-runtime-status')
  await runtime.getByText('Licenciado', { exact: true }).waitFor()
  await runtime.getByText('FEATURE_MCP ativo', { exact: true }).waitFor()
  await runtime.getByText('Operacional', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Conectar agente' }).click()
  const dialog = page.locator('.n-modal').filter({ hasText: 'Conectar seu agente ao NodeAccess' })
  await dialog.waitFor()
  for (const title of ['Crie uma credencial mínima', 'Escolha o agente e cadastre o endpoint', 'Inicie o agente com o segredo', 'Valide e peça pelo objetivo']) {
    await dialog.getByRole('heading', { name: title }).waitFor()
  }
  const text = await dialog.textContent()
  if (!text.includes('--bearer-token-env-var NODEACCESS_MCP_TOKEN')) throw new Error('Configuração Codex ausente')
  if (text.includes('na_mcp_')) throw new Error('Guia expôs valor com formato de token')
  if (!text.includes('Token MCP:')) throw new Error('Prompt Bash visível ausente')
  if (!text.includes('Read-Host -MaskInput')) throw new Error('Fluxo PowerShell ausente')
  for (const client of ['Codex', 'Claude', 'Gemini']) {
    if (!text.includes(client)) throw new Error(`Cliente ${client} ausente na trilha guiada`)
  }
  if (!text.includes('load alto sem processos com CPU alta')) throw new Error('Exemplo de diagnóstico orientado a objetivo ausente')
  if (!text.includes('Comandos bloqueados pela policy não são executados')) throw new Error('Governança não está explícita no guia')
  if (mobile) {
    const box = await dialog.boundingBox()
    if (!box || box.x < 0 || box.x + box.width > page.viewportSize().width) throw new Error('Modal fora da viewport mobile')
  }
  if (errors.length) throw new Error(`Erros de UI: ${errors.join(' | ')}`)
  return { steps: 4, clients: 3, governedExamples: 3, mobile }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
  })
  const results = []
  for (const scenario of [
    { viewport: { width: 1440, height: 1000 }, mobile: false },
    { viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const context = await createContext(browser, scenario.viewport)
    const page = await context.newPage()
    results.push(await validateGuide(page, scenario.mobile))
    await context.close()
  }
  const unavailableContext = await createContext(browser, { width: 1440, height: 1000 }, { licensed: true, environmentEnabled: false })
  const unavailablePage = await unavailableContext.newPage()
  const unavailable = await validateUnavailable(unavailablePage)
  await unavailableContext.close()
  await browser.close()
  console.log(JSON.stringify({ ok: true, scenarios: results, unavailable }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
