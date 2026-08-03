#!/usr/bin/env node
/*
 * HA admin UI smoke via Playwright.
 *
 * Default mode is fully mocked and read-only. It never calls a real HA API.
 *
 * Usage:
 *   FRONTEND_BASE=http://127.0.0.1:5173 \
 *   PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser \
 *   node tools/frontend/ha-playwright-smoke.cjs
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-ha-playwright-smoke.json'
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/tmp/nodeaccess-ha-playwright-artifacts'
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const HEADLESS = process.env.HEADLESS !== '0'
const LOADING_DELAY_MS = 1_000
const SECURE_FRONTEND = FRONTEND.startsWith('https://')

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '1',
    email: 'superadmin@nodeaccess.local',
    name: 'SuperAdmin HA Smoke',
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: 1,
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
    iat: now,
    exp: now + 3600,
  }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHash('sha256').update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

function fixtures(scenario) {
  const healthy = scenario !== 'degraded'
  const nodes = scenario === 'empty' ? [] : [{
    id: 'standby-a',
    name: 'nodeaccess-a',
    endpoint: '192.168.1.100',
    desiredRole: 'STANDBY',
    observedRole: 'STANDBY',
    ownsVip: false,
    virtualIp: '192.168.1.105',
    status: healthy ? 'HEALTHY' : 'DEGRADED',
    promotionReady: healthy,
    secureProvisioningReady: true,
    blockers: healthy ? [] : ['Redis está down'],
    notices: [],
    heartbeatAgeSeconds: 12,
    heartbeatState: 'CURRENT',
    components: {
      mysql: { status: 'ok', lagSeconds: 0 },
      redis: { status: healthy ? 'ok' : 'down' },
      files: { status: 'ok' },
      api: { status: 'ok' },
      frontend: { status: 'ok' },
      sshGateway: { status: 'ok' },
      guacd: { status: 'ok' },
      autoFailover: { status: 'ok' },
    },
    inventory: {
      hostname: 'nodeaccess-a',
      operatingSystem: 'Rocky Linux 9.6',
      architecture: 'x86_64',
      cpuCores: 4,
      memoryTotalMb: 8192,
      diskFreeMb: 18432,
      dockerInstalled: true,
      dockerVersion: '27.5.1',
      composeInstalled: true,
    },
    enrolledAt: '2026-07-27T20:00:00.000Z',
    lastSeenAt: '2026-07-27T21:40:00.000Z',
    createdAt: '2026-07-27T20:00:00.000Z',
  }, {
    id: 'primary-b',
    name: 'nodeaccess-b',
    endpoint: '192.168.1.101',
    desiredRole: 'PRIMARY',
    observedRole: 'PRIMARY',
    ownsVip: true,
    virtualIp: '192.168.1.105',
    status: 'HEALTHY',
    promotionReady: false,
    secureProvisioningReady: true,
    blockers: [],
    notices: [],
    heartbeatAgeSeconds: 8,
    heartbeatState: 'CURRENT',
    components: {
      mysql: { status: 'ok' },
      redis: { status: 'ok' },
      files: { status: 'ok' },
      api: { status: 'ok' },
      frontend: { status: 'ok' },
      sshGateway: { status: 'ok' },
      guacd: { status: 'ok' },
      autoFailover: { status: 'ok' },
    },
    inventory: {
      hostname: 'nodeaccess-b',
      operatingSystem: 'Rocky Linux 9.6',
      architecture: 'x86_64',
      cpuCores: 4,
      memoryTotalMb: 8192,
      diskFreeMb: 16384,
      dockerInstalled: true,
      dockerVersion: '27.5.1',
      composeInstalled: true,
    },
    enrolledAt: '2026-07-27T19:00:00.000Z',
    lastSeenAt: '2026-07-27T21:40:00.000Z',
    createdAt: '2026-07-27T19:00:00.000Z',
  }]
  const operations = scenario === 'empty' ? [] : [{
    id: 'preflight-1',
    nodeId: 'standby-a',
    nodeName: 'nodeaccess-a',
    type: 'PREFLIGHT',
    status: healthy ? 'READY' : 'BLOCKED',
    currentStage: 'PREFLIGHT_COMPLETE',
    steps: [
      { key: 'agent-heartbeat', label: 'Heartbeat do agente', status: 'ok' },
      { key: 'component-mysql', label: 'Componente mysql', status: 'ok' },
      { key: 'component-redis', label: 'Componente redis', status: healthy ? 'ok' : 'failed' },
      { key: 'fencing', label: 'Fencing ou witness', status: 'required' },
    ],
    errorLayer: healthy ? null : 'readiness',
    errorMessage: healthy ? null : '1 verificação impediu a promoção',
    initiatedById: 1,
    startedAt: '2026-07-27T21:41:00.000Z',
    finishedAt: '2026-07-27T21:41:01.000Z',
  }]
  return { nodes, operations }
}

async function installMocks(page, scenario, captured) {
  const data = fixtures(scenario)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const apiPath = new URL(request.url()).pathname.replace('/api/v1', '')
    captured.requests.push({ scenario, method: request.method(), path: apiPath })
    let status = 200
    let body = {}
    if (apiPath === '/features') {
      body = { integrationsLicensed: true, integrationProviders: {} }
    } else if (apiPath === '/users/me/preferences') {
      body = null
    } else if (apiPath === '/ha/nodes') {
      if (scenario === 'unlicensed') status = 403
      else if (scenario === 'api-error') status = 500
      else if (scenario === 'loading') {
        await new Promise((resolve) => setTimeout(resolve, LOADING_DELAY_MS))
      }
      body = status === 200 ? data.nodes : { message: status === 403 ? 'Recurso não licenciado' : 'HA indisponível' }
      captured.api.nodes = body
    } else if (apiPath === '/ha/operations') {
      body = data.operations
      captured.api.operations = body
    } else if (apiPath === '/ha/enrollments' && request.method() === 'POST') {
      body = {
        id: 'enrollment-node-b',
        token: 'enrollment-token',
        expiresAt: '2026-07-29T15:15:00.000Z',
      }
    } else if (
      apiPath === '/ha/nodes/standby-a/inventory-refresh'
      && request.method() === 'POST'
    ) {
      body = {
        id: 'provisioning-1',
        nodeId: 'standby-a',
        nodeName: 'nodeaccess-a',
        type: 'PROVISIONING',
        status: 'RUNNING',
        currentStage: 'QUEUED',
        steps: [
          { key: 'approval', label: 'Aprovação explícita', status: 'ok' },
          { key: 'agent-execution', label: 'Execução pelo agente', status: 'required' },
        ],
        errorLayer: null,
        errorMessage: null,
        initiatedById: 1,
        startedAt: '2026-07-28T20:01:00.000Z',
        finishedAt: null,
      }
      data.operations.unshift(body)
    } else if (
      apiPath === '/ha/nodes/standby-a/storage/prepare'
      && request.method() === 'POST'
    ) {
      body = {
        id: 'prepare-storage-1',
        nodeId: 'standby-a',
        nodeName: 'nodeaccess-a',
        type: 'PROVISIONING',
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        steps: [
          { key: 'approval', label: 'Aprovação explícita', status: 'ok' },
          { key: 'prepare-storage', label: 'Preparar diretórios de dados', status: 'ok' },
        ],
        errorLayer: null,
        errorMessage: null,
        initiatedById: 1,
        startedAt: '2026-07-28T20:02:00.000Z',
        finishedAt: '2026-07-28T20:02:01.000Z',
      }
      data.operations.unshift(body)
    } else if (
      apiPath === '/ha/nodes/standby-a/storage/validate-write'
      && request.method() === 'POST'
    ) {
      body = {
        id: 'validate-storage-write-1',
        nodeId: 'standby-a',
        nodeName: 'nodeaccess-a',
        type: 'PROVISIONING',
        status: 'RUNNING',
        currentStage: 'QUEUED',
        steps: [
          { key: 'approval', label: 'Aprovação explícita', status: 'ok' },
          { key: 'validate-storage-write', label: 'Validar escrita nos diretórios', status: 'required' },
        ],
        errorLayer: null,
        errorMessage: null,
        initiatedById: 1,
        startedAt: '2026-07-28T20:03:00.000Z',
        finishedAt: null,
      }
      data.operations.unshift(body)
    } else if (
      apiPath === '/ha/nodes/standby-a/provisioning-plan'
      && request.method() === 'POST'
    ) {
      body = {
        id: 'provision-plan-1',
        nodeId: 'standby-a',
        nodeName: 'nodeaccess-a',
        type: 'PROVISION_PLAN',
        status: 'READY',
        currentStage: 'PLAN_COMPLETE',
        steps: [
          { key: 'inventory', label: 'Inventário recebido do agente', status: 'ok' },
          { key: 'docker', label: 'Docker Engine', status: 'ok' },
          { key: 'nodeaccess-stack', label: 'Stack NodeAccess', status: 'required', message: 'Publicar a release.' },
          { key: 'state-replication', label: 'MySQL, Redis e arquivos replicados', status: 'required', message: 'Configurar as réplicas.' },
          { key: 'traffic', label: 'Keepalived, interface e VIP', status: 'required', message: 'Configurar a VIP.' },
          { key: 'approval', label: 'Aprovação para executar o provisionamento', status: 'required' },
        ],
        errorLayer: null,
        errorMessage: null,
        initiatedById: 1,
        startedAt: '2026-07-28T20:00:00.000Z',
        finishedAt: '2026-07-28T20:00:01.000Z',
      }
      data.operations.unshift(body)
    } else if (
      apiPath === '/ha/nodes/standby-a/release/install'
      && request.method() === 'POST'
    ) {
      body = {
        id: 'install-release-1',
        nodeId: 'standby-a',
        nodeName: 'nodeaccess-a',
        type: 'PROVISIONING',
        status: 'RUNNING',
        currentStage: 'QUEUED',
        steps: [
          { key: 'approval', label: 'Aprovação explícita', status: 'ok' },
          { key: 'install-release', label: 'Baixar e promover release', status: 'required' },
        ],
        errorLayer: null,
        errorMessage: null,
        initiatedById: 1,
        startedAt: '2026-07-29T21:00:00.000Z',
        finishedAt: null,
      }
      data.operations.unshift(body)
    } else if (
      apiPath === '/ha/nodes/standby-a/rejoin-preflight'
      && request.method() === 'POST'
    ) {
      body = {
        id: 'rejoin-preflight-1',
        nodeId: 'standby-a',
        nodeName: 'nodeaccess-a',
        type: 'FAILBACK',
        status: 'READY',
        currentStage: 'REJOIN_PREFLIGHT_COMPLETE',
        steps: [
          { key: 'mysql-zero-lag', label: 'Lag MySQL zerado', status: 'ok' },
          { key: 'file-replication', label: 'Arquivos sincronizados', status: 'ok' },
          { key: 'fencing', label: 'Fencing ou witness', status: 'required' },
        ],
        errorLayer: null,
        errorMessage: null,
        initiatedById: 1,
        startedAt: '2026-07-28T10:00:00.000Z',
        finishedAt: '2026-07-28T10:00:01.000Z',
      }
      data.operations.unshift(body)
    } else if (apiPath === '/auth/refresh') {
      body = { accessToken: fakeJwt() }
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
  return data
}

async function runScenario(browser, scenario, viewport, captured) {
  const context = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await context.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'ha-smoke-refresh')
  }, fakeJwt())
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    const expectedHttpError = ['unlicensed', 'api-error'].includes(scenario)
      && text.includes('Failed to load resource')
    if (!expectedHttpError) consoleErrors.push(text)
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.routeWebSocket('**/ws/events**', (webSocket) => {
    webSocket.onMessage(() => {})
  })
  const expected = await installMocks(page, scenario, captured)

  await page.goto(`${FRONTEND}/platform/high-availability?haSmoke=${scenario}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  await page.getByRole('heading', { name: 'Alta disponibilidade' }).waitFor()
  const settingsSection = page.locator('details').filter({
    has: page.getByText(/^Configurações(?: e operação dos nós)?$/),
  }).first()
  if (!await settingsSection.evaluate((element) => element.open)) {
    throw new Error('A seção Configurações deve iniciar expandida')
  }

  const body = page.locator('body')
  const result = {
    scenario,
    viewport,
    consoleErrors,
    pageErrors,
    horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    titleVisible: await body.getByText('Topologia, replicação e prontidão para failover.').isVisible(),
  }

  if (scenario === 'loading') {
    result.loadingVisible = await page.locator('.n-spin-body').isVisible()
    await page.getByRole('heading', { name: expected.nodes[0].name, exact: true }).waitFor()
    await page.locator('.n-spin-body').waitFor({ state: 'hidden' })
    result.loadingFinished = await page.locator('.n-spin-body').isHidden()
    result.nodeVisible = await page.getByRole('heading', { name: expected.nodes[0].name, exact: true }).isVisible()
  } else {
    await page.waitForLoadState('networkidle')
  }

  if (scenario === 'healthy') {
    result.setupCompleteVisible = await body.getByText('HA preparado para operação', { exact: true }).isVisible()
    result.setupProgressVisible = await body.getByText('6/6', { exact: true }).isVisible()
    result.operationalShortcutVisible = await page.getByRole('button', { name: 'Ir para operação' }).isVisible()
    result.healthyAlert = await body.getByText('Standby pronto para failover').isVisible()
    result.nodeVisible = await page.getByRole('heading', { name: expected.nodes[0].name, exact: true }).isVisible()
    result.topologyMapVisible = await page.getByRole('heading', { name: 'Visão central da topologia' }).isVisible()
    result.vipOwnerVisible = await body.getByText('Ativa em nodeaccess-b', { exact: true }).isVisible()
    result.readyCandidateVisible = await body.getByText('Pronto para promoção', { exact: true }).isVisible()
    await page.getByRole('button', { name: 'Ajuda: VIP' }).hover()
    await page.waitForTimeout(250)
    result.vipHelpVisible = await body.getByText(
      'VIP é o endereço único usado para acessar o NodeAccess. Ele acompanha o nó ativo durante uma troca controlada.',
      { exact: true },
    ).isVisible()
    result.statusMatchesApi = await body.getByText('Saudável', { exact: true }).first().isVisible()
    result.promotionMatchesApi = await body.getByText('Sim', { exact: true }).first().isVisible()
    result.mysqlMatchesApi = await body.getByText(
      `MySQL: ${expected.nodes[0].components.mysql.status} · lag ${expected.nodes[0].components.mysql.lagSeconds}s`,
      { exact: true },
    ).isVisible()
    result.redisMatchesApi = await body.getByText(
      `Redis: ${expected.nodes[0].components.redis.status}`,
      { exact: true },
    ).first().isVisible()
    result.inventoryVisible = await body.getByText('Rocky Linux 9.6 · x86_64', { exact: true }).first().isVisible()
    const promoteButton = page.getByRole('button', { name: 'Promover este nó' }).first()
    result.promoteActionVisible = await promoteButton.isVisible()
    await promoteButton.click()
    result.guidedPromotionVisible = await body.getByText('Execução assistida', { exact: true }).isVisible()
    result.guidedPromotionTitleVisible = await page.locator(
      '.n-modal .n-card-header__main',
    ).filter({ hasText: /^Promover .+$/ }).isVisible()
    result.guidedPromotionFirstStepVisible = await body.getByText(
      'Validar o candidato',
      { exact: true },
    ).isVisible()
    result.guidedPromotionCommandVisible = await page.getByLabel(
      'Comando assistido para operação HA',
    ).isVisible()
    const witnessIssueCommand = await page.locator(
      '[aria-label="Comando para emitir autorização no witness"] textarea',
    ).inputValue()
    const quiesceCommand = await page.locator(
      '[aria-label="Comando para congelar o nó primário"] textarea',
    ).inputValue()
    const promotionCommand = await page.locator(
      '[aria-label="Comando assistido para operação HA"] textarea',
    ).inputValue()
    result.simpleWitnessCommandVisible = witnessIssueCommand.startsWith(
      'sudo nodeaccess-ha-witness-authorize planned',
    )
    const quiesceOperationId = quiesceCommand.match(/OPERATION_ID='([^']+)'/)?.[1]
    result.guidedQuiesceCommandVisible = quiesceCommand.includes(
      'quiesce-ha-primary.sh',
    )
    result.guidedPromotionCopyVisible = await page.getByRole(
      'button',
      { name: 'Copiar promoção' },
    ).isVisible()
    result.guidedSharedOperationIdVisible = Boolean(
      quiesceOperationId
      && quiesceOperationId.startsWith('switchover-')
      && promotionCommand.includes(`OPERATION_ID='${quiesceOperationId}'`),
    )
    await page.getByRole('button', { name: 'Fechar' }).click()
    const advancedActions = page.locator('.advanced-actions').first()
    result.advancedActionsInitiallyCollapsed = !await advancedActions.evaluate(
      (element) => element.open,
    )
    await advancedActions.locator('summary').click()
    const journalSection = page.locator('summary', {
      hasText: 'Journal de operações',
    }).locator('..')
    result.journalInitiallyCollapsed = !await journalSection.evaluate(
      (element) => element.open,
    )
    await journalSection.locator('summary').click()
    result.journalVisible = await body.getByText('nodeaccess-a · Preflight').isVisible()
    await page.getByRole('button', { name: 'Avaliar provisionamento' }).first().click()
    result.provisioningPlanVisible = await body.getByText(
      'nodeaccess-a · Plano de provisionamento',
      { exact: true },
    ).isVisible()
    result.provisioningPlanLabelVisible = await body.getByText(
      'Plano disponível',
      { exact: true },
    ).isVisible()
    result.provisioningApprovalVisible = await body.getByText(
      'Aprovação para executar o provisionamento: pendente',
      { exact: true },
    ).isVisible()
    const secureConfigurationButton = page.getByRole('button', {
      name: 'Aplicar configuração segura',
    }).first()
    result.secureConfigurationTransportCorrect = SECURE_FRONTEND
      ? await secureConfigurationButton.isEnabled()
      : await secureConfigurationButton.isDisabled()
    await page.getByRole('button', { name: 'Ajuda: Aplicar configuração segura' }).hover()
    await page.waitForTimeout(250)
    const secureTransportHelpVisible = await body.getByText(
      'Configure HTTPS no painel antes de transportar segredos.',
      { exact: true },
    ).isVisible()
    result.secureTransportGuidanceCorrect = SECURE_FRONTEND
      ? !secureTransportHelpVisible
      : secureTransportHelpVisible
    await page.getByRole('button', { name: 'Instalar release' }).first().click()
    result.releaseModalVisible = await page.getByText(
      'Instalar release no standby',
      { exact: true },
    ).isVisible()
    const releaseSubmit = page.getByRole('button', { name: 'Autorizar instalação' })
    result.releaseSubmitInitiallyDisabled = await releaseSubmit.isDisabled()
    await page.getByLabel('URL do pacote da release').fill(
      'https://releases.example/nodeaccess-release-2.0.28.tar.gz',
    )
    await page.getByLabel('SHA-256 esperado').fill('a'.repeat(64))
    result.releaseSubmitEnabled = await releaseSubmit.isEnabled()
    await releaseSubmit.click()
    result.releaseExecutionVisible = await body.getByText(
      'Baixar e promover release: pendente',
      { exact: true },
    ).isVisible()
    await page.getByRole('button', { name: 'Validar executor' }).first().click()
    await page.getByRole('button', { name: 'Confirmar' }).click()
    result.governedExecutionVisible = await body.getByText(
      'nodeaccess-a · Validação do executor',
      { exact: true },
    ).first().isVisible()
    result.governedExecutionRunningVisible = await body.getByText(
      'Em execução',
      { exact: true },
    ).first().isVisible()
    await page.getByRole('button', { name: 'Preparar diretórios', exact: true }).first().click()
    await page.getByRole('button', { name: 'Preparar diretórios', exact: true }).last().click()
    result.storagePreparationVisible = await body.getByText(
      'nodeaccess-a · Preparação de diretórios',
      { exact: true },
    ).isVisible()
    result.storagePreparationPendingVisible = await body.getByText(
      'Preparar diretórios de dados: ok',
      { exact: true },
    ).isVisible()
    await page.getByRole('button', { name: 'Validar escrita', exact: true }).first().click()
    await page.getByRole('button', { name: 'Validar escrita', exact: true }).last().click()
    result.storageWriteValidationVisible = await body.getByText(
      'nodeaccess-a · Validação de escrita',
      { exact: true },
    ).isVisible()
    result.storageWriteValidationPendingVisible = await body.getByText(
      'Validar escrita nos diretórios: pendente',
      { exact: true },
    ).isVisible()
    await page.getByRole('button', { name: 'Validar retorno' }).first().click()
    result.rejoinReadyVisible = await body.getByText(
      'nodeaccess-a · Validação de retorno',
      { exact: true },
    ).isVisible()
    result.rejoinLagGateVisible = await body.getByText(
      'Lag MySQL zerado: ok',
      { exact: true },
    ).isVisible()
    const primaryCta = page.getByRole('button', { name: 'Desabilitar HA' })
    await page.locator('body').click({ position: { x: 1, y: 1 } })
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press('Tab')
      if (await primaryCta.evaluate((element) => element === document.activeElement)) break
    }
    result.primaryCtaKeyboardReachable = await primaryCta.evaluate(
      (element) => element === document.activeElement,
    )
    result.primaryCtaFocusVisible = await primaryCta.evaluate((element) => {
      const style = getComputedStyle(element)
      return style.outlineStyle !== 'none'
        || style.outlineWidth !== '0px'
        || style.boxShadow !== 'none'
    })
  } else if (scenario === 'degraded') {
    result.degradedAlert = await body.getByText('Há nós que não podem ser promovidos').isVisible()
    result.statusMatchesApi = await body.getByText('Degradado', { exact: true }).isVisible()
    result.promotionMatchesApi = await body.getByText('Não', { exact: true }).isVisible()
    result.blockerMatchesApi = await page.getByRole('listitem').filter({
      hasText: expected.nodes[0].blockers[0],
    }).isVisible()
    result.redisMatchesApi = await body.getByText('Redis: down', { exact: true }).isVisible()
  } else if (scenario === 'empty') {
    result.setupWizardVisible = await body.getByText('Prepare o HA em seis etapas', { exact: true }).isVisible()
    result.setupFirstPendingVisible = await body.getByText('Reservar IPs e a VIP', { exact: true }).isVisible()
    result.emptyVisible = await body.getByText('Nenhum nó HA anexado.').isVisible()
    const emptyJournalSection = page.locator('summary', {
      hasText: 'Journal de operações',
    }).locator('..')
    result.emptyJournalInitiallyCollapsed = !await emptyJournalSection.evaluate(
      (element) => element.open,
    )
    await emptyJournalSection.locator('summary').click()
    result.emptyJournalVisible = await body.getByText('Nenhuma operação executada.').isVisible()
    await page.getByRole('button', { name: 'Anexar nó' }).click()
    const vipInput = page.getByPlaceholder('Ex.: 192.168.1.105')
    result.vipFieldVisible = await vipInput.isVisible()
    const submit = page.getByRole('button', { name: 'Gerar matrícula' })
    result.enrollmentBlockedWithoutVip = await submit.isDisabled()
    await page.getByPlaceholder('Ex.: nodeaccess-b').fill('nodeaccess-b')
    await vipInput.fill('192.0.2.105')
    await submit.click()
    result.agentScopeVisible = await body.getByText(
      'O agente inicia a validação e pode instalar a release',
      { exact: true },
    ).isVisible()
    result.explicitVipInCommand = await page.locator('.install-card textarea')
      .inputValue()
      .then((value) => value.includes("--virtual-ip '192.0.2.105'"))
    const httpOptInInCommand = await page.locator('.install-card textarea')
      .inputValue()
      .then((value) => value.includes('NODEACCESS_HA_ALLOW_HTTP=true'))
    result.enrollmentTransportCorrect = SECURE_FRONTEND
      ? !httpOptInInCommand
      : httpOptInInCommand
  } else if (scenario === 'unlicensed') {
    result.unlicensedVisible = await body.getByText('Recurso não habilitado na licença').isVisible()
    result.enableCtaVisible = await page.getByRole('button', { name: 'Habilitar alta disponibilidade' }).isVisible()
  } else if (scenario === 'api-error') {
    result.errorVisible = await body.getByText('HA indisponível').isVisible()
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true })
  result.screenshot = path.join(ARTIFACTS_DIR, `${scenario}-${viewport.width}x${viewport.height}.png`)
  await page.screenshot({ path: result.screenshot, fullPage: true })
  const scenarioFailed = consoleErrors.length > 0
    || pageErrors.length > 0
    || result.horizontalOverflow
    || Object.entries(result).some(([key, value]) => (
      (key.endsWith('Visible')
        || key.endsWith('Api')
        || key.endsWith('Reachable')
        || key.endsWith('Finished')
        || key === 'enrollmentBlockedWithoutVip'
        || key === 'explicitVipInCommand'
        || key.endsWith('Correct')
        || key === 'advancedActionsInitiallyCollapsed'
        || key === 'journalInitiallyCollapsed'
        || key === 'emptyJournalInitiallyCollapsed'
        )
      && value !== true
    ))
  if (scenarioFailed) {
    result.trace = path.join(ARTIFACTS_DIR, `${scenario}-${viewport.width}x${viewport.height}.zip`)
    await context.tracing.stop({ path: result.trace })
  } else {
    await context.tracing.stop()
  }
  await context.close()
  return result
}

function findings(results) {
  const issues = []
  for (const result of results) {
    if (result.consoleErrors.length) issues.push(`${result.scenario}: erros no console`)
    if (result.pageErrors.length) issues.push(`${result.scenario}: exceções na página`)
    if (result.horizontalOverflow) issues.push(`${result.scenario}: overflow horizontal`)
    for (const [key, value] of Object.entries(result)) {
      if (key.endsWith('Visible')
        || key.endsWith('Api')
        || key.endsWith('Reachable')
        || key.endsWith('Finished')
        || key === 'enrollmentBlockedWithoutVip'
        || key === 'explicitVipInCommand'
        || key.endsWith('Correct')
        || key === 'advancedActionsInitiallyCollapsed'
        || key === 'journalInitiallyCollapsed'
        || key === 'emptyJournalInitiallyCollapsed') {
        if (value !== true) issues.push(`${result.scenario}: ${key}=false`)
      }
    }
  }
  return issues
}

async function main() {
  const launchOptions = { headless: HEADLESS, args: ['--no-sandbox', '--disable-gpu'] }
  if (fs.existsSync(EXECUTABLE_PATH)) launchOptions.executablePath = EXECUTABLE_PATH
  const browser = await chromium.launch(launchOptions)
  const captured = { requests: [], api: {} }
  try {
    const results = []
    for (const scenario of ['healthy', 'loading', 'degraded', 'empty', 'unlicensed', 'api-error']) {
      results.push(await runScenario(browser, scenario, { width: 1440, height: 1000 }, captured))
    }
    results.push(await runScenario(browser, 'healthy', { width: 390, height: 844 }, captured))
    const report = {
      runner: 'playwright',
      mode: 'mocked-read-only',
      frontend: FRONTEND,
      results,
      requests: captured.requests,
      findings: findings(results),
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (report.findings.length) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
