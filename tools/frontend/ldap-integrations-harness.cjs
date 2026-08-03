#!/usr/bin/env node
/*
 * LDAP integrations UI harness via Chromium CDP.
 *
 * Usage:
 *   chromium-browser --headless=new --disable-gpu --no-sandbox \
 *     --remote-debugging-port=9352 --user-data-dir=/tmp/nodeaccess-ldap-ui \
 *     --window-size=1440,1000 about:blank
 *
 *   FRONTEND_BASE=http://127.0.0.1:5173 \
 *   CDP_BASE=http://127.0.0.1:9352 \
 *   node tools/frontend/ldap-integrations-harness.cjs
 *
 * The harness mocks the API endpoints used by Admin > Integrations. It does
 * not require a real backend database or LDAP server.
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')

const CDP_BASE = process.env.CDP_BASE || 'http://127.0.0.1:9352'
const FRONTEND = process.env.FRONTEND_BASE || 'http://127.0.0.1:5173'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-ldap-integrations-harness.json'
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || ''

let scenario = 'unlicensed'
const captured = {
  apiCalls: [],
  ldapPutPayloads: [],
  ldapTestPayloads: [],
  console: [],
  pageErrors: [],
  timings: [],
}

const ldapScenarioConfigs = {
  unlicensed: {
    enabled: false,
    url: null,
    bindDn: null,
    hasBindPassword: false,
    baseDn: null,
    userSearchFilter: null,
    startTls: false,
    tlsRejectUnauthorized: true,
    autoProvision: false,
    updatedAt: null,
  },
  'licensed-empty': {
    enabled: false,
    url: null,
    bindDn: null,
    hasBindPassword: false,
    baseDn: null,
    userSearchFilter: null,
    startTls: false,
    tlsRejectUnauthorized: true,
    autoProvision: false,
    updatedAt: null,
  },
  configured: {
    enabled: true,
    url: 'ldaps://ad.example.test:636',
    bindDn: 'CN=nodeaccess,OU=Service Accounts,DC=example,DC=test',
    hasBindPassword: true,
    baseDn: 'OU=Users,DC=example,DC=test',
    userSearchFilter: '(mail={{email}})',
    startTls: false,
    tlsRejectUnauthorized: true,
    autoProvision: true,
    updatedAt: new Date().toISOString(),
  },
}

function currentLdapConfig() {
  return ldapScenarioConfigs[scenario] || ldapScenarioConfigs['licensed-empty']
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
      }, 15000)
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

    if (request.method === 'PUT' && apiPath === '/integrations/ldap') {
      captured.ldapPutPayloads.push(JSON.parse(request.postData || '{}'))
    }
    if (request.method === 'POST' && apiPath === '/integrations/ldap/test') {
      captured.ldapTestPayloads.push(JSON.parse(request.postData || '{}'))
    }

    const response = mockApi(request.method, apiPath)
    await this.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: response.status,
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
      ],
      body: Buffer.from(JSON.stringify(response.body)).toString('base64'),
    })
  }

  close() {
    this.ws.close()
  }
}

function mockApi(method, apiPath) {
  if (method === 'GET' && apiPath === '/integrations') {
    const ldap = currentLdapConfig()
    return ok([
      { provider: 'onepassword', enabled: false, hasToken: false, updatedAt: new Date(0).toISOString() },
      { provider: 'google', enabled: false, hasToken: false, updatedAt: new Date(0).toISOString() },
      { provider: 'ldap', enabled: ldap.enabled, hasToken: ldap.hasBindPassword, updatedAt: ldap.updatedAt ?? new Date(0).toISOString() },
      { provider: 'openai', enabled: false, hasToken: false, updatedAt: new Date(0).toISOString() },
      { provider: 'jira', enabled: false, hasToken: false, updatedAt: new Date(0).toISOString() },
      { provider: 'local_ai', enabled: false, hasToken: false, updatedAt: new Date(0).toISOString() },
    ])
  }

  if (method === 'GET' && apiPath === '/features') {
    return ok({
      sessionAuditAiLicensed: false,
      localAiLicensed: false,
      integrationsLicensed: true,
      integrationProviders: {
        onepassword: false,
        google: false,
        ldap: scenario !== 'unlicensed',
        jira: false,
      },
      mcpEnabled: false,
    })
  }

  if (method === 'GET' && apiPath === '/integrations/openai') {
    return ok({
      enabled: false,
      hasApiKey: false,
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: null,
      auditInstructions: null,
      healthStatus: 'unknown',
      healthMessage: null,
      lastCheckedAt: null,
      updatedAt: null,
    })
  }

  if (method === 'GET' && apiPath === '/integrations/ldap') {
    if (scenario === 'unlicensed') return fail(403, 'Integração LDAP não licenciada para este tenant')
    return ok(currentLdapConfig())
  }

  if (method === 'PUT' && apiPath === '/integrations/ldap') {
    const payload = captured.ldapPutPayloads.at(-1) || {}
    const nextConfig = {
      enabled: payload.enabled === true,
      url: payload.url ?? null,
      bindDn: payload.bindDn ?? null,
      hasBindPassword: Boolean(payload.bindPassword) || currentLdapConfig().hasBindPassword,
      baseDn: payload.baseDn ?? null,
      userSearchFilter: payload.userSearchFilter ?? null,
      startTls: payload.startTls === true,
      tlsRejectUnauthorized: payload.tlsRejectUnauthorized !== false,
      autoProvision: payload.autoProvision === true,
      updatedAt: new Date().toISOString(),
    }
    ldapScenarioConfigs[scenario] = nextConfig
    return ok(nextConfig)
  }

  if (method === 'POST' && apiPath === '/integrations/ldap/test') {
    return ok({
      ok: true,
      healthStatus: 'healthy',
      healthMessage: 'Conexão LDAP validada com sucesso',
      checkedAt: new Date().toISOString(),
    })
  }

  return ok({})
}

function ok(body) {
  return { status: 200, body }
}

function fail(status, message) {
  return { status, body: { code: 'HARNESS_ERROR', message } }
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

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'Runtime exception'
    throw new Error(String(detail))
  }
  return result.result?.value
}

async function waitFor(cdp, expression, timeoutMs = 10000) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, expression)
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`waitFor timeout: ${expression}; last=${JSON.stringify(last)}`)
}

async function navigate(cdp, nextScenario) {
  scenario = nextScenario
  const startedAt = Date.now()
  await cdp.send('Page.navigate', { url: `${FRONTEND}/admin/integrations?harness=${encodeURIComponent(nextScenario)}&t=${Date.now()}` })
  await waitFor(cdp, 'document.readyState === "complete"')
  await waitFor(cdp, 'document.body && document.body.innerText.includes("LDAP / Active Directory")')
  captured.timings.push({ label: `navigate:${nextScenario}`, ms: Date.now() - startedAt })
}

async function captureScreenshot(cdp, label) {
  if (!SCREENSHOT_DIR) return null
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const filePath = path.join(SCREENSHOT_DIR, `${label}.png`)
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'))
  return filePath
}

async function textIncludes(cdp, text) {
  return evaluate(cdp, `document.body.innerText.includes(${JSON.stringify(text)})`)
}

async function getPerformanceSnapshot(cdp, label) {
  const metrics = await cdp.send('Performance.getMetrics')
  const map = Object.fromEntries(metrics.metrics.map((item) => [item.name, item.value]))
  return {
    label,
    timestamp: new Date().toISOString(),
    domNodes: map.Nodes ?? null,
    jsHeapUsedBytes: map.JSHeapUsedSize ?? null,
    jsEventListeners: map.JSEventListeners ?? null,
    layoutCount: map.LayoutCount ?? null,
    recalcStyleCount: map.RecalcStyleCount ?? null,
  }
}

async function fillInputByPlaceholder(cdp, placeholder, value) {
  const ok = await evaluate(cdp, `
    (() => {
      const input = Array.from(document.querySelectorAll('input, textarea')).find((el) => el.getAttribute('placeholder') === ${JSON.stringify(placeholder)});
      if (!input) return false;
      input.focus();
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `)
  if (!ok) throw new Error(`Input not found for placeholder: ${placeholder}`)
}

async function clickButtonByText(cdp, text) {
  const ok = await evaluate(cdp, `
    (() => {
      const button = Array.from(document.querySelectorAll('button')).find((el) => el.innerText.trim() === ${JSON.stringify(text)});
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!ok) throw new Error(`Button not found: ${text}`)
}

async function clickLdapSave(cdp) {
  await clickLdapButton(cdp, ['Salvar', 'Save'])
}

async function clickLdapTest(cdp) {
  await clickLdapButton(cdp, ['Testar conexão', 'Test connection'])
}

async function clickLdapButton(cdp, texts) {
  const ok = await evaluate(cdp, `
    (() => {
      const cards = Array.from(document.querySelectorAll('.n-card'));
      const card = cards.find((el) => el.innerText.includes('LDAP / Active Directory'));
      if (!card) return false;
      const buttons = Array.from(card.querySelectorAll('button'));
      const targetTexts = ${JSON.stringify(texts)};
      const button = buttons.find((el) => targetTexts.includes(el.innerText.trim()));
      if (!button) return false;
      button.click();
      return true;
    })()
  `)
  if (!ok) throw new Error(`LDAP button not found: ${texts.join(' / ')}`)
}

async function setLdapEnabled(cdp, checked) {
  const ok = await evaluate(cdp, `
    (() => {
      const cards = Array.from(document.querySelectorAll('.n-card'));
      const ldapCard = cards.find((el) => el.innerText.includes('LDAP / Active Directory'));
      if (!ldapCard) return false;
      const switchEl = ldapCard.querySelector('[role="switch"], .n-switch');
      if (!switchEl || switchEl.getAttribute('aria-disabled') === 'true' || switchEl.classList.contains('n-switch--disabled')) return false;
      const current = switchEl.getAttribute('aria-checked') === 'true' || switchEl.classList.contains('n-switch--active');
      if (current !== ${checked ? 'true' : 'false'}) switchEl.click();
      return true;
    })()
  `)
  if (!ok) throw new Error(`LDAP enabled switch unavailable for checked=${checked}`)
}

async function expandLdapSection(cdp, title) {
  const ok = await evaluate(cdp, `
    (() => {
      const cards = Array.from(document.querySelectorAll('.n-card'));
      const ldapCard = cards.find((el) => el.innerText.includes('LDAP / Active Directory'));
      if (!ldapCard) return false;
      const details = Array.from(ldapCard.querySelectorAll('details'))
        .find((el) => el.querySelector('summary')?.innerText.includes(${JSON.stringify(title)}));
      if (!details) return false;
      details.open = true;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
      return true;
    })()
  `)
  if (!ok) throw new Error(`LDAP section not found: ${title}`)
}

async function setCheckboxByLabel(cdp, labelText, checked) {
  const ok = await evaluate(cdp, `
    (() => {
      const cards = Array.from(document.querySelectorAll('.n-card'));
      const ldapCard = cards.find((el) => el.innerText.includes('LDAP / Active Directory'));
      const root = ldapCard || document;
      const checkbox = Array.from(root.querySelectorAll('[role="checkbox"], .n-checkbox'))
        .find((el) => el.innerText.includes(${JSON.stringify(labelText)}));
      if (!checkbox) return false;
      const current = checkbox.getAttribute('aria-checked') === 'true' || checkbox.classList.contains('n-checkbox--checked');
      if (current !== ${checked ? 'true' : 'false'}) checkbox.click();
      return true;
    })()
  `)
  if (!ok) throw new Error(`Checkbox not found: ${labelText}`)
}

async function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fakeJwt() {
  const payload = {
    sub: '1',
    email: 'admin@nodeaccess.local',
    role: 'admin',
    tenantId: 1,
    canManageHosts: true,
    canViewLiveSessions: true,
    forcePasswordChange: false,
    stage: 'authenticated',
  }
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`
}

function evaluateLdapLoginSecurityMatrix() {
  const cases = [
    {
      scenario: 'ldap-enabled-existing-user',
      ldapEnabled: true,
      ldapReachable: true,
      ldapPasswordValid: true,
      localUserExists: true,
      localPasswordValid: false,
      autoProvision: true,
      expectedCanStartLogin: true,
      note: 'Usuário LDAP já provisionado autentica quando LDAP está ativo e o bind do diretório valida a senha.',
    },
    {
      scenario: 'ldap-disabled-provisioned-user',
      ldapEnabled: false,
      ldapReachable: true,
      ldapPasswordValid: true,
      localUserExists: true,
      localPasswordValid: false,
      autoProvision: true,
      expectedCanStartLogin: false,
      note: 'Depois de desabilitar LDAP, usuário provisionado sem senha local deve falhar fechado.',
    },
    {
      scenario: 'ldap-transient-outage-provisioned-user',
      ldapEnabled: true,
      ldapReachable: false,
      ldapPasswordValid: true,
      localUserExists: true,
      localPasswordValid: false,
      autoProvision: true,
      expectedCanStartLogin: false,
      note: 'Instabilidade temporária do diretório não deve virar falso positivo de login.',
    },
    {
      scenario: 'ldap-disabled-local-breakglass',
      ldapEnabled: false,
      ldapReachable: false,
      ldapPasswordValid: false,
      localUserExists: true,
      localPasswordValid: true,
      autoProvision: false,
      expectedCanStartLogin: true,
      note: 'Conta local válida deve continuar funcionando para break-glass administrativo.',
    },
    {
      scenario: 'ldap-enabled-auto-provision-off-new-user',
      ldapEnabled: true,
      ldapReachable: true,
      ldapPasswordValid: true,
      localUserExists: false,
      localPasswordValid: false,
      autoProvision: false,
      expectedCanStartLogin: false,
      note: 'Usuário novo do diretório não deve entrar quando auto-provisionamento está desligado.',
    },
    {
      scenario: 'ldap-enabled-auto-provision-on-new-user',
      ldapEnabled: true,
      ldapReachable: true,
      ldapPasswordValid: true,
      localUserExists: false,
      localPasswordValid: false,
      autoProvision: true,
      expectedCanStartLogin: true,
      note: 'Usuário novo entra quando LDAP valida senha e auto-provisionamento está ligado.',
    },
  ]

  return cases.map((item) => {
    const localAllows = item.localUserExists && item.localPasswordValid
    const ldapAllows = item.ldapEnabled
      && item.ldapReachable
      && item.ldapPasswordValid
      && (item.localUserExists || item.autoProvision)
    const actualCanStartLogin = localAllows || ldapAllows
    return {
      ...item,
      actualCanStartLogin,
      ok: actualCanStartLogin === item.expectedCanStartLogin,
      residualRisk: item.expectedCanStartLogin
        ? null
        : 'Sessões e refresh tokens emitidos antes da desativação podem permanecer válidos até expiração/revogação; este harness valida início de login, não revogação global de sessões.',
    }
  })
}

function summarizeFindings(results, securityMatrix) {
  const navigationTimings = captured.timings.filter((item) => item.label.startsWith('navigate:'))
  const warmNavigations = navigationTimings.slice(1)
  const maxWarmNavigationMs = Math.max(0, ...warmNavigations.map((item) => item.ms))
  const perfSnapshots = results.map((item) => item.performance).filter(Boolean)
  const maxDomNodes = Math.max(0, ...perfSnapshots.map((item) => item.domNodes || 0))
  const maxEventListeners = Math.max(0, ...perfSnapshots.map((item) => item.jsEventListeners || 0))
  const consoleIssues = captured.console.filter((item) => ['error', 'warning', 'assert'].includes(item.type))

  const findings = []

  if (navigationTimings[0]?.ms > 5000) {
    findings.push({
      severity: 'info',
      area: 'performance',
      message: 'Primeira navegação lenta provavelmente influenciada por cold compile do Vite; compare com navegações quentes.',
      evidence: navigationTimings[0],
    })
  }

  if (maxWarmNavigationMs > 2000) {
    findings.push({
      severity: 'warning',
      area: 'performance',
      message: 'Navegação quente da tela de integrações passou de 2s.',
      evidence: { maxWarmNavigationMs },
    })
  }

  if (maxDomNodes > 10000) {
    findings.push({
      severity: 'info',
      area: 'performance',
      message: 'Tela de integrações monta mais de 10k nós DOM em cenários com seções expandidas; monitorar se novos providers aumentarem o custo.',
      evidence: { maxDomNodes },
    })
  }

  if (maxEventListeners > 2000) {
    findings.push({
      severity: 'info',
      area: 'performance',
      message: 'Quantidade de listeners passa de 2k com painéis LDAP expandidos; não falha o harness, mas é um sinal para observar regressões.',
      evidence: { maxEventListeners },
    })
  }

  if (consoleIssues.length > 0) {
    const countByType = consoleIssues.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1
      return acc
    }, {})
    const samples = consoleIssues.slice(0, 5).map((item) => ({
      type: item.type,
      text: (item.args || [])
        .map((arg) => arg.value || arg.description || '')
        .filter(Boolean)
        .join(' ')
        .slice(0, 240),
    }))
    findings.push({
      severity: 'warning',
      area: 'runtime',
      message: 'Console emitiu avisos/erros durante o harness.',
      evidence: { count: consoleIssues.length, countByType, samples },
    })
  }

  if (captured.pageErrors.length > 0) {
    findings.push({
      severity: 'error',
      area: 'runtime',
      message: 'A página emitiu exceções JavaScript.',
      evidence: { count: captured.pageErrors.length },
    })
  }

  const failedSecurityCases = securityMatrix.filter((item) => !item.ok)
  if (failedSecurityCases.length > 0) {
    findings.push({
      severity: 'error',
      area: 'security',
      message: 'Matriz de segurança LDAP teve comportamento inesperado.',
      evidence: failedSecurityCases.map((item) => item.scenario),
    })
  }

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
    await cdp.send('Performance.enable')
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        localStorage.setItem('na_access_token', ${JSON.stringify(fakeJwt())});
        localStorage.setItem('na_refresh_token', 'harness-refresh-token');
        localStorage.setItem('nodeaccess_locale', 'pt-BR');
      `,
    })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

    const results = []

    await navigate(cdp, 'unlicensed')
    results.push({
      scenario,
      ldapVisible: await textIncludes(cdp, 'LDAP / Active Directory'),
      unlicensedVisible: await textIncludes(cdp, 'Sem licença') || await textIncludes(cdp, 'Unlicensed'),
      ldapApiCalled: captured.apiCalls.some((call) => call.scenario === 'unlicensed' && call.path === '/integrations/ldap'),
      screenshot: await captureScreenshot(cdp, 'ldap-unlicensed'),
    })
    await assert(results.at(-1).ldapVisible, 'LDAP card should render when provider is unlicensed')
    await assert(!results.at(-1).ldapApiCalled, 'Unlicensed scenario must not call /integrations/ldap')

    await navigate(cdp, 'licensed-empty')
    await expandLdapSection(cdp, 'Configuração')
    await expandLdapSection(cdp, 'Casos práticos que resolve')
    await expandLdapSection(cdp, 'Guia de configuração')
    const emptyPutCount = captured.ldapPutPayloads.length
    await clickLdapSave(cdp)
    results.push({
      scenario,
      notConfiguredVisible: await textIncludes(cdp, 'Não configurado') || await textIncludes(cdp, 'Not configured'),
      guideVisible: await textIncludes(cdp, 'Guia de configuração') || await textIncludes(cdp, 'Configuration guide'),
      useCasesVisible: await textIncludes(cdp, 'Casos práticos que resolve'),
      emptySaveBlocked: captured.ldapPutPayloads.length === emptyPutCount,
      screenshot: await captureScreenshot(cdp, 'ldap-licensed-empty'),
      performance: await getPerformanceSnapshot(cdp, 'ldap-licensed-empty'),
    })
    await assert(results.at(-1).notConfiguredVisible, 'Licensed empty scenario should show not configured state')
    await assert(results.at(-1).guideVisible, 'LDAP guide should be present')
    await assert(results.at(-1).useCasesVisible, 'LDAP use cases should be present')
    await assert(results.at(-1).emptySaveBlocked, 'Saving empty LDAP configuration must not call PUT /integrations/ldap')

    await fillInputByPlaceholder(cdp, 'ldaps://ad.empresa.com:636', 'ldaps://ad.example.test:636')
    await fillInputByPlaceholder(cdp, 'CN=nodeaccess,OU=Service Accounts,DC=empresa,DC=com', 'CN=nodeaccess,OU=Service Accounts,DC=example,DC=test')
    await fillInputByPlaceholder(cdp, 'Senha da conta de serviço', 'secret-bind-password')
    await fillInputByPlaceholder(cdp, 'OU=Users,DC=empresa,DC=com', 'OU=Users,DC=example,DC=test')
    await fillInputByPlaceholder(cdp, '(mail={{email}})', '(mail={{email}})')
    await setCheckboxByLabel(cdp, 'Auto-provisionar usuários LDAP', true)

    await clickLdapTest(cdp)
    await waitFor(cdp, 'document.body.innerText.includes("Conexão LDAP validada com sucesso") || document.body.innerText.includes("LDAP connection validated successfully")')
    results.push({
      scenario: 'licensed-empty-test',
      testPayload: captured.ldapTestPayloads.at(-1),
      savedDuringTest: captured.ldapPutPayloads.length > emptyPutCount,
      screenshot: await captureScreenshot(cdp, 'ldap-test'),
      performance: await getPerformanceSnapshot(cdp, 'ldap-test'),
    })
    await assert(results.at(-1).testPayload?.url === 'ldaps://ad.example.test:636', 'LDAP test payload should use current form URL')
    await assert(results.at(-1).testPayload?.bindPassword === 'secret-bind-password', 'LDAP test payload should include current bind password')
    await assert(!results.at(-1).savedDuringTest, 'Testing LDAP connection must not save configuration')

    await clickLdapSave(cdp)
    await waitFor(cdp, 'document.body.innerText.includes("Integração LDAP salva") || document.body.innerText.includes("LDAP integration saved")')
    results.push({
      scenario: 'licensed-empty-save',
      savedPayload: captured.ldapPutPayloads.at(-1),
      disabledVisible: await textIncludes(cdp, 'Desativado') || await textIncludes(cdp, 'Disabled'),
      screenshot: await captureScreenshot(cdp, 'ldap-save'),
      performance: await getPerformanceSnapshot(cdp, 'ldap-save'),
    })
    await assert(results.at(-1).savedPayload?.enabled === false, 'Save payload should preserve disabled toggle before first activation')
    await assert(results.at(-1).savedPayload?.autoProvision === true, 'Save payload should include autoProvision=true')
    await assert(results.at(-1).savedPayload?.tlsRejectUnauthorized === true, 'Save payload should validate TLS by default')
    await assert(results.at(-1).disabledVisible, 'Saved-but-disabled LDAP config should show disabled state')

    await navigate(cdp, 'configured')
    await expandLdapSection(cdp, 'Configuração')
    results.push({
      scenario,
      activeVisible: await textIncludes(cdp, 'Ativo') || await textIncludes(cdp, 'Active'),
      savedPasswordHintVisible: await textIncludes(cdp, 'senha já salva') || await textIncludes(cdp, 'password already saved'),
      screenshot: await captureScreenshot(cdp, 'ldap-configured'),
      performance: await getPerformanceSnapshot(cdp, 'ldap-configured'),
    })
    await assert(results.at(-1).activeVisible, 'Configured scenario should show active state')
    await assert(results.at(-1).savedPasswordHintVisible, 'Configured scenario should show saved bind password hint')

    await setLdapEnabled(cdp, false)
    await clickLdapSave(cdp)
    await waitFor(cdp, 'document.body.innerText.includes("Integração LDAP salva") || document.body.innerText.includes("LDAP integration saved")')
    results.push({
      scenario: 'configured-disable',
      savedPayload: captured.ldapPutPayloads.at(-1),
      disabledVisible: await textIncludes(cdp, 'Desativado') || await textIncludes(cdp, 'Disabled'),
      preservedUrl: captured.ldapPutPayloads.at(-1)?.url === 'ldaps://ad.example.test:636',
      preservedBaseDn: captured.ldapPutPayloads.at(-1)?.baseDn === 'OU=Users,DC=example,DC=test',
      screenshot: await captureScreenshot(cdp, 'ldap-disable'),
      performance: await getPerformanceSnapshot(cdp, 'ldap-disable'),
    })
    await assert(results.at(-1).savedPayload?.enabled === false, 'Disabling LDAP must persist enabled=false')
    await assert(results.at(-1).disabledVisible, 'Disabling LDAP should show disabled state')
    await assert(results.at(-1).preservedUrl && results.at(-1).preservedBaseDn, 'Disabling LDAP must preserve configuration fields')

    await setLdapEnabled(cdp, true)
    await clickLdapSave(cdp)
    await waitFor(cdp, 'document.body.innerText.includes("Integração LDAP salva") || document.body.innerText.includes("LDAP integration saved")')
    results.push({
      scenario: 'configured-reactivate',
      savedPayload: captured.ldapPutPayloads.at(-1),
      activeVisible: await textIncludes(cdp, 'Ativo') || await textIncludes(cdp, 'Active'),
      screenshot: await captureScreenshot(cdp, 'ldap-reactivate'),
      performance: await getPerformanceSnapshot(cdp, 'ldap-reactivate'),
    })
    await assert(results.at(-1).savedPayload?.enabled === true, 'Reactivating LDAP must persist enabled=true')
    await assert(results.at(-1).activeVisible, 'Reactivating LDAP should show active state')

    const securityMatrix = evaluateLdapLoginSecurityMatrix()
    await assert(securityMatrix.every((item) => item.ok), 'LDAP login security matrix has unexpected permissive or restrictive behavior')
    const findings = summarizeFindings(results, securityMatrix)

    const report = {
      ok: true,
      frontend: FRONTEND,
      cdpBase: CDP_BASE,
      results,
      securityMatrix,
      findings,
      apiCalls: captured.apiCalls,
      ldapPutPayloads: captured.ldapPutPayloads,
      ldapTestPayloads: captured.ldapTestPayloads,
      timings: captured.timings,
      consoleEvents: captured.console.length,
      pageErrors: captured.pageErrors,
      writtenAt: new Date().toISOString(),
    }
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    cdp.close()
  }
}

main().catch((error) => {
  const report = {
    ok: false,
    error: error.stack || error.message,
    apiCalls: captured.apiCalls,
    ldapPutPayloads: captured.ldapPutPayloads,
    ldapTestPayloads: captured.ldapTestPayloads,
    timings: captured.timings,
    consoleEvents: captured.console.length,
    pageErrors: captured.pageErrors,
    writtenAt: new Date().toISOString(),
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  console.error(JSON.stringify(report, null, 2))
  process.exit(1)
})
