#!/usr/bin/env node
const fs = require('node:fs')
const crypto = require('node:crypto')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-session-command-policies-playwright.json'
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH || '/tmp/nodeaccess-session-command-policies.png'

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sub: '1', email: 'admin@nodeaccess.local', name: 'Admin Policies', role: 'admin',
    isPlatformAdmin: true, tenantId: 1, canManageHosts: true, canViewLiveSessions: true,
    forcePasswordChange: false, stage: 'authenticated', iat: now, exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHash('sha256').update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function fixtures() {
  return {
    policy: { id: 10, tenantId: 1, name: 'Produção segura', description: 'Bloqueios de alto risco', enabled: true, priority: 200, defaultAction: 'allow', createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z' },
    rule: { id: 'r1', policyGroupId: 10, type: 'prefix', pattern: 'rm -rf', action: 'block', message: 'Remoção bloqueada', priority: 200, enabled: true, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z' },
    user: { id: 1, name: 'Admin', email: 'admin@nodeaccess.local' },
    host: { id: 1, name: 'server-01', ip: '10.0.0.1' },
    binding: { id: 21, policyGroupId: 10, targetType: 'user', targetId: 1, createdAt: '2026-08-09T00:00:00Z' },
  }
}

async function installMocks(page, scenario, requests) {
  const data = fixtures()
  const policyBindings = scenario === 'configured' ? [data.binding] : []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    requests.push(`${request.method()} ${path}`)
    let status = 200
    let body = []
    if (path === '/features') body = { agentsLicensed: true, secretsLicensed: true, snippetsLicensed: true, portForwardingLicensed: true, feedbackLicensed: true, localAiLicensed: true, mcpLicensed: true }
    else if (path === '/users/me/preferences') body = null
    else if (path === '/session-command-policies' && request.method() === 'GET') {
      if (scenario === 'error') status = 500
      if (scenario === 'loading') await new Promise((resolve) => setTimeout(resolve, 700))
      body = scenario === 'empty' ? [] : [data.policy]
    } else if (path === '/session-command-policies' && request.method() === 'POST') {
      body = { ...data.policy, id: 11, name: 'Nova política' }
    } else if (path === '/session-command-policies/10/rules') body = [data.rule]
    else if (path === '/session-command-policies/10/bindings' && request.method() === 'POST') {
      const input = request.postDataJSON()
      const created = { id: 21 + policyBindings.length, policyGroupId: 10, targetType: input.targetType, targetId: input.targetId ?? null, createdAt: '2026-08-09T00:00:00Z' }
      policyBindings.push(created)
      status = 201
      body = created
    }
    else if (path === '/session-command-policies/10/bindings') body = policyBindings
    else if (path === '/session-command-policies/evaluate' && request.method() === 'POST') {
      body = { command: 'rm -rf /tmp/teste', action: 'block', source: 'rule', defaultAction: 'allow', matchedRule: data.rule, message: data.rule.message, rulesEvaluated: 1 }
    } else if (path.startsWith('/users')) body = { data: [data.user], total: 1, page: 1, limit: 200 }
    else if (path === '/groups') body = []
    else if (path.startsWith('/hosts')) body = { data: [data.host], total: 1, page: 1, limit: 300 }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function newPage(browser, scenario, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript((token) => localStorage.setItem('na_access_token', token), fakeJwt())
  const page = await context.newPage()
  const requests = []
  await installMocks(page, scenario, requests)
  return { context, page, requests }
}

async function runConfigured(browser, report) {
  const { context, page, requests } = await newPage(browser, 'configured')
  await page.goto(`${FRONTEND}/admin/session-command-policies`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Bloqueio de comandos SSH' }).waitFor()
  await page.getByText('Configure em três etapas', { exact: true }).waitFor()
  await page.getByText('Editar grupo', { exact: true }).waitFor()
  if (await page.getByText('Prévia deste grupo', { exact: true }).isVisible().catch(() => false)) throw new Error('A validação avançada deveria iniciar oculta')

  await page.getByRole('button', { name: '2. Regras e alcance' }).click()
  await page.getByText('Regras', { exact: true }).waitFor()
  await page.getByText('Vínculos', { exact: true }).waitFor()
  await page.getByText('1 usuário', { exact: true }).waitFor()

  const scopeField = page.locator('.n-form-item').filter({ hasText: 'Escopo do vínculo' })
  await scopeField.locator('.n-base-selection').click()
  await page.getByText('Host', { exact: true }).last().click()
  const targetField = page.locator('.n-form-item').filter({ hasText: 'Destino' }).first()
  await targetField.locator('.n-base-selection').click()
  await page.getByText('server-01 (10.0.0.1)', { exact: true }).last().click()
  await page.getByRole('button', { name: 'Adicionar vínculo' }).click()
  await page.getByText('1 usuário · 1 host', { exact: true }).waitFor()
  if (!requests.includes('POST /session-command-policies/10/bindings')) throw new Error('A criação do vínculo não chamou a API')

  await scopeField.locator('.n-base-selection').click()
  await page.getByText('Todos os acessos', { exact: true }).last().click()
  await page.getByRole('button', { name: 'Adicionar vínculo' }).click()
  await page.getByText('Aplicar política a todos os acessos?', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Aplicar globalmente' }).click()
  await page.getByText('Aplicação global', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Remova o vínculo global para continuar' }).waitFor()

  await page.getByRole('button', { name: '3. Validar' }).click()
  await page.getByText('Prévia deste grupo', { exact: true }).waitFor()
  await page.getByText('Validar política efetiva', { exact: true }).waitFor()
  await page.getByPlaceholder('Ex.: rm -rf /tmp/teste').fill('rm -rf /tmp/teste')
  await page.getByText('Bloqueado', { exact: true }).first().waitFor()
  const userField = page.locator('.n-form-item').filter({ hasText: 'Usuário' }).last()
  await userField.locator('.n-base-selection').click()
  await page.getByText('Admin (admin@nodeaccess.local)', { exact: true }).last().click()
  const hostField = page.locator('.n-form-item').filter({ hasText: 'Host' }).last()
  await hostField.locator('.n-base-selection').click()
  await page.getByText('server-01 (10.0.0.1)', { exact: true }).last().click()
  await page.getByPlaceholder('Ex.: systemctl restart nginx').fill('rm -rf /tmp/teste')
  await page.getByRole('button', { name: 'Simular efetivo' }).click()
  await page.getByText('1 regra(s) avaliada(s)', { exact: true }).waitFor()
  if (!requests.includes('POST /session-command-policies/evaluate')) throw new Error('A simulação efetiva não chamou a API')

  const nav = page.getByRole('navigation', { name: 'Etapas da configuração da política' })
  for (const name of ['1. Grupo', '2. Regras e alcance', '3. Validar']) {
    await nav.getByRole('button', { name }).focus()
    if (!(await nav.getByRole('button', { name }).evaluate((element) => element === document.activeElement))) throw new Error(`Etapa sem foco: ${name}`)
  }

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: '1. Grupo' }).click()
  await page.getByText('Editar grupo', { exact: true }).waitFor()
  if (await page.getByRole('button', { name: '1. Grupo' }).getAttribute('aria-current') !== 'step') throw new Error('A etapa Grupo não foi marcada como ativa')
  const stepStyles = await nav.getByRole('button').evaluateAll((buttons) => buttons.map((button) => ({
    text: button.textContent?.trim(),
    current: button.getAttribute('aria-current'),
    className: button.className,
    backgroundColor: getComputedStyle(button).backgroundColor,
  })))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (overflow) throw new Error('A página possui overflow horizontal em 1024px')
  await page.mouse.move(1010, 10)
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
  report.configured = { requests, viewport: page.viewportSize(), overflow, stepStyles }
  await context.close()
}

async function runEmpty(browser, report) {
  const { context, page, requests } = await newPage(browser, 'empty')
  await page.goto(`${FRONTEND}/admin/session-command-policies`, { waitUntil: 'networkidle' })
  await page.getByText('Nenhum grupo de políticas criado', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Criar primeiro grupo' }).click()
  await page.getByRole('heading', { name: 'Novo grupo' }).last().waitFor()
  if (!(await page.getByRole('button', { name: '2. Regras e alcance' }).isDisabled())) throw new Error('Regras deveria permanecer desabilitada sem grupo')
  await page.locator('.n-form-item').filter({ hasText: 'Nome' }).locator('input').fill('Nova política')
  await page.getByRole('button', { name: 'Criar grupo' }).click()
  await page.getByText('Regras', { exact: true }).waitFor()
  if (!requests.includes('POST /session-command-policies')) throw new Error('A criação do grupo não chamou a API')
  report.empty = { result: 'passed', createRequest: true }
  await context.close()
}

async function runError(browser, report) {
  const { context, page } = await newPage(browser, 'error')
  await page.goto(`${FRONTEND}/admin/session-command-policies`, { waitUntil: 'networkidle' })
  await page.getByText('Não foi possível carregar as políticas de bloqueio.', { exact: true }).waitFor()
  report.error = 'passed'
  await context.close()
}

async function runLoading(browser, report) {
  const { context, page } = await newPage(browser, 'loading')
  const navigation = page.goto(`${FRONTEND}/admin/session-command-policies`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Atualizar' }).waitFor()
  if (!(await page.locator('.n-button--loading').count())) throw new Error('Estado de loading não ficou visível')
  await navigation
  report.loading = 'passed'
  await context.close()
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const report = { changeId: 'NA-0013', frontend: FRONTEND, startedAt: new Date().toISOString() }
  try {
    await runConfigured(browser, report)
    await runEmpty(browser, report)
    await runError(browser, report)
    await runLoading(browser, report)
    report.result = 'passed'
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
