#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const CDP_URL = process.env.CHROMIUM_CDP_URL || ''

function token() {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: '11', tenantId: 7, name: 'Admin', role: 'admin', email: 'admin@example.test', stage: 'authenticated', iat: now, exp: now + 3600 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

const features = {
  localAiLicensed: true,
  terminalAutocompleteLicensed: true,
  terminalAiLicensed: true,
  aiSshActionsLicensed: true,
  agentsLicensed: true,
  integrationsLicensed: true,
}

const status = {
  available: true,
  enabled: true,
  mode: 'read_only',
  routingPolicy: 'prefer_local',
  localConfigured: true,
  networkConfigured: true,
  effectiveProvider: 'ollama',
  providerStates: [
    { key: 'ollama', locality: 'local', configured: true, selected: true, model: 'qwen2.5-coder', circuitState: 'closed' },
    { key: 'openai_compatible', locality: 'network', configured: true, selected: false, model: 'gpt-5-mini', circuitState: 'closed' },
  ],
  routingExplanation: 'Ollama local tem prioridade. Se falhar antes de produzir resposta, o provider alternativo será tentado com circuit breaker.',
  runtimeFailoverEnabled: true,
  actionExecutionEnabled: false,
  guardrailMessage: null,
  message: null,
}

async function installRoutes(context, licensed, state) {
  await context.addInitScript((authToken) => {
    localStorage.setItem('na_access_token', authToken)
    localStorage.setItem('na_refresh_token', 'harness')
  }, token())
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    state.requestPaths.push(`${request.method()} ${path}`)
    let body = []
    if (path === '/api/v1/features') body = { ...features, localAiLicensed: licensed }
    else if (path === '/api/v1/local-ai/status') body = status
    else if (path === '/api/v1/local-ai/admin/interactions') body = {
      retentionDays: 30,
      items: [{ id: '1', correlationId: '44eb50b4-86ab-4f0e-bc7e-e8bdeb958b72', channel: 'terminal', purpose: 'terminal_assist', provider: 'openai', model: 'gpt-test', routingPolicy: 'prefer_network', status: 'succeeded', hostId: 21, sessionId: 91, ticketKey: null, contextCategories: ['terminal_buffer'], contextChars: 200, tools: [], redactionCount: 1, latencyMs: 130, inputTokens: 100, outputTokens: 30, errorKind: null, estimatedUsdMicros: 1250, scriptArtifactId: 41, actionRunId: 51, retentionUntil: new Date(Date.now() + 86400000).toISOString(), createdAt: new Date().toISOString() }],
    }
    else if (path === '/api/v1/local-ai/admin/usage') body = {
      from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString(), days: 30, providers: [],
      totals: { requests: 1, successes: 1, failures: 0, inputTokens: 100, outputTokens: 30, estimatedUsdMicros: 1250, unpricedRequests: 0 },
    }
    else if (path === '/api/v1/local-ai/proposed-actions' || path === '/api/v1/local-ai/admin/proposed-actions') body = []
    else if (path === '/api/v1/local-ai/chat' && request.method() === 'POST') {
      state.chatPayloads.push(request.postDataJSON())
      body = {
        answer: 'Assistente operacional com contexto somente leitura.',
        provider: 'openai_compatible',
        mode: 'read_only',
        actionExecutionEnabled: false,
        guardrailMessage: null,
        citations: [{ kind: 'settings', label: 'Configuração do tenant' }],
        toolExecutions: [{ key: 'platform_snapshot', status: 'executed', durationMs: 12 }],
      }
    } else if (path === '/api/v1/hosts/bulk/preview' && request.method() === 'POST') {
      state.bulkPreviewPayloads.push(request.postDataJSON())
      body = {
        total: 1,
        blocked: 0,
        warnings: 0,
        actionLabel: 'Alterar Bastion para Gateway seguro',
        sample: [{ hostId: 21, name: 'Servidor aplicação', currentBastionId: null, currentBastionName: null, errors: [], warnings: [] }],
      }
    } else if (path === '/api/v1/hosts/bulk/apply' && request.method() === 'POST') {
      state.bulkApplyPayloads.push(request.postDataJSON())
      body = { updated: 1, skipped: 0, failed: 0, rows: [{ hostId: 21, name: 'Servidor aplicação', status: 'updated', message: 'Bastion atualizado' }] }
    } else if (path === '/api/v1/hosts') body = {
      data: [{
        id: 21, name: 'Servidor aplicação', description: null, ip: '10.0.0.21', port: 22, sshUser: 'ops',
        accessProtocol: 'ssh', operatingSystem: 'linux', authType: 'password', hasPasswordCredential: true,
        scope: 'global', connectionMode: 'direct', groupId: null, folderId: null, effectiveBastionId: null,
        pemKeyId: null, onePasswordRef: null, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
      page: 1, limit: 500, total: 1, totalPages: 1,
    }
    else if (path === '/api/v1/bastions') body = [{ id: 31, name: 'Gateway seguro', ip: '10.0.0.31', port: 22, sshUser: 'jump', authType: 'password', pemKeyId: null }]
    else if (path === '/api/v1/pem-keys' || path === '/api/v1/tags') body = []
    else if (path === '/api/v1/settings') body = { tenant: { id: 7, name: 'Acme', slug: 'acme' }, license: { featureEntitlements: {}, integrationEntitlements: {} } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function main() {
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser' })
  const state = { chatPayloads: [], bulkPreviewPayloads: [], bulkApplyPayloads: [], requestPaths: [] }

  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await installRoutes(context, true, state)
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${FRONTEND}/assistant`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('local-ai-view').waitFor()
  const statusCard = page.getByTestId('local-ai-status')
  await statusCard.getByText(/Failover: ativo|Failover: active/i).waitFor()
  await statusCard.getByText('ollama', { exact: true }).waitFor()
  await statusCard.getByText('openai_compatible', { exact: true }).waitFor()

  await page.getByTestId('local-ai-prompt').locator('textarea').fill('Quais recursos estão habilitados?')
  await page.getByTestId('local-ai-send').click()
  await page.getByText('Assistente operacional com contexto somente leitura.').waitFor()
  await page.getByText('openai_compatible', { exact: true }).last().waitFor()
  await page.locator('details').last().locator('summary').click()
  await page.getByText(/platform_snapshot/).waitFor()
  if (state.chatPayloads.length !== 1 || state.chatPayloads[0].message !== 'Quais recursos estão habilitados?') {
    throw new Error(`Payload de chat inesperado: ${JSON.stringify(state.chatPayloads)}`)
  }

  try {
    await page.getByTestId('local-ai-bulk-operations').waitFor({ timeout: 10000 })
  } catch {
    throw new Error(`Bloco bulk ausente. UI=${(await page.locator('body').innerText()).slice(0, 1500)} ERROS=${pageErrors.join(' | ')}`)
  }
  try {
    await page.getByTestId('local-ai-bulk-hosts').waitFor({ timeout: 10000 })
  } catch {
    throw new Error(`Seleção bulk indisponível. BLOCO=${await page.getByTestId('local-ai-bulk-operations').innerText()} REQS=${state.requestPaths.join(',')} ERROS=${pageErrors.join(' | ')}`)
  }
  await page.getByTestId('local-ai-bulk-hosts').click()
  await page.getByText(/Servidor aplicação/).last().click()
  await page.getByTestId('local-ai-bulk-review').click()
  const bulkModal = page.getByTestId('host-bulk-action-modal')
  await bulkModal.waitFor()
  await bulkModal.locator('.n-select').nth(1).click()
  await page.getByText('Gateway seguro', { exact: true }).last().click()
  await bulkModal.getByTestId('host-bulk-preview').waitFor()
  await bulkModal.getByTestId('host-bulk-apply').click()
  await bulkModal.getByTestId('host-bulk-result').waitFor()
  if (state.bulkPreviewPayloads.length !== 1 || state.bulkApplyPayloads.length !== 1) {
    throw new Error(`Fluxo bulk incompleto: ${JSON.stringify(state)}`)
  }
  if (state.bulkApplyPayloads[0].confirm !== true || state.bulkApplyPayloads[0].selection.hostIds[0] !== 21) {
    throw new Error(`Confirmação bulk inválida: ${JSON.stringify(state.bulkApplyPayloads)}`)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  const bounds = await page.getByTestId('local-ai-view').boundingBox()
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > 390) throw new Error(`Assistente fora do viewport mobile: ${JSON.stringify(bounds)}`)
  await page.goto(`${FRONTEND}/admin/ai-automation`, { waitUntil: 'domcontentloaded' })
  const ledger = page.getByTestId('ai-interaction-ledger')
  await ledger.getByText('script #41').waitFor()
  await ledger.getByText('run #51').waitFor()
  await ledger.getByText(/US\$|\$0[,.]00125/).waitFor()
  if (pageErrors.length) throw new Error(`Erros de UI: ${pageErrors.join(' | ')}`)
  await context.close()

  const unlicensedContext = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  await installRoutes(unlicensedContext, false, { chatPayloads: [], bulkPreviewPayloads: [], bulkApplyPayloads: [], requestPaths: [] })
  const unlicensedPage = await unlicensedContext.newPage()
  await unlicensedPage.goto(`${FRONTEND}/assistant`, { waitUntil: 'domcontentloaded' })
  await unlicensedPage.getByTestId('local-ai-unlicensed').waitFor()
  if (!await unlicensedPage.getByTestId('local-ai-send').isDisabled()) throw new Error('Envio deveria estar bloqueado sem licença')
  await unlicensedContext.close()

  console.log(JSON.stringify({ ok: true, cdp: !!CDP_URL, failoverVisible: true, chat: true, toolEvidence: true, correlatedLedger: true, governedBulk: true, mobile: true, licenseGuard: true }))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
