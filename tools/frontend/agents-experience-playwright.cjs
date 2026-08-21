#!/usr/bin/env node
'use strict'

const { chromium } = require('playwright')
const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const UI_THEME = process.env.UI_THEME === 'light' ? 'light' : 'dark'
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '9', tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', stage: 'authenticated', canManageHosts: true, iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const base = { active: true, isDefault: false, siteName: null, environment: null, privateAccess: null, revokedAt: null, lastSeenAt: new Date().toISOString(), createdAt: new Date().toISOString(), hostname: 'edge-01', platform: 'linux', arch: 'x64', remoteIp: '10.0.0.20', connectedAt: new Date().toISOString(), lastVersion: '1.0.0', lastHostname: 'edge-01', lastPlatform: 'linux', lastArch: 'x64', lastRemoteIp: '10.0.0.20', lastConnectedAt: new Date().toISOString(), lastDisconnectedAt: null, lastDisconnectReason: null, lastOfflineReason: null, lastOfflineAt: null, heartbeatAgeMs: 500, versionStatus: 'current', minimumSupportedVersion: '1.0.0' }
const initialAgents = [
  { ...base, id: 1, name: 'Notebook VPN Ana', online: true, agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND', version: '1.0.0', tlsMode: 'verified', owner: { id: 9, name: 'Ana', email: 'ana@example.test' } },
  { ...base, id: 2, name: 'Gateway Filial SP', online: true, agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', version: '0.9.0', versionStatus: 'outdated', tlsMode: 'insecure', heartbeatAgeMs: 70_000, isDefault: true, owner: { id: 9, name: 'Infra', email: 'infra@example.test' } },
  { ...base, id: 3, name: 'Conector Datacenter', online: false, agentType: 'PRIVATE_ACCESS_CONNECTOR', agentMode: 'SERVICE_BOUND', version: null, tlsMode: null, heartbeatAgeMs: null, siteName: 'DC-01', environment: 'Produção', privateAccess: { allowedCidrs: ['10.20.0.0/16'], allowedPorts: [22] }, lastDisconnectReason: 'ws closed (1006)', owner: { id: 9, name: 'Infra', email: 'infra@example.test' } },
  { ...base, id: 4, name: 'Agente antigo', online: false, active: false, revokedAt: new Date().toISOString(), agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND', version: '0.8.0', tlsMode: null, heartbeatAgeMs: null, owner: { id: 9, name: 'Ana', email: 'ana@example.test' } },
]

async function main() {
  const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL) : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const state = { agents: structuredClone(initialAgents), created: null, freshCalls: 0, testCalls: 0, createPayload: null, impactCalls: 0, maintenanceCalls: 0, historyCalls: 0 }
  await context.addInitScript(({ auth, theme }) => {
    localStorage.setItem('na_access_token', auth)
    localStorage.setItem('na_refresh_token', 'agents-harness')
    localStorage.setItem('na_ui_theme_mode', theme)
  }, { auth: token(), theme: UI_THEME })

  await context.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let status = 200
    let body = []
    if (path === '/api/v1/features') body = { agentsLicensed: true }
    else if (/\/api\/v1\/agents\/\d+\/impact$/.test(path)) { state.impactCalls++; body = { hostCount: 3, activeSessionCount: 1, online: true, safeToRevoke: false } }
    else if (/\/api\/v1\/agents\/\d+\/history$/.test(path)) { state.historyCalls++; body = { reconnects: 2, disconnects: 1, events: [{ action: 'agent_connected', createdAt: new Date().toISOString() }] } }
    else if (/\/api\/v1\/agents\/\d+\/maintenance$/.test(path)) { state.maintenanceCalls++; body = { maintenanceMode: true, activeConnections: 1 } }
    else if (/\/api\/v1\/agents\/\d+\/rotate-token$/.test(path)) body = { token: 'na_agent_rotated_once' }
    else if (/\/api\/v1\/agents\/\d+\/pool$/.test(path)) body = { poolName: 'filial-sp', priority: 10 }
    else if (path === '/api/v1/agents/downloads') body = [
      { platform: 'windows', fileName: 'nodeaccess-agent.exe', available: true, downloadUrl: '/api/v1/agents/download/windows' },
      { platform: 'linux', fileName: 'nodeaccess-agent-linux', available: true, downloadUrl: '/api/v1/agents/download/linux' },
      { platform: 'macos', fileName: 'nodeaccess-agent-macos', available: false, downloadUrl: '/api/v1/agents/download/macos' },
    ]
    else if (path === '/api/v1/agents' && request.method() === 'POST') {
      state.createPayload = request.postDataJSON()
      state.created = { ...base, id: 5, name: state.createPayload.name, online: false, agentType: state.createPayload.agentType, agentMode: state.createPayload.agentMode, version: null, tlsMode: null, heartbeatAgeMs: null, owner: { id: 9, name: 'Admin', email: 'admin@example.test' } }
      state.agents.unshift(state.created)
      body = { agent: { id: 5, name: state.created.name, agentType: state.created.agentType, agentMode: state.created.agentMode, createdAt: state.created.createdAt }, token: 'na_agent_once_secret' }
    } else if (path === '/api/v1/agents') {
      if (request.url().includes('fresh') || state.created) state.freshCalls++
      if (state.created && state.freshCalls >= 2) { state.created.online = true; state.created.version = '1.0.0'; state.created.versionStatus = 'current'; state.created.tlsMode = 'verified'; state.created.heartbeatAgeMs = 100 }
      body = state.agents
    } else if (path === '/api/v1/hosts') body = { data: [{ id: 21, name: 'DB privado', ip: '10.20.1.10', port: 22, accessProtocol: 'ssh', sshUser: 'admin', authType: 'password', connectionMode: 'agent_tenant_fallback', groupId: null, pemKeyId: null, bastionId: null, tags: [] }], total: 1, page: 1, limit: 200, totalPages: 1 }
    else if (path === '/api/v1/hosts/test-connection') {
      state.testCalls++
      if (state.testCalls === 1) body = { success: false, latencyMs: null, message: 'Agent timeout conectando 10.20.1.10:22', route: 'agent', failureStep: 'agent' }
      else body = { success: true, latencyMs: 87, message: 'Conectividade confirmada via Gateway Filial SP', route: 'agent', failureStep: null }
    } else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { maxUsers: 20, maxHosts: 100, activeUsers: 2, registeredHosts: 1, featureEntitlements: { agents: true }, integrationEntitlements: {} }, sessionLimits: {}, passwordPolicy: {}, tenantSettings: {}, jitAccess: {}, sharedSessions: {} }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(20_000)
  await page.goto(`${FRONTEND}/agents?agentsHarness=${Date.now()}`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('agent-status-summary').waitFor()
  await page.getByText('Agente pessoal', { exact: true }).first().waitFor()
  await page.getByText('Agente compartilhado', { exact: true }).first().waitFor()
  await page.getByText('Conector de rede privada', { exact: true }).first().waitFor()
  await page.getByText(/TLS sem validação/i).waitFor()
  if (await page.getByText(/Download do agente|Install script/i).count()) throw new Error('Documentação avançada continuou poluindo o fluxo principal')

  const agentSearch = page.getByLabel('Buscar agentes').locator('input')
  await agentSearch.fill('Datacenter')
  await page.getByText('Conector Datacenter', { exact: true }).waitFor()
  if (await page.getByText('Notebook VPN Ana', { exact: true }).count()) throw new Error('Busca não filtrou agentes')
  await agentSearch.fill('')
  await page.getByTestId('agent-status-summary').getByText('Precisam de atenção').click()
  await page.getByText('Gateway Filial SP', { exact: true }).waitFor()
  if (await page.getByText('Notebook VPN Ana', { exact: true }).count()) throw new Error('Filtro de saúde não foi aplicado')
  await page.getByTestId('agent-status-summary').getByText('Precisam de atenção').click()

  const gatewayCard = page.locator('.na-panel').filter({ hasText: 'Gateway Filial SP' }).last()
  await gatewayCard.getByRole('button', { name: 'Ver detalhes' }).click()
  await gatewayCard.locator('[data-agent-diagnostics]').waitFor()
  await gatewayCard.getByText('v0.9.0', { exact: true }).last().waitFor()
  await gatewayCard.getByText('Diagnóstico guiado', { exact: true }).waitFor()
  await gatewayCard.getByRole('button', { name: 'Ver impacto' }).click()
  await gatewayCard.getByText(/3 host\(s\).*1 sessão/).waitFor()
  await gatewayCard.getByRole('button', { name: 'Carregar histórico' }).click()
  await gatewayCard.getByText(/2 conexão/).waitFor()
  await gatewayCard.getByRole('button', { name: 'Drenar para manutenção' }).click()

  await page.getByTestId('agent-install-cta').click()
  const createForm = page.locator('[data-agent-create-form]')
  await createForm.waitFor()
  await createForm.locator('input').last().fill('Agente QA')
  await createForm.getByRole('button', { name: /Criar|Create/ }).click()
  const tokenModal = page.locator('.n-modal:visible').filter({ hasText: 'na_agent_once_secret' })
  await tokenModal.waitFor()
  await tokenModal.getByText('Linux', { exact: true }).click()
  await tokenModal.getByText(/Instalar como serviço|Install as service/i).click()
  await tokenModal.getByText(/--service/).waitFor()
  await tokenModal.getByRole('button', { name: /Validar|Validate/ }).click()
  await tokenModal.getByText(/pronto|ready|conectado|connected/i).waitFor()
  if (state.createPayload?.agentType !== 'PROXY_AGENT' || state.createPayload?.agentMode !== 'USER_BOUND') throw new Error(`Finalidade criada incorretamente: ${JSON.stringify(state.createPayload)}`)
  await tokenModal.getByRole('button', { name: /Entendi|Got it/ }).click()

  const onlineCard = page.locator('.na-panel').filter({ hasText: 'Notebook VPN Ana' }).last()
  await onlineCard.getByRole('button', { name: /Testar|Test/ }).click()
  const testModal = page.locator('.n-modal:visible').filter({ hasText: 'Notebook VPN Ana' })
  await testModal.locator('.n-select').click()
  await page.getByText(/DB privado/).last().click()
  await testModal.getByRole('button', { name: /Testar|Test/, exact: true }).click()
  await testModal.getByText(/Falhou|Failed|Erro ao testar|Error testing/i).waitFor()
  await testModal.getByRole('button', { name: /Testar|Test/, exact: true }).click()
  await testModal.getByText(/87ms/).waitFor()

  await page.setViewportSize({ width: 390, height: 844 })
  await testModal.getByRole('button', { name: /Cancelar|Cancel/ }).click()
  const pageGeometry = await page.locator('body').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, background: getComputedStyle(element).backgroundColor }))
  if (pageGeometry.scrollWidth > pageGeometry.clientWidth + 1) throw new Error(`Tela possui overflow horizontal no mobile: ${JSON.stringify(pageGeometry)}`)
  if (/transparent|rgba\([^)]*,\s*0\)/.test(pageGeometry.background)) throw new Error(`Fundo transparente: ${JSON.stringify(pageGeometry)}`)
  if (errors.length) throw new Error(`Erros de browser: ${errors.join(' | ')}`)

  if (state.impactCalls !== 1 || state.historyCalls !== 1 || state.maintenanceCalls !== 1) throw new Error(`Operações não exercitadas: ${JSON.stringify(state)}`)
  console.log(JSON.stringify({ ok: true, theme: UI_THEME, cdp: !!CDP_URL, agents: state.agents.length, freshCalls: state.freshCalls, testCalls: state.testCalls, impactCalls: state.impactCalls, maintenanceCalls: state.maintenanceCalls, historyCalls: state.historyCalls, geometry: pageGeometry }))
  await context.close()
  await browser.close()
}

main().catch(error => { console.error(error); process.exitCode = 1 })
