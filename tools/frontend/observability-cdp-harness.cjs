#!/usr/bin/env node
/*
 * Admin Observability UI harness via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9356 --user-data-dir=/tmp/nodeaccess-observability-ui \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 \
 *   CDP_BASE=http://127.0.0.1:9356 \
 *   node tools/frontend/observability-cdp-harness.cjs
 */

const fs = require('node:fs')
const http = require('node:http')
const crypto = require('node:crypto')
const WebSocket = require('ws')

const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9356'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-observability-harness.json'
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || ''

let scenario = 'healthy'
const captured = {
  apiCalls: [],
  console: [],
  pageErrors: [],
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timeout } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(timeout)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
        return
      }
      if (msg.method === 'Fetch.requestPaused') void this.handleFetch(msg.params)
      if (msg.method === 'Runtime.consoleAPICalled') captured.console.push(msg.params)
      if (msg.method === 'Runtime.exceptionThrown') captured.pageErrors.push(msg.params)
    })
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve)
      this.ws.once('error', reject)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 20000)
      this.pending.set(id, { resolve, reject, timeout })
    })
  }

  async handleFetch(params) {
    const { requestId, request } = params
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/v1/')) {
      await this.send('Fetch.continueRequest', { requestId })
      return
    }

    const apiPath = url.pathname.replace('/api/v1', '')
    captured.apiCalls.push({ scenario, method: request.method, path: apiPath })
    const response = mockApi(request.method, apiPath)

    await this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: response.status,
      responseHeaders: [
        { name: 'access-control-allow-origin', value: '*' },
        { name: 'content-type', value: response.contentType || 'application/json' },
      ],
      body: Buffer.from(response.rawBody ?? JSON.stringify(response.body)).toString('base64'),
    })
  }

  close() {
    this.ws.close()
  }
}

function ok(body) {
  return { status: 200, body }
}

function fakeJwt(isPlatformAdmin = true) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: '1',
    email: 'admin@nodeaccess.local',
    name: 'Admin Harness',
    role: 'admin',
    isPlatformAdmin,
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

function mockApi(method, apiPath) {
  if (method === 'GET' && apiPath === '/features') {
    return ok({
      agentsLicensed: true,
      secretsLicensed: true,
      snippetsLicensed: true,
      portForwardingLicensed: true,
      feedbackLicensed: true,
      localAiLicensed: true,
      mcpEnabled: true,
      integrationsLicensed: true,
      integrationProviders: {},
    })
  }
  if (method === 'GET' && apiPath === '/users/me/preferences') return ok(null)
  if (method === 'PATCH' && apiPath === '/users/me/preferences') return ok({})
  if (method === 'POST' && apiPath === '/auth/refresh') return ok({ accessToken: fakeJwt() })
  if (method === 'POST' && apiPath.endsWith('/events')) return ok({ ok: true })
  if (method === 'POST' && apiPath === '/logs/user-productivity') return ok({ ok: true })
  if (method === 'GET' && apiPath === '/admin/observability/summary' && scenario === 'api-error') {
    return { status: 500, body: { message: 'observability unavailable' } }
  }
  if (method === 'GET' && apiPath === '/admin/observability/summary') return ok(makeSnapshot(scenario))
  return ok({})
}

function makeSnapshot(kind) {
  const degraded = kind === 'degraded'
  const emptyHistory = kind === 'empty-history'
  const emptyDisk = kind === 'empty-disk'
  const history = emptyHistory ? [] : Array.from({ length: 12 }, (_, index) => {
    const drift = index * 2
    return {
      timestamp: new Date(Date.parse('2026-07-23T17:00:00.000Z') + index * 5_000).toISOString(),
      status: degraded && index > 8 ? 'degraded' : 'ok',
      cpuPercent: degraded ? Math.min(94, 48 + drift * 2) : 10 + drift,
      memoryPercent: degraded ? Math.min(93, 62 + drift) : 30 + drift,
      diskPercent: degraded ? Math.min(94, 70 + drift) : 26 + drift,
      unavailableComponents: degraded && index > 8 ? 1 : 0,
      unavailableBackups: degraded && index > 8 ? 1 : 0,
      dockerStatus: degraded && index > 8 ? 'unavailable' : 'ok',
    }
  })
  const disks = emptyDisk ? [] : [
    { mount: '/', path: '/app', totalBytes: 1000 * 1024 * 1024 * 1024, usedBytes: 420 * 1024 * 1024 * 1024, availableBytes: 580 * 1024 * 1024 * 1024, usedPercent: 42 },
    { mount: '/data', path: '/data/session-audit', totalBytes: 500 * 1024 * 1024 * 1024, usedBytes: degraded ? 470 * 1024 * 1024 * 1024 : 150 * 1024 * 1024 * 1024, availableBytes: degraded ? 30 * 1024 * 1024 * 1024 : 350 * 1024 * 1024 * 1024, usedPercent: degraded ? 94 : 30 },
  ]
  return {
    status: degraded || emptyDisk ? 'degraded' : 'ok',
    timestamp: '2026-07-23T18:00:00.000Z',
    version: '0.1.0',
    cacheTtlMs: 5000,
    host: {
      hostname: 'nodeaccess-harness',
      platform: 'linux',
      arch: 'x64',
      uptimeSeconds: 18720,
      cpu: {
        cores: 8,
        model: 'Harness CPU',
        loadAverage: { oneMinute: degraded ? 7.2 : 1.25, fiveMinutes: 1.4, fifteenMinutes: 1.1 },
        loadPercentOfCores: degraded ? 90 : 16,
      },
      memory: {
        totalBytes: 16 * 1024 * 1024 * 1024,
        freeBytes: degraded ? 700 * 1024 * 1024 : 9 * 1024 * 1024 * 1024,
        usedBytes: degraded ? 15 * 1024 * 1024 * 1024 : 7 * 1024 * 1024 * 1024,
        usedPercent: degraded ? 93 : 44,
        processRssBytes: 360 * 1024 * 1024,
        processHeapUsedBytes: 90 * 1024 * 1024,
        processHeapTotalBytes: 160 * 1024 * 1024,
      },
      disks,
    },
    docker: {
      status: degraded ? 'unavailable' : 'ok',
      message: degraded ? 'Docker stats indisponivel neste no. Verifique se a API tem acesso ao Docker CLI/socket.' : undefined,
      containers: degraded ? [] : [
        { id: 'api123', name: 'nodeaccess-api', cpuPercent: 4.2, memoryUsageBytes: 220 * 1024 * 1024, memoryLimitBytes: 1024 * 1024 * 1024, memoryPercent: 21.5, networkInputBytes: 1200000, networkOutputBytes: 3400000, blockInputBytes: 100000, blockOutputBytes: 200000 },
        { id: 'redis12', name: 'nodeaccess-redis', cpuPercent: 1.1, memoryUsageBytes: 80 * 1024 * 1024, memoryLimitBytes: 512 * 1024 * 1024, memoryPercent: 15.6, networkInputBytes: 400000, networkOutputBytes: 600000, blockInputBytes: 20000, blockOutputBytes: 30000 },
      ],
    },
    components: [
      { name: 'api', status: 'ok', latencyMs: 12 },
      { name: 'gateway', status: degraded ? 'unavailable' : 'ok', latencyMs: degraded ? 2500 : 16, message: degraded ? 'timeout' : undefined },
      { name: 'mysql', status: 'ok', latencyMs: 8 },
      { name: 'redis', status: 'ok', latencyMs: 3 },
      { name: 'guacd', status: 'ok', latencyMs: 6 },
    ],
    backups: [
      { type: 'mysql', status: 'ok', directory: '/backups', latestFile: '/backups/nodeaccess-mysql.manifest.json', latestModifiedAt: '2026-07-23T16:00:00.000Z', ageHours: 2 },
      { type: 'session_audit', status: degraded ? 'unavailable' : 'ok', directory: '/backups', latestFile: degraded ? null : '/backups/nodeaccess-session-audit.manifest.json', latestModifiedAt: degraded ? null : '2026-07-23T15:00:00.000Z', ageHours: degraded ? null : 3, message: degraded ? 'Backup não encontrado' : undefined },
    ],
    scope: {
      kind: 'node',
      nodeId: 'nodeaccess-harness',
      aggregation: 'local-only',
      note: 'Snapshot local deste no. Em HA multi-maquina, use agregador para consolidar todos os nos.',
    },
    thresholds: {
      cpuWarningPercent: 85,
      memoryWarningPercent: 85,
      diskWarningPercent: 90,
      backupMaxAgeHours: 30,
    },
    history,
    warnings: [
      ...(degraded ? ['Docker stats indisponivel', 'Um ou mais componentes estao indisponiveis'] : []),
      ...(emptyDisk ? ['Metricas de disco indisponiveis'] : []),
    ],
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

async function waitFor(cdp, expression, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    const result = await evaluate(cdp, expression)
    last = result
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    throw new Error(details.exception?.description || details.text || 'Runtime exception')
  }
  return result.result?.value
}

async function textIncludes(cdp, text) {
  return evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(text)})`)
}

async function contentIncludes(cdp, text) {
  return evaluate(cdp, `document.body.textContent.includes(${JSON.stringify(text)})`)
}

async function openDetail(cdp, label) {
  return evaluate(cdp, `(() => {
    const summary = [...document.querySelectorAll('summary')].find((item) => item.textContent.includes(${JSON.stringify(label)}));
    if (!summary) return false;
    summary.click();
    return summary.parentElement?.open === true;
  })()`)
}

async function navigate(cdp, nextScenario, waitText = 'Visão geral') {
  scenario = nextScenario
  await cdp.send('Page.navigate', { url: `${FRONTEND}/admin/observability?harness=${encodeURIComponent(nextScenario)}&t=${Date.now()}` })
  await waitFor(cdp, `document.body.innerText.includes('Observabilidade')`)
  await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(waitText)})`)
}

async function captureScreenshot(cdp, name) {
  if (!SCREENSHOT_DIR) return null
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const file = `${SCREENSHOT_DIR}/${name}.png`
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
  return file
}

async function snapshotLayout(cdp) {
  return evaluate(cdp, `(() => {
    const cards = [...document.querySelectorAll('.na-card')].map((el) => {
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
    });
    return {
      title: document.querySelector('h1')?.textContent || '',
      bodyText: document.body.innerText,
      cardCount: cards.length,
      cards,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      nodeCount: document.querySelectorAll('*').length,
    };
  })()`)
}

function collectFindings(results) {
  const findings = []
  for (const result of results) {
    if (!result.titleVisible) findings.push(`${result.scenario}: titulo nao ficou visivel`)
    if (result.scenario === 'api-error') {
      if (!result.errorVisible) findings.push(`${result.scenario}: erro da API nao ficou visivel`)
      continue
    }
    if (!result.statusVisible) findings.push(`${result.scenario}: status esperado nao ficou visivel`)
    if (!result.componentsVisible) findings.push(`${result.scenario}: componentes nao ficaram visiveis`)
    if (!result.backupsVisible) findings.push(`${result.scenario}: backups nao ficaram visiveis`)
    if (!result.trendVisible) findings.push(`${result.scenario}: tendencia recente nao ficou visivel`)
    if (!result.limitsVisible) findings.push(`${result.scenario}: limites operacionais nao ficaram visiveis`)
    if (result.scenario === 'degraded' && !result.dockerHelpVisible) {
      findings.push(`${result.scenario}: explicacao de Docker indisponivel nao ficou visivel`)
    }
    if (result.scenario === 'empty-disk' && !result.diskEmptyVisible) {
      findings.push(`${result.scenario}: estado sem metrica de disco nao ficou visivel`)
    }
    if (result.layout.scrollWidth > result.layout.clientWidth + 4) {
      findings.push(`${result.scenario}: overflow horizontal ${result.layout.scrollWidth}/${result.layout.clientWidth}`)
    }
    if (result.layout.cardCount < 3) findings.push(`${result.scenario}: poucos cards renderizados (${result.layout.cardCount})`)
    if (!result.detailsVisible) findings.push(`${result.scenario}: detalhes progressivos nao ficaram acessiveis`)
    if (result.viewport === 'desktop' && !result.platformMenuVisible) findings.push(`${result.scenario}: observabilidade nao ficou agrupada em Plataforma`)
    if (result.scenario === 'healthy' && result.viewport === 'desktop' && !result.detailsOpened) findings.push('healthy: detalhes nao abriram por interacao')
    if (result.scenario === 'degraded' && !result.degradedDetailsAccessible) findings.push('degraded: mensagens de diagnostico nao ficaram acessiveis por teclado')
  }
  if (captured.pageErrors.length) findings.push(`Page errors: ${captured.pageErrors.length}`)
  const consoleErrors = captured.console.filter((entry) => ['error', 'assert'].includes(entry.type))
  if (consoleErrors.length) findings.push(`Console errors: ${consoleErrors.length}`)
  return findings
}

async function main() {
  const tabs = await getJson(`${CDP_BASE}/json`)
  const tab = tabs.find((item) => item.type === 'page') || tabs[0]
  if (!tab?.webSocketDebuggerUrl) throw new Error(`No CDP page found at ${CDP_BASE}`)

  const cdp = new Cdp(tab.webSocketDebuggerUrl)
  await cdp.open()
  try {
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    await cdp.send('Network.enable')
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        if (!sessionStorage.getItem('nodeaccess_harness_profile_override')) {
          localStorage.setItem('na_access_token', ${JSON.stringify(fakeJwt())});
        }
        localStorage.setItem('na_refresh_token', 'harness-refresh-token');
        localStorage.setItem('nodeaccess_locale', 'pt-BR');
      `,
    })

    const results = []

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await navigate(cdp, 'healthy')
    const detailsOpened = await openDetail(cdp, 'Servidor e limites')
    const expandedLimitsVisible = await textIncludes(cdp, 'CPU 85%, memória 85%, disco 90%, backup 30h')
    await openDetail(cdp, 'Servidor e limites')
    results.push({
      scenario,
      viewport: 'desktop',
      titleVisible: await textIncludes(cdp, 'Observabilidade'),
      statusVisible: await textIncludes(cdp, 'Saudável'),
      componentsVisible: await textIncludes(cdp, 'Gateway SSH'),
      backupsVisible: await textIncludes(cdp, 'Auditoria SSH'),
      trendVisible: await textIncludes(cdp, 'Tendência recente'),
      detailsVisible: await textIncludes(cdp, 'Servidor e limites'),
      detailsOpened,
      limitsVisible: expandedLimitsVisible,
      platformMenuVisible: await evaluate(cdp, `[...document.querySelectorAll('.n-menu-item-group')].some((group) => group.innerText.includes('Plataforma') && group.innerText.includes('Observabilidade'))`),
      layout: await snapshotLayout(cdp),
      screenshot: await captureScreenshot(cdp, 'observability-healthy-desktop'),
    })

    await navigate(cdp, 'degraded')
    await openDetail(cdp, 'Containers')
    results.push({
      scenario,
      viewport: 'desktop',
      titleVisible: await textIncludes(cdp, 'Observabilidade'),
      statusVisible: await textIncludes(cdp, 'Atenção'),
      componentsVisible: await textIncludes(cdp, 'Gateway SSH'),
      backupsVisible: await textIncludes(cdp, 'Auditoria SSH'),
      trendVisible: await textIncludes(cdp, 'Tendência recente'),
      detailsVisible: await textIncludes(cdp, 'Servidor e limites'),
      limitsVisible: await contentIncludes(cdp, 'CPU 85%, memória 85%, disco 90%, backup 30h'),
      dockerHelpVisible: await textIncludes(cdp, 'Docker stats indisponível'),
      degradedDetailsAccessible: await evaluate(cdp, `(() => {
        const labels = [...document.querySelectorAll('.component-row[tabindex="0"]')].map((item) => item.getAttribute('aria-label') || '');
        return labels.some((label) => label.includes('timeout')) && labels.some((label) => label.includes('Backup não encontrado'));
      })()`),
      accessibleDetailLabels: await evaluate(cdp, `[...document.querySelectorAll('.component-row')].map((item) => item.getAttribute('aria-label'))`),
      platformMenuVisible: await evaluate(cdp, `[...document.querySelectorAll('.n-menu-item-group')].some((group) => group.innerText.includes('Plataforma') && group.innerText.includes('Observabilidade'))`),
      layout: await snapshotLayout(cdp),
      screenshot: await captureScreenshot(cdp, 'observability-degraded-desktop'),
    })

    await navigate(cdp, 'empty-history')
    results.push({
      scenario,
      viewport: 'desktop',
      titleVisible: await textIncludes(cdp, 'Observabilidade'),
      statusVisible: await textIncludes(cdp, 'Saudável'),
      componentsVisible: await textIncludes(cdp, 'Gateway SSH'),
      backupsVisible: await textIncludes(cdp, 'Auditoria SSH'),
      trendVisible: await textIncludes(cdp, '0 amostras'),
      detailsVisible: await textIncludes(cdp, 'Servidor e limites'),
      limitsVisible: await contentIncludes(cdp, 'CPU 85%, memória 85%, disco 90%, backup 30h'),
      platformMenuVisible: await evaluate(cdp, `[...document.querySelectorAll('.n-menu-item-group')].some((group) => group.innerText.includes('Plataforma') && group.innerText.includes('Observabilidade'))`),
      layout: await snapshotLayout(cdp),
      screenshot: await captureScreenshot(cdp, 'observability-empty-history-desktop'),
    })

    await navigate(cdp, 'empty-disk')
    results.push({
      scenario,
      viewport: 'desktop',
      titleVisible: await textIncludes(cdp, 'Observabilidade'),
      statusVisible: await textIncludes(cdp, 'Atenção'),
      componentsVisible: await textIncludes(cdp, 'Gateway SSH'),
      backupsVisible: await textIncludes(cdp, 'Auditoria SSH'),
      trendVisible: await textIncludes(cdp, 'Tendência recente'),
      detailsVisible: await textIncludes(cdp, 'Servidor e limites'),
      limitsVisible: await contentIncludes(cdp, 'CPU 85%, memória 85%, disco 90%, backup 30h'),
      diskEmptyVisible: await textIncludes(cdp, 'Sem métrica de disco'),
      platformMenuVisible: await evaluate(cdp, `[...document.querySelectorAll('.n-menu-item-group')].some((group) => group.innerText.includes('Plataforma') && group.innerText.includes('Observabilidade'))`),
      layout: await snapshotLayout(cdp),
      screenshot: await captureScreenshot(cdp, 'observability-empty-disk-desktop'),
    })

    await navigate(cdp, 'api-error', 'Não foi possível carregar a observabilidade operacional.')
    results.push({
      scenario,
      viewport: 'desktop',
      titleVisible: await textIncludes(cdp, 'Observabilidade'),
      errorVisible: await textIncludes(cdp, 'Não foi possível carregar a observabilidade operacional.'),
      layout: await snapshotLayout(cdp),
      screenshot: await captureScreenshot(cdp, 'observability-api-error-desktop'),
    })

    await evaluate(cdp, `sessionStorage.setItem('nodeaccess_harness_profile_override', 'admin-common'); localStorage.setItem('na_access_token', ${JSON.stringify(fakeJwt(false))})`)
    await navigate(cdp, 'healthy')
    const adminCommonPlatformMenuVisible = await evaluate(cdp, `[...document.querySelectorAll('.n-menu-item-group')].some((group) => group.innerText.includes('Plataforma') && group.innerText.includes('Observabilidade') && !group.innerText.includes('Superadmins'))`)
    const adminCommonMenuGroups = await evaluate(cdp, `[...document.querySelectorAll('.n-menu-item-group')].map((group) => group.innerText)`)

    await evaluate(cdp, `sessionStorage.removeItem('nodeaccess_harness_profile_override'); localStorage.setItem('na_access_token', ${JSON.stringify(fakeJwt(true))})`)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true })
    await navigate(cdp, 'healthy')
    results.push({
      scenario,
      viewport: 'mobile',
      titleVisible: await textIncludes(cdp, 'Observabilidade'),
      statusVisible: await textIncludes(cdp, 'Saudável'),
      componentsVisible: await textIncludes(cdp, 'Componentes'),
      backupsVisible: await textIncludes(cdp, 'Backups'),
      trendVisible: await textIncludes(cdp, 'Tendência recente'),
      detailsVisible: await textIncludes(cdp, 'Servidor e limites'),
      limitsVisible: await contentIncludes(cdp, 'CPU 85%, memória 85%, disco 90%, backup 30h'),
      layout: await snapshotLayout(cdp),
      screenshot: await captureScreenshot(cdp, 'observability-healthy-mobile'),
    })

    const findings = collectFindings(results)
    if (!adminCommonPlatformMenuVisible) findings.push('admin comum: Observabilidade nao ficou disponivel em Plataforma')
    const report = {
      frontend: FRONTEND,
      cdpBase: CDP_BASE,
      results,
      apiCalls: captured.apiCalls,
      consoleErrors: captured.console.filter((entry) => ['error', 'assert'].includes(entry.type)).length,
      pageErrors: captured.pageErrors.length,
      pageErrorDetails: captured.pageErrors.map((entry) => entry.exceptionDetails?.exception?.description || entry.exceptionDetails?.text || 'unknown'),
      adminCommonPlatformMenuVisible,
      adminCommonMenuGroups,
      findings,
    }

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (findings.length) process.exitCode = 1
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
